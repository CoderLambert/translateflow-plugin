#!/usr/bin/env python3
"""Generate one six-file synthetic MDX/MDD package with a pinned independent writer."""

from __future__ import annotations

import argparse
import datetime as real_datetime
import hashlib
import html
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import struct
import sys
import types
import wave
import zlib

WRITER_COMMIT = "f0240b30cabd2f0470d3ee1a0641fc7f8c38dcf5"
FIXED_DATE = (2026, 9, 30)
TITLE = "TranslateFlow Linked MDD Package Fixture"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def chunk(name: bytes, data: bytes) -> bytes:
    body = name + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def png(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    rows = b"".join(b"\x00" + bytes((*color, 255)) * width for _ in range(height))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def wav(frequency: int, samples: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(8000)
        target.writeframes(b"".join(
            struct.pack("<h", round(4500 * math.sin(2 * math.pi * frequency * i / 8000)))
            for i in range(samples)
        ))
    return output.getvalue()


def import_writer(checkout: Path):
    commit = __import__("subprocess").check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    if commit != WRITER_COMMIT:
        raise SystemExit(f"writer commit mismatch: expected {WRITER_COMMIT}, got {commit}")
    cgi_compat = types.ModuleType("cgi")
    cgi_compat.escape = html.escape
    sys.modules["cgi"] = cgi_compat
    sys.path.insert(0, str(checkout))
    writer_module = __import__("writemdict")
    fixed_date = type("PinnedDate", (real_datetime.date,), {"today": classmethod(lambda cls: cls(*FIXED_DATE))})
    writer_module.datetime = types.SimpleNamespace(date=fixed_date)
    return writer_module.MDictWriter


def make(writer, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    internal_css = b".mdd-note{color:#a00000}.mdd-highlight{background-color:#f8efbf}"
    internal_png = png(2, 2, (210, 40, 40))
    internal_wav = wav(440, 960)
    sidecar_css = (
        ".mdd-note { color: #2f5d50; font-weight: 600; }\n"
        ".mdd-highlight { background-color: #f8efbf; }\n"
        ".mdd-badge { background-image: url('sample.png'); background-size: 2px 2px; }\n"
        "@import url('https://attacker.invalid/remote.css');\n"
        "#outside { position: fixed; inset: 0; }\n"
    ).encode("utf-8")
    sidecar_png = png(3, 2, (30, 100, 190))
    sidecar_wav = wav(660, 480)
    record = (
        '<div class="mdd-note">'
        '<link rel="stylesheet" href="fixture.css">'
        '<p class="mdd-highlight">Synthetic linked package resources.</p>'
        '<span class="mdd-badge">Safe stylesheet image slot</span>'
        '<a href="#media-anchor">Jump to audio</a>'
        '<img alt="3 by 2 sidecar image" src="sample.png">'
        '<div id="media-anchor">Audio target</div>'
        '<audio controls preload="none" src="tone.wav"></audio>'
        '<img src="https://attacker.invalid/never-fetch.png" onerror="window.__mddLinkedPackageExecuted=true">'
        '<script>window.__mddLinkedPackageExecuted=true</script>'
        '</div>'
    )
    mdx = writer(
        {"linkedpackagefixture": record}, title=TITLE,
        description="Synthetic six-file linked-resource fixture; not a dictionary corpus.",
        block_size=4096, version="2.0", encoding="utf8",
    )
    base_mdd = writer(
        {r"\fixture.css": internal_css, r"\sample.png": internal_png},
        title=TITLE, description="Synthetic base MDD resources.", block_size=128, version="2.0", is_mdd=True,
    )
    numbered_mdd = writer(
        {r"\tone.wav": internal_wav},
        title=TITLE, description="Synthetic numbered MDD resources.", block_size=128, version="2.0", is_mdd=True,
    )
    payloads = {
        "linked-package.mdx": mdx,
        "linked-package.mdd": base_mdd,
        "linked-package.1.mdd": numbered_mdd,
        "fixture.css": sidecar_css,
        "sample.png": sidecar_png,
        "tone.wav": sidecar_wav,
    }
    for name, source in (("linked-package.mdx", mdx), ("linked-package.mdd", base_mdd), ("linked-package.1.mdd", numbered_mdd)):
        stream = io.BytesIO()
        source.write(stream)
        payloads[name] = stream.getvalue()
    for name, data in payloads.items():
        (output / name).write_bytes(data)
    lock = {
        "schemaVersion": 1,
        "purpose": "synthetic-linked-mdx-mdd-package-not-real-dictionary-corpus",
        "independentWriter": {
            "name": "writemdict", "repository": "https://github.com/zhansliu/writemdict",
            "commit": WRITER_COMMIT, "license": "MIT"
        },
        "entry": "linkedpackagefixture",
        "files": [
            {"file": name, "bytes": len(data), "sha256": sha256(data), "role": role}
            for name, data, role in [
                ("linked-package.mdx", payloads["linked-package.mdx"], "mdx"),
                ("linked-package.mdd", payloads["linked-package.mdd"], "mdd-base"),
                ("linked-package.1.mdd", payloads["linked-package.1.mdd"], "mdd-numbered"),
                ("fixture.css", sidecar_css, "stylesheet-sidecar"),
                ("sample.png", sidecar_png, "image-sidecar"),
                ("tone.wav", sidecar_wav, "audio-sidecar"),
            ]
        ],
        "resources": [
            {"path": name, "bytes": len(data), "sha256": sha256(data), "mime": mime, **extra}
            for name, data, mime, extra in [
                ("fixture.css", sidecar_css, "text/css", {}),
                ("sample.png", sidecar_png, "image/png", {"dimensions": [3, 2]}),
                ("tone.wav", sidecar_wav, "audio/wav", {"channels": 1, "sampleRateHz": 8000, "sampleCount": 480, "format": "PCM16"}),
            ]
        ],
        "mdxResourceReferences": ["fixture.css", "sample.png", "tone.wav", "#media-anchor"],
        "expectedOverrides": [
            {"path": "fixture.css", "expectedKind": "sidecar", "mddSha256": sha256(internal_css)},
            {"path": "sample.png", "expectedKind": "sidecar", "mddSha256": sha256(internal_png)},
            {"path": "tone.wav", "expectedKind": "sidecar", "mddSha256": sha256(internal_wav)},
        ],
        "expectedSafety": {"externalRequests": 0, "dictionaryScriptsExecuted": False, "audioStartsAfterUserClick": True}
    }
    (output / "corpus-lock.json").write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return lock


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--writer-checkout", default=os.environ.get("WRITEMDICT_CHECKOUT"))
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()
    if not args.writer_checkout:
        raise SystemExit("pass --writer-checkout or set WRITEMDICT_CHECKOUT")
    result = make(import_writer(Path(args.writer_checkout).resolve()), Path(args.out_dir).resolve())
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
