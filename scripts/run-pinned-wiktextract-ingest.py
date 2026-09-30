#!/usr/bin/env python3
"""Run the full, source-locked Wiktextract first phase into a build-only DB."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

SOURCE_ID = "wikimedia-enwiktionary-20260901"
WIKTEXTRACT_COMMIT = "1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a"
WIKITEXTPROCESSOR_COMMIT = "e3d6d4edb77618f4d6680edc66e3f774bea59820"
WIKTEXTRACT_FLOATING_DEPENDENCY = (
    '    "wikitextprocessor @ git+'
    'https://github.com/tatuylonen/wikitextprocessor.git",\n'
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCK = ROOT / "lexicon/source-locks/wikimedia-enwiktionary-2026-09-01.json"
DEFAULT_CANDIDATE = ROOT / "lexicon/source-candidates/wikimedia-enwiktionary-2026-09-01.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Locked raw Wikimedia dump")
    parser.add_argument("--sha1sums", required=True, type=Path, help="Official dated SHA-1 manifest")
    parser.add_argument("--md5sums", required=True, type=Path, help="Official dated MD5 manifest")
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--candidate", type=Path, default=DEFAULT_CANDIDATE)
    parser.add_argument("--work-dir", required=True, type=Path, help="Build-only work directory outside the repository")
    parser.add_argument("--evidence", required=True, type=Path, help="Bounded evidence JSON path outside the repository")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.source.resolve(strict=True)
    sha1sums = args.sha1sums.resolve(strict=True)
    md5sums = args.md5sums.resolve(strict=True)
    lock_path = args.lock.resolve(strict=True)
    candidate_path = args.candidate.resolve(strict=True)
    work_base = args.work_dir.resolve()
    evidence_path = args.evidence.resolve()

    ensure_outside_repository(source, "raw dump")
    ensure_outside_repository(work_base, "work directory")
    ensure_outside_repository(evidence_path, "evidence output")

    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    verify_locked_extractor_identity(lock)

    node = shutil.which("node")
    git = shutil.which("git")
    if not node or not git:
        raise RuntimeError("Node.js and Git are required for the pinned ingest")

    work_base.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix="wiktextract-ingest-", dir=work_base))
    logs_dir = run_dir / "logs"
    logs_dir.mkdir()

    # This verifies the complete dump bytes and Wikimedia checksum manifests.
    # It deliberately runs before any checkout, dependency install, or parser work.
    verify_command = [
        node,
        str(ROOT / "scripts/audit-wikimedia-enwiktionary-source.mjs"),
        "--verify-lock",
        "--candidate",
        str(candidate_path),
        "--source",
        str(source),
        "--sha1sums",
        str(sha1sums),
        "--md5sums",
        str(md5sums),
        "--lock",
        str(lock_path),
    ]
    run_logged(verify_command, logs_dir / "source-lock-verification.log", cwd=ROOT)

    env = os.environ.copy()
    env.update(
        {
            "PIP_NO_CACHE_DIR": "1",
            "PIP_DISABLE_PIP_VERSION_CHECK": "1",
            "PYTHONNOUSERSITE": "1",
            "PYTHONUNBUFFERED": "1",
        }
    )
    python = Path(sys.executable)
    venv_dir = run_dir / "venv"
    run_logged(
        [str(python), "-m", "venv", str(venv_dir)],
        logs_dir / "venv.log",
        cwd=ROOT,
        env=env,
    )
    venv_python = venv_dir / "bin/python"
    venv_pip = [str(venv_python), "-m", "pip"]

    wtp_checkout = run_dir / "wikitextprocessor"
    wikt_checkout = run_dir / "wiktextract"
    clone_exact_revision(
        git,
        "https://github.com/tatuylonen/wikitextprocessor.git",
        WIKITEXTPROCESSOR_COMMIT,
        wtp_checkout,
        logs_dir,
        env,
    )
    clone_exact_revision(
        git,
        "https://github.com/tatuylonen/wiktextract.git",
        WIKTEXTRACT_COMMIT,
        wikt_checkout,
        logs_dir,
        env,
    )

    # Install declared non-Git runtime requirements explicitly. The wikitextprocessor
    # dependency is installed from its verified local checkout immediately below.
    runtime_requirements = [
        "setuptools",
        "wheel",
        "levenshtein",
        "nltk",
        "pydantic",
        "dateparser>=1.3.0",
        "lupa",
        "lxml",
        "mediawiki_langcodes==0.2.25",
        "psutil",
        "requests",
    ]
    run_logged(
        venv_pip + ["install", "--no-cache-dir", *runtime_requirements],
        logs_dir / "python-requirements-install.log",
        cwd=ROOT,
        env=env,
    )

    run_logged(
        venv_pip
        + [
            "install",
            "--no-deps",
            "--no-build-isolation",
            "--editable",
            str(wtp_checkout),
        ],
        logs_dir / "wikitextprocessor-local-install.log",
        cwd=ROOT,
        env=env,
    )
    install_wiktextract_without_floating_dependency(
        venv_pip,
        wikt_checkout,
        logs_dir / "wiktextract-local-install.log",
        env,
    )
    verify_checkout_revision(git, wikt_checkout, WIKTEXTRACT_COMMIT, env)
    verify_checkout_revision(git, wtp_checkout, WIKITEXTPROCESSOR_COMMIT, env)
    run_logged(
        [str(venv_python), "-m", "pip", "check"],
        logs_dir / "python-dependency-check.log",
        cwd=ROOT,
        env=env,
    )
    verify_installed_sources(
        venv_python, wikt_checkout, wtp_checkout, logs_dir, env
    )

    parser_db = run_dir / "parser.sqlite3"
    parser_log = logs_dir / "wiktwords-first-phase.log"
    run_logged(
        [
            str(venv_dir / "bin/wiktwords"),
            str(source),
            "--dump-file-language-code",
            "en",
            "--skip-extraction",
            "--db-path",
            str(parser_db),
            "--quiet",
        ],
        parser_log,
        cwd=ROOT,
        env=env,
        show_failure_tail=False,
    )
    verify_checkout_revision(git, wikt_checkout, WIKTEXTRACT_COMMIT, env)
    verify_checkout_revision(git, wtp_checkout, WIKITEXTPROCESSOR_COMMIT, env)

    # The evidence helper checks the real WTP SQLite schema and requires non-zero
    # counts for the main, Template, and Module namespaces before writing evidence.
    sys.path.insert(0, str(ROOT / "scripts"))
    from wiktextract_ingest_evidence import collect_database_evidence

    evidence: dict[str, Any] = collect_database_evidence(
        parser_db,
        lock,
        lock["artifact"]["sizeBytes"],
        lock["artifact"]["sha256"],
    )
    serialized = json.dumps(evidence, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(serialized + "\n", encoding="utf-8")
    print("WIKTEXTRACT_INGEST_EVIDENCE " + serialized)
    return 0


def verify_locked_extractor_identity(lock: dict[str, Any]) -> None:
    extractor = lock.get("extractor", {})
    actual = (
        lock.get("sourceId"),
        extractor.get("wiktextractCommit"),
        extractor.get("wikitextprocessorCommit"),
    )
    expected = (SOURCE_ID, WIKTEXTRACT_COMMIT, WIKITEXTPROCESSOR_COMMIT)
    if actual != expected:
        raise RuntimeError(
            "Committed source lock is not the reviewed Wikimedia/extractor identity"
        )


def clone_exact_revision(
    git: str,
    repository: str,
    revision: str,
    checkout: Path,
    logs_dir: Path,
    env: dict[str, str],
) -> None:
    label = checkout.name
    run_logged(
        [git, "clone", "--quiet", "--no-checkout", repository, str(checkout)],
        logs_dir / f"{label}-clone.log",
        cwd=ROOT,
        env=env,
    )
    run_logged(
        [git, "checkout", "--quiet", "--detach", revision],
        logs_dir / f"{label}-checkout.log",
        cwd=checkout,
        env=env,
    )
    observed = subprocess.run(
        [git, "rev-parse", "HEAD"],
        cwd=checkout,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    ).stdout.strip()
    if observed != revision:
        raise RuntimeError(
            f"{label} checkout mismatch: expected {revision}, got {observed}"
        )


def install_wiktextract_without_floating_dependency(
    pip_command: list[str],
    checkout: Path,
    log_path: Path,
    env: dict[str, str],
) -> None:
    pyproject = checkout / "pyproject.toml"
    original = pyproject.read_text(encoding="utf-8")
    occurrences = original.count(WIKTEXTRACT_FLOATING_DEPENDENCY)
    if occurrences != 1:
        raise RuntimeError(
            "Pinned wiktextract pyproject no longer has exactly one reviewed "
            "floating wikitextprocessor declaration"
        )
    pyproject.write_text(
        original.replace(WIKTEXTRACT_FLOATING_DEPENDENCY, "", 1),
        encoding="utf-8",
    )
    try:
        run_logged(
            pip_command
            + [
                "install",
                "--no-deps",
                "--no-build-isolation",
                "--editable",
                str(checkout),
            ],
            log_path,
            cwd=ROOT,
            env=env,
        )
    finally:
        pyproject.write_text(original, encoding="utf-8")


def verify_installed_sources(
    python: Path,
    wikt_checkout: Path,
    wtp_checkout: Path,
    logs_dir: Path,
    env: dict[str, str],
) -> None:
    probe = r'''
import importlib.metadata as metadata
import json
import pathlib
import wiktextract
import wikitextprocessor
wikt = pathlib.Path(wiktextract.__file__).resolve()
wtp = pathlib.Path(wikitextprocessor.__file__).resolve()
requirements = metadata.requires("wiktextract") or []
if any(item.lower().startswith("wikitextprocessor @ git+") for item in requirements):
    raise SystemExit("wiktextract metadata retains floating wikitextprocessor Git dependency")
print(json.dumps({"wiktextract": str(wikt), "wikitextprocessor": str(wtp)}))
'''
    result_path = logs_dir / "installed-module-origins.json"
    run_logged(
        [str(python), "-c", probe],
        result_path,
        cwd=ROOT,
        env=env,
    )
    # The command output is a one-line JSON record. run_logged writes it to file;
    # validate paths here so a globally installed package can never be accepted.
    origins = json.loads(result_path.read_text(encoding="utf-8").strip())
    expected_roots = {
        "wiktextract": wikt_checkout / "src/wiktextract",
        "wikitextprocessor": wtp_checkout / "src/wikitextprocessor",
    }
    for name, root in expected_roots.items():
        actual = Path(origins[name]).resolve()
        if not is_within(actual, root.resolve()):
            raise RuntimeError(
                f"Installed {name} module does not come from its exact local checkout"
            )


def verify_checkout_revision(
    git: str, checkout: Path, revision: str, env: dict[str, str]
) -> None:
    result = subprocess.run(
        [git, "rev-parse", "HEAD"],
        cwd=checkout,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    if result.stdout.strip() != revision:
        raise RuntimeError(
            f"{checkout.name} checkout changed from its pinned revision"
        )


def run_logged(
    command: list[str],
    log_path: Path,
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    show_failure_tail: bool = True,
) -> None:
    with log_path.open("wb") as log:
        result = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=False,
        )
    if result.returncode:
        detail = ("\n" + bounded_log_tail(log_path)) if show_failure_tail else ""
        raise RuntimeError(
            f"Command failed with exit {result.returncode}; log: {log_path}{detail}"
        )


def bounded_log_tail(path: Path, max_bytes: int = 12000) -> str:
    with path.open("rb") as stream:
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
        stream.seek(max(0, size - max_bytes))
        contents = stream.read().decode("utf-8", errors="replace")
    lines = contents.splitlines()[-60:]
    return "\n".join(lines)


def ensure_outside_repository(path: Path, label: str) -> None:
    if is_within(path, ROOT):
        raise RuntimeError(f"{label} must be outside the repository: {path}")


def is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"[WIKTEXTRACT_INGEST_FAILED] {error}", file=sys.stderr)
        raise SystemExit(1)
