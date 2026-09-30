#!/usr/bin/env python3
"""Generate tiny MDX/MDD fixtures with the pinned independent MDict writer.

The writer checkout is deliberately kept outside the product tree. See
docs/RICH_MDD_INTEROP_EVIDENCE.md for the exact source revision and invocation.
"""

from __future__ import annotations

import argparse
import datetime as real_datetime
import hashlib
import html
import importlib
import io
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import types
import wave
import zlib


WRITER_COMMIT = "f0240b30cabd2f0470d3ee1a0641fc7f8c38dcf5"
FIXED_DATE = (2026, 9, 30)
TITLE = "TranslateFlow MDD Interop Fixture"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def chunk(name: bytes, data: bytes) -> bytes:
    body = name + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def sample_png() -> bytes:
    # Valid 2x2 RGBA PNG: red, green / blue, transparent white.
    pixels = bytes((
        0, 255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 0, 255, 255, 255, 255, 255, 0,
    ))
    ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def sample_wav() -> bytes:
    # Short, quiet 440 Hz, mono PCM16 clip (0.12 seconds at 8 kHz).
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(8000)
        target.writeframes(b"".join(
            struct.pack("<h", round(5000 * math.sin(2 * math.pi * 440 * i / 8000)))
            for i in range(960)
        ))
    return output.getvalue()


def import_writer(checkout: Path):
    commit = subprocess.check_output(
        ["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True
    ).strip()
    if commit != WRITER_COMMIT:
        raise SystemExit(f"writer commit mismatch: expected {WRITER_COMMIT}, got {commit}")

    # Python 3.13 removed cgi.escape, used by this 2016 writer. Supply only
    # that legacy stdlib name; no MDict code or fixture bytes are reimplemented.
    cgi_compat = types.ModuleType("cgi")
    cgi_compat.escape = html.escape
    sys.modules["cgi"] = cgi_compat
    sys.path.insert(0, str(checkout))
    writer_module = importlib.import_module("writemdict")

    # The upstream writer has no date argument. Pin its existing clock input
    # so generated artifact hashes remain reviewable and reproducible.
    fixed_date = type(
        "PinnedDate",
        (real_datetime.date,),
        {"today": classmethod(lambda cls: cls(*FIXED_DATE))},
    )
    writer_module.datetime = types.SimpleNamespace(date=fixed_date)
    return writer_module.MDictWriter


def write_pair(writer, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    png = sample_png()
    wav = sample_wav()
    css = (
        ".mdd-note { color: #2f5d50; font-weight: 600; }\n"
        ".mdd-highlight { background-color: #f8efbf; }\n"
    ).encode("utf-8")
    record = (
        '<div class="mdd-note">'
        '<link rel="stylesheet" href="interop/fixture.css">'
        '<p class="mdd-highlight">Independent MDD resource fixture.</p>'
        '<img alt="2 by 2 sample" src="interop/sample.png">'
        '<audio controls preload="none" src="interop/tone.wav"></audio>'
        '<img src="https://attacker.invalid/never-fetch.png" onerror="window.__mddFixtureExecuted=true">'
        '<script>window.__mddFixtureExecuted=true</script>'
        '</div>'
    )
    mdx = writer(
        {"mddinteropfixture": record},
        title=TITLE,
        description="Synthetic local interoperability fixture; not a dictionary corpus.",
        block_size=4096,
        version="2.0",
        encoding="utf8",
    )
    mdd = writer(
        {
            r"\interop\fixture.css": css,
            r"\interop\sample.png": png,
            r"\interop\tone.wav": wav,
        },
        title=TITLE,
        description="Synthetic binary resources for local interoperability tests.",
        block_size=128,
        version="2.0",
        is_mdd=True,
    )

    mdx_stream = io.BytesIO()
    mdd_stream = io.BytesIO()
    mdx.write(mdx_stream)
    mdd.write(mdd_stream)
    mdx_bytes = mdx_stream.getvalue()
    mdd_bytes = mdd_stream.getvalue()
    (output / "interop.mdx").write_bytes(mdx_bytes)
    (output / "interop.mdd").write_bytes(mdd_bytes)
    payloads = {
        "interop/fixture.css": css,
        "interop/sample.png": png,
        "interop/tone.wav": wav,
    }
    return {
        "mdx": {"file": "interop.mdx", "bytes": len(mdx_bytes), "sha256": sha256(mdx_bytes)},
        "mdd": {"file": "interop.mdd", "bytes": len(mdd_bytes), "sha256": sha256(mdd_bytes)},
        "entry": "mddinteropfixture",
        "resources": [
            {"path": path, "bytes": len(data), "sha256": sha256(data)}
            for path, data in sorted(payloads.items())
        ],
        "pngDimensions": [2, 2],
        "wav": {"channels": 1, "sampleRateHz": 8000, "sampleCount": 960, "format": "PCM16"},
        "headerClockDate": "2026-09-30",
        "purpose": "synthetic-interoperability-fixture-not-dictionary-corpus",
    }


def write_bulk(writer, output: Path, total_bytes: int) -> dict:
    if total_bytes <= 0:
        raise SystemExit("--bulk-bytes must be a positive byte count")
    output.mkdir(parents=True, exist_ok=True)
    # Distinct resource keys each produce a separate MDD record block. SHAKE-256
    # yields deterministic incompressible filler without low-ratio zip-bomb data.
    chunk_bytes = 1024 * 1024
    count = (total_bytes + chunk_bytes - 1) // chunk_bytes
    seed = b"TranslateFlow issue-184 MDD range-I/O evidence, 2026-09-30"
    entries = {}
    actual_bytes = 0
    for index in range(count):
        length = min(chunk_bytes, total_bytes - actual_bytes)
        entries[rf"\bulk\chunk-{index:04d}.bin"] = hashlib.shake_256(
            seed + index.to_bytes(4, "big")
        ).digest(length)
        actual_bytes += length
    probe = sample_png()
    entries[r"\interop\probe.png"] = probe
    source = writer(
        entries,
        title="Synthetic 100 MB MDD Range I/O Fixture",
        description="Synthetic deterministic incompressible bytes; not user or dictionary content.",
        block_size=64 * 1024,
        version="2.0",
        is_mdd=True,
    )
    target = output / "synthetic-100mb.mdd"
    with target.open("wb") as handle:
        source.write(handle)
    return {
        "file": str(target),
        "bytes": target.stat().st_size,
        "sha256": sha256_file(target),
        "resourceCount": count,
        "uncompressedPayloadBytes": actual_bytes + len(probe),
        "probePath": "interop/probe.png",
        "probeBytes": len(probe),
        "probeSha256": sha256(probe),
        "purpose": "synthetic-shake256-incompressible-range-read-evidence-not-a-real-dictionary-corpus",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--writer-checkout", default=os.environ.get("WRITEMDICT_CHECKOUT"))
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--bulk-bytes", type=int)
    args = parser.parse_args()
    if not args.writer_checkout:
        raise SystemExit("pass --writer-checkout or set WRITEMDICT_CHECKOUT")
    writer = import_writer(Path(args.writer_checkout).resolve())
    output = Path(args.out_dir).resolve()
    if args.bulk_bytes is not None:
        result = write_bulk(writer, output, args.bulk_bytes)
    else:
        result = write_pair(writer, output)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
