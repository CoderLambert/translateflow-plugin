#!/usr/bin/env python3
"""Generate 526 distinct synthetic audio resources with pinned writemdict."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
WRITER_COMMIT = "f0240b30cabd2f0470d3ee1a0641fc7f8c38dcf5"
WRITER_LICENSE_SHA256 = "050b25702f152882a65e1ec147009cc90abe0624c87918b34f771026419aa19e"
WRITER_FILE_SHA256 = "f47452af9296b79d8f4fc39e0432d72278079857482bc6d74b1b5e35e4b65081"
FIXTURE_SCRIPT = ROOT / "scripts" / "generate-mdd-interop-fixture.py"
FIXED_DATE = "2026-09-30"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_generator():
    spec = importlib.util.spec_from_file_location("pinned_mdd_fixture_generator", FIXTURE_SCRIPT)
    if spec is None or spec.loader is None:
        raise SystemExit("cannot load pinned fixture helpers")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--writer-checkout", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--count", type=int, default=526)
    args = parser.parse_args()
    if args.count != 526:
        raise SystemExit("this fixture contract is fixed at 526 distinct audio paths")

    helper = load_generator()
    writer = helper.import_writer(Path(args.writer_checkout).resolve())
    output = Path(args.out_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    wav = helper.sample_wav()
    entries = {
        rf"\interop\tone-{index:03d}.wav": wav
        for index in range(args.count)
    }
    entries[r"\interop\sample.png"] = helper.sample_png()
    mdd = writer(
        entries,
        title="TranslateFlow 526 Distinct Audio Fixture",
        description="Synthetic local resources; 526 independently addressable paths, not dictionary content.",
        block_size=128,
        version="2.0",
        is_mdd=True,
    )
    target = output / "audio-526.mdd"
    with target.open("wb") as handle:
        mdd.write(handle)

    paths = [f"interop/tone-{index:03d}.wav" for index in range(args.count)]
    png = helper.sample_png()
    lock = {
        "schemaVersion": 1,
        "purpose": "synthetic-distinct-audio-resource-fixture-not-dictionary-content",
        "independentWriter": {
            "name": "writemdict",
            "repository": "https://github.com/zhansliu/writemdict",
            "commit": WRITER_COMMIT,
            "license": "MIT",
            "licenseSha256": WRITER_LICENSE_SHA256,
            "writerFile": "writemdict.py",
            "writerFileSha256": WRITER_FILE_SHA256,
        },
        "generation": {
            "script": "scripts/generate-mdd-audio-526-fixture.py",
            "scriptSha256": sha256_file(Path(__file__).resolve()),
            "helperScript": "scripts/generate-mdd-interop-fixture.py",
            "helperScriptSha256": sha256_file(FIXTURE_SCRIPT),
            "headerDate": FIXED_DATE,
            "mdd": {"file": target.name, "bytes": target.stat().st_size, "sha256": sha256_file(target)},
            "entryCount": len(entries),
            "distinctAudioResourceCount": len(paths),
            "distinctAudioPaths": paths,
            "audioPayload": {
                "bytes": len(wav),
                "sha256": hashlib.sha256(wav).hexdigest(),
                "format": "PCM16",
                "channels": 1,
                "sampleRateHz": 8000,
                "sampleCount": 960,
            },
            "imageResource": {
                "path": "interop/sample.png",
                "bytes": len(png),
                "sha256": hashlib.sha256(png).hexdigest(),
                "dimensions": [2, 2],
            },
        },
    }
    (output / "corpus-lock.json").write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(lock["generation"], sort_keys=True))


if __name__ == "__main__":
    main()
