#!/usr/bin/env python3
"""Package an already-built public artifact without rebuilding or adding source files."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import struct
import html
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ARTIFACT = ROOT / "dist/extension"
OUTPUT = ROOT / "dist/store"
if ARTIFACT.is_symlink() or ARTIFACT.resolve() != ARTIFACT:
    raise RuntimeError("Artifact must be a real directory at the stable build path")
manifest = json.loads((ARTIFACT / "manifest.json").read_text())
if manifest.get("version_name") or "nativeMessaging" in manifest.get("permissions", []) + manifest.get("optional_permissions", []):
    raise RuntimeError("Store candidate must be the public edition")
version = manifest["version"]
files = []
for path in sorted(ARTIFACT.rglob("*")):
    if path.is_symlink():
        raise RuntimeError("Symlink in artifact")
    if not path.is_file():
        continue
    name = path.relative_to(ARTIFACT).as_posix()
    if any(part in {".git", "docs", "tests", "e2e", "scripts", "node_modules"} for part in Path(name).parts) or path.suffix in {".pem", ".map", ".zip"}:
        raise RuntimeError(f"Private/build path in artifact: {name}")
    data = path.read_bytes()
    files.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
OUTPUT.mkdir(parents=True, exist_ok=True)
zip_path = OUTPUT / f"translateflow-{version}-candidate.zip"
handle, temporary = tempfile.mkstemp(prefix=".candidate-", suffix=".zip", dir=OUTPUT)
os.close(handle)
try:
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for entry in files:
            data = (ARTIFACT / entry["path"]).read_bytes()
            if hashlib.sha256(data).hexdigest() != entry["sha256"]:
                raise RuntimeError("Artifact changed during packaging")
            info = zipfile.ZipInfo(entry["path"], date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(temporary) as archive:
        if archive.testzip() is not None or len(archive.namelist()) != len(files):
            raise RuntimeError("ZIP integrity failure")
        for entry in files:
            if hashlib.sha256(archive.read(entry["path"])).hexdigest() != entry["sha256"]:
                raise RuntimeError("ZIP bytes differ from accepted artifact")
    os.replace(temporary, zip_path)
finally:
    if Path(temporary).exists():
        Path(temporary).unlink()
digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
source_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
source_tree = subprocess.check_output(["git", "write-tree"], cwd=ROOT, text=True).strip()
result = {"status": "candidate-not-submitted", "version": version, "zip": zip_path.name, "sha256": digest,
          "bytes": zip_path.stat().st_size, "sourceHead": source_head, "stagedTree": source_tree,
          "workingTreeDirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True)),
          "fileCount": len(files), "files": files}
(OUTPUT / "package-manifest.json").write_text(json.dumps(result, indent=2) + "\n")
(OUTPUT / "SHA256SUMS").write_text(f"{digest}  {zip_path.name}\n")
materials = OUTPUT / "materials"
materials.mkdir(exist_ok=True)
for source in sorted((ROOT / "docs/store").glob("*.md")):
    shutil.copyfile(source, materials / source.name)
shutil.copyfile(ROOT / "docs/PAGES.md", materials / "pages.md")
shutil.copyfile(ROOT / "assets/icons/icon-128.png", OUTPUT / "store-icon-128.png")
shots = []
for path in sorted((OUTPUT / "screenshots").glob("*.png")):
    data = path.read_bytes()
    width, height = struct.unpack(">II", data[16:24])
    if data[:8] != b"\x89PNG\r\n\x1a\n" or (width, height) != (1280, 800):
        raise RuntimeError("Store screenshot must be a 1280x800 PNG")
    provenance = "actual UI, real local hy-mt2-7b output" if "real-local" in path.name else "actual UI, isolated demonstration configuration"
    shots.append({"file": path.name, "width": width, "height": height, "provenance": provenance,
                  "sha256": hashlib.sha256(data).hexdigest()})
(OUTPUT / "screenshots.json").write_text(json.dumps(shots, indent=2) + "\n")
cards = "".join(f'<figure><img src="screenshots/{html.escape(s["file"])}" alt="{html.escape(s["file"])}"><figcaption>{html.escape(s["file"])} — {html.escape(s["provenance"])}</figcaption></figure>' for s in shots)
(OUTPUT / "screenshots.html").write_text('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TranslateFlow store screenshots</title><style>body{font:15px/1.6 system-ui;background:#f5f3ec;color:#29372d;max-width:1280px;margin:24px auto;padding:0 20px}figure{margin:24px 0}img{max-width:100%;border:1px solid #ddd;border-radius:8px}figcaption{padding:8px}a{color:#416e4c}</style><h1>TranslateFlow — store screenshots</h1><p>Actual extension UI, 1280×800. Real-local images use public demonstration text and the authorized local model; configuration screenshots do not claim a working cloud account. See <a href="materials/listing.md">listing</a> and <a href="materials/owner-checklist.md">remaining owner actions</a>.</p>'+cards+'</html>\n')
print(json.dumps({key: value for key, value in result.items() if key != "files"}, indent=2))
