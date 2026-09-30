#!/usr/bin/env python3
"""Run source-locked Wiktextract phases into build-only outputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sqlite3
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import PurePosixPath
from xml.etree import ElementTree
from pathlib import Path
from typing import Any

SOURCE_ID = "wikimedia-enwiktionary-20260901"
WIKTEXTRACT_COMMIT = "1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a"
WIKITEXTPROCESSOR_COMMIT = "e3d6d4edb77618f4d6680edc66e3f774bea59820"
WIKITEXTPROCESSOR_SCRIBUNTO_PATH = "src/wikitextprocessor/lua/mediawiki-extensions-Scribunto"
WIKITEXTPROCESSOR_SCRIBUNTO_COMMIT = "d35ca1f8d5fd23f1a9915e497cc00cac238f28c4"
WIKTEXTRACT_FLOATING_DEPENDENCY = (
    '    "wikitextprocessor @ git+'
    'https://github.com/tatuylonen/wikitextprocessor.git",\n'
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCK = ROOT / "lexicon/source-locks/wikimedia-enwiktionary-2026-09-01.json"
DEFAULT_CANDIDATE = ROOT / "lexicon/source-candidates/wikimedia-enwiktionary-2026-09-01.json"
PYTHON_REQUIREMENTS_LOCK = ROOT / "scripts/wiktextract-python-requirements.lock"
NLTK_DATA_LOCK = ROOT / "scripts/wiktextract-nltk-data-lock.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Locked raw Wikimedia dump")
    parser.add_argument("--sha1sums", required=True, type=Path, help="Official dated SHA-1 manifest")
    parser.add_argument("--md5sums", required=True, type=Path, help="Official dated MD5 manifest")
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--candidate", type=Path, default=DEFAULT_CANDIDATE)
    parser.add_argument("--work-dir", required=True, type=Path, help="Build-only work directory outside the repository")
    parser.add_argument("--evidence", required=True, type=Path, help="Bounded evidence JSON path outside the repository")
    parser.add_argument("--extraction-output", type=Path, help="Optional full JSONL output from the pinned second phase")
    parser.add_argument("--extraction-evidence", type=Path, help="Bounded evidence for --extraction-output")
    parser.add_argument("--extraction-errors", type=Path, help="Build-only raw Wiktextract diagnostics JSON (defaults beside output)")
    parser.add_argument("--extraction-processes", type=int, choices=(1, 2), default=2, help="Bounded second-phase worker count")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.source.resolve(strict=True)
    sha1sums = args.sha1sums.resolve(strict=True)
    md5sums = args.md5sums.resolve(strict=True)
    lock_path = args.lock.resolve(strict=True)
    candidate_path = args.candidate.resolve(strict=True)
    nltk_lock_path = NLTK_DATA_LOCK.resolve(strict=True)
    work_base = args.work_dir.resolve()
    evidence_path = args.evidence.resolve()
    extraction_output = args.extraction_output.resolve() if args.extraction_output else None
    extraction_evidence_path = args.extraction_evidence.resolve() if args.extraction_evidence else None
    extraction_errors_path = (
        args.extraction_errors.resolve()
        if args.extraction_errors
        else (extraction_output.with_suffix(".errors.json") if extraction_output else None)
    )

    if (extraction_output is None) != (extraction_evidence_path is None):
        raise RuntimeError("--extraction-output and --extraction-evidence must be supplied together")
    if args.extraction_errors and extraction_output is None:
        raise RuntimeError("--extraction-errors requires --extraction-output")

    generated_outputs: list[tuple[str, Path]] = [("parser evidence", evidence_path)]
    if extraction_output is not None:
        generated_outputs.extend(
            [
                ("extraction output", extraction_output),
                ("extraction output temporary file", Path(f"{extraction_output}.tmp")),
                ("extraction evidence", extraction_evidence_path),
                ("extraction diagnostics", extraction_errors_path),
            ]
        )
    protected_inputs = [
        ("raw source", source),
        ("SHA-1 manifest", sha1sums),
        ("MD5 manifest", md5sums),
        ("source lock", lock_path),
        ("source candidate", candidate_path),
    ]
    validate_no_path_collisions(generated_outputs, protected_inputs, work_base)

    ensure_outside_repository(source, "raw dump")
    ensure_outside_repository(work_base, "work directory")
    ensure_outside_repository(evidence_path, "evidence output")
    if extraction_output is not None:
        ensure_outside_repository(extraction_output, "extraction output")
        ensure_outside_repository(extraction_evidence_path, "extraction evidence")
        ensure_outside_repository(extraction_errors_path, "extraction errors")
        if len({extraction_output, extraction_evidence_path, extraction_errors_path}) != 3:
            raise RuntimeError("extraction output, evidence, and errors paths must be distinct")

    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    verify_locked_extractor_identity(lock)
    nltk_data_lock = json.loads(nltk_lock_path.read_text(encoding="utf-8"))
    validate_nltk_data_lock(nltk_data_lock)

    node = shutil.which("node")
    git = shutil.which("git")
    curl = shutil.which("curl")
    if not node or not git or (extraction_output is not None and not curl):
        raise RuntimeError("Node.js and Git are required; full extraction also requires curl")

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
            "PYTHONHASHSEED": "0",
        }
    )
    nltk_data_metadata = prepare_extraction_resources(
        extraction_output, curl, nltk_data_lock, run_dir, logs_dir, env
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
    if extraction_output is not None:
        initialize_wikitextprocessor_scribunto(git, wtp_checkout, logs_dir, env)
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
    validate_python_requirements_lock(PYTHON_REQUIREMENTS_LOCK)
    run_logged(
        venv_pip + ["install", "--no-cache-dir", "--requirement", str(PYTHON_REQUIREMENTS_LOCK)],
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
    if extraction_output is not None:
        verify_wikitextprocessor_scribunto(git, wtp_checkout, env)
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

    if extraction_output is not None:
        extraction_output.parent.mkdir(parents=True, exist_ok=True)
        extraction_evidence_path.parent.mkdir(parents=True, exist_ok=True)
        extraction_errors_path.parent.mkdir(parents=True, exist_ok=True)
        extraction_log = logs_dir / "wiktwords-full-extraction.log"
        extraction_started = time.monotonic()
        run_logged(
            [
                str(venv_dir / "bin/wiktwords"),
                "--db-path",
                str(parser_db),
                "--dump-file-language-code",
                "en",
                "--language-code",
                "en",
                "--translations",
                "--pronunciations",
                "--num-processes",
                str(args.extraction_processes),
                "--out",
                str(extraction_output),
                "--errors",
                str(extraction_errors_path),
                "--quiet",
            ],
            extraction_log,
            cwd=ROOT,
            env=env,
            show_failure_tail=False,
        )
        extraction_duration = time.monotonic() - extraction_started
        verify_checkout_revision(git, wikt_checkout, WIKTEXTRACT_COMMIT, env)
        verify_checkout_revision(git, wtp_checkout, WIKITEXTPROCESSOR_COMMIT, env)
        verify_wikitextprocessor_scribunto(git, wtp_checkout, env)
        evidence["externalInputCacheRows"] = count_external_input_cache_rows(parser_db)

        # Query only aggregate output facts; raw JSONL, parser DB, diagnostics, and
        # logs remain in the external build directory and are never printed.
        from wiktextract_extraction_evidence import collect_extraction_evidence

        dependency_versions = installed_locked_versions(venv_python, env)
        extraction_report = collect_extraction_evidence(
            extraction_output,
            extraction_errors_path,
            lock,
            evidence,
            extraction_duration,
            args.extraction_processes,
            sys.version.split()[0],
            dependency_versions,
            PYTHON_REQUIREMENTS_LOCK,
            nltk_data_metadata,
            count_log_occurrences(extraction_log, b'=== EXCEPTION while parsing page "'),
            0,
            WIKITEXTPROCESSOR_SCRIBUNTO_COMMIT,
            {
                "system": platform.system(),
                "release": platform.release(),
                "machine": platform.machine(),
                "sqliteVersion": sqlite3.sqlite_version,
            },
        )
        extraction_serialized = json.dumps(
            extraction_report, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        extraction_evidence_path.write_text(extraction_serialized + "\n", encoding="utf-8")
        print("WIKTEXTRACT_EXTRACTION_EVIDENCE " + extraction_serialized)
    return 0


def validate_nltk_data_lock(lock: dict[str, Any]) -> None:
    expected = {
        "schemaVersion": 1,
        "repository": "https://github.com/nltk/nltk_data",
        "repositoryCommit": "550b6625bcef1f2abff2ff770a5a0d272c9c6b2a",
        "indexPath": "index.xml",
        "artifactPath": "packages/corpora/brown.zip",
        "artifactUrl": "https://raw.githubusercontent.com/nltk/nltk_data/550b6625bcef1f2abff2ff770a5a0d272c9c6b2a/packages/corpora/brown.zip",
        "sizeBytes": 3314357,
        "sha256": "9b275f9b3b95d7bd66ccfb7cd259f445a13bbe5d1f4107aba09fd3e8364bafa6",
        "uncompressedSizeBytes": 10117565,
        "license": "May be used for non-commercial purposes.",
        "use": "pinned Wiktextract build-only English word resource; not shipped or bundled",
    }
    for key, value in expected.items():
        if lock.get(key) != value:
            raise RuntimeError(f"Pinned NLTK data lock has unexpected {key}")


def prepare_extraction_resources(
    extraction_output: Path | None,
    curl: str | None,
    lock: dict[str, Any],
    run_dir: Path,
    logs_dir: Path,
    env: dict[str, str],
) -> dict[str, Any] | None:
    """Install the build-only Brown corpus only for full phase-two extraction."""

    if extraction_output is None:
        return None
    if not curl:
        raise RuntimeError("curl is required to acquire the exact pinned NLTK Brown corpus")
    env["NLTK_DATA"] = str(run_dir / "nltk_data")
    return install_pinned_nltk_brown_data(curl, lock, run_dir, logs_dir, env)


def initialize_wikitextprocessor_scribunto(
    git: str,
    checkout: Path,
    logs_dir: Path,
    env: dict[str, str],
) -> None:
    """Initialize WTP's exact committed Scribunto gitlink, without remote updates."""

    verify_checkout_revision(git, checkout, WIKITEXTPROCESSOR_COMMIT, env)
    run_logged(
        [git, "submodule", "update", "--init", "--depth", "1", "--", WIKITEXTPROCESSOR_SCRIBUNTO_PATH],
        logs_dir / "wikitextprocessor-scribunto-submodule.log",
        cwd=checkout,
        env=env,
        show_failure_tail=False,
    )
    verify_wikitextprocessor_scribunto(git, checkout, env)


def verify_wikitextprocessor_scribunto(
    git: str, checkout: Path, env: dict[str, str]
) -> None:
    gitlink = subprocess.run(
        [git, "ls-tree", "HEAD", WIKITEXTPROCESSOR_SCRIBUNTO_PATH],
        cwd=checkout,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    ).stdout.strip().split()
    if (
        len(gitlink) < 4
        or gitlink[0] != "160000"
        or gitlink[1] != "commit"
        or gitlink[2] != WIKITEXTPROCESSOR_SCRIBUNTO_COMMIT
        or gitlink[3] != WIKITEXTPROCESSOR_SCRIBUNTO_PATH
    ):
        raise RuntimeError("Pinned WikitextProcessor parent commit has an unexpected Scribunto gitlink")
    submodule = checkout / WIKITEXTPROCESSOR_SCRIBUNTO_PATH
    observed = subprocess.run(
        [git, "rev-parse", "HEAD"],
        cwd=submodule,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    ).stdout.strip()
    if observed != WIKITEXTPROCESSOR_SCRIBUNTO_COMMIT:
        raise RuntimeError("Scribunto submodule checkout does not match the WikitextProcessor gitlink")


def install_pinned_nltk_brown_data(
    curl: str,
    lock: dict[str, Any],
    run_dir: Path,
    logs_dir: Path,
    env: dict[str, str],
) -> dict[str, Any]:
    """Fetch and hash-check Brown data from its exact nltk_data Git commit."""

    external_locks = run_dir / "external-locks"
    nltk_root = run_dir / "nltk_data"
    corpus_dir = nltk_root / "corpora"
    external_locks.mkdir(parents=True, exist_ok=True)
    corpus_dir.mkdir(parents=True, exist_ok=True)
    commit = lock["repositoryCommit"]
    index_path = external_locks / "nltk-data-index.xml"
    archive_path = corpus_dir / "brown.zip"
    index_url = f"https://raw.githubusercontent.com/nltk/nltk_data/{commit}/index.xml"
    run_logged(
        [curl, "--fail", "--location", "--proto", "=https", "--tlsv1.2", "--retry", "3", "--retry-all-errors", "--silent", "--show-error", "--output", str(index_path), index_url],
        logs_dir / "nltk-data-index-download.log",
        cwd=ROOT,
        env=env,
    )
    verify_nltk_data_index(index_path, lock)
    run_logged(
        [curl, "--fail", "--location", "--proto", "=https", "--tlsv1.2", "--retry", "3", "--retry-all-errors", "--silent", "--show-error", "--output", str(archive_path), lock["artifactUrl"]],
        logs_dir / "nltk-brown-download.log",
        cwd=ROOT,
        env=env,
    )
    archive_bytes = archive_path.stat().st_size
    archive_sha256 = sha256_file(archive_path)
    if archive_bytes != lock["sizeBytes"] or archive_sha256 != lock["sha256"]:
        raise RuntimeError("Pinned NLTK Brown archive size or SHA-256 does not match its lock")

    with zipfile.ZipFile(archive_path) as archive:
        members = archive.infolist()
        if not members or any(
            PurePosixPath(member.filename).is_absolute()
            or ".." in PurePosixPath(member.filename).parts
            or not PurePosixPath(member.filename).parts
            or PurePosixPath(member.filename).parts[0] != "brown"
            for member in members
        ):
            raise RuntimeError("Pinned NLTK Brown archive contains an unexpected path")
        archive.extractall(corpus_dir)
    extracted_dir = corpus_dir / "brown"
    extracted_bytes = sum(
        path.stat().st_size for path in extracted_dir.rglob("*") if path.is_file()
    )
    if not extracted_dir.is_dir() or extracted_bytes != lock["uncompressedSizeBytes"]:
        raise RuntimeError("Pinned NLTK Brown extraction did not match the locked size")

    return {
        "repository": lock["repository"],
        "repositoryCommit": commit,
        "artifactPath": lock["artifactPath"],
        "artifactUrl": lock["artifactUrl"],
        "archiveBytes": archive_bytes,
        "archiveSha256": archive_sha256,
        "uncompressedBytes": extracted_bytes,
        "license": lock["license"],
        "use": lock["use"],
        "indexSha256": sha256_file(index_path),
    }


def verify_nltk_data_index(index_path: Path, lock: dict[str, Any]) -> None:
    try:
        root = ElementTree.parse(index_path).getroot()
    except ElementTree.ParseError as error:
        raise RuntimeError("Pinned NLTK data index is malformed") from error
    packages = root.findall("./packages/package")
    brown = next((item for item in packages if item.get("id") == "brown"), None)
    if brown is None:
        raise RuntimeError("Pinned NLTK data index does not declare Brown corpus")
    if (
        brown.get("size") != str(lock["sizeBytes"])
        or brown.get("sha256_checksum") != lock["sha256"]
        or brown.get("unzipped_size") != str(lock["uncompressedSizeBytes"])
        or brown.get("subdir") != "corpora"
        or brown.get("license") != lock["license"]
        or not (brown.get("url") or "").endswith("/packages/corpora/brown.zip")
    ):
        raise RuntimeError("Pinned Brown corpus metadata does not match its committed data index")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def count_log_occurrences(path: Path, needle: bytes) -> int:
    """Count exception markers without retaining or printing parser log content."""

    count = 0
    overlap = b""
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            data = overlap + chunk
            count += data.count(needle)
            overlap = data[-(len(needle) - 1) :]
    return count


def count_external_input_cache_rows(database: Path) -> dict[str, int | None]:
    """Report counts only for WTP's live-input cache tables; never read rows."""

    expected_tables = (
        "interwiki_maps",
        "wikidata_items",
        "wikidata_properties",
        "wikidata_property_values",
        "wiki_articles",
    )
    connection = sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True)
    try:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        counts: dict[str, int | None] = {}
        for table in expected_tables:
            if table not in tables:
                counts[table] = None
                continue
            # Table names come only from the fixed allowlist above.
            counts[table] = int(connection.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0])
        return counts
    finally:
        connection.close()


def validate_python_requirements_lock(path: Path) -> None:
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    requirements = [line for line in lines if line and not line.startswith("#")]
    if not requirements or any(
        "==" not in line
        or line.count("==") != 1
        or any(token in line for token in ("@", ";", " ", "<", ">", "~", "*"))
        for line in requirements
    ):
        raise RuntimeError("Python dependency lock must contain exact, non-Git package pins only")


def installed_locked_versions(python: Path, env: dict[str, str]) -> dict[str, str]:
    probe = r'''
import importlib.metadata as metadata
import json
from packaging.utils import canonicalize_name
locked = {canonicalize_name(line.split("==", 1)[0]) for line in open(__import__("sys").argv[1], encoding="utf-8") if line.strip() and not line.lstrip().startswith("#")}
actual = {canonicalize_name(dist.metadata["Name"]): dist.version for dist in metadata.distributions() if dist.metadata.get("Name")}
print(json.dumps({name: actual[name] for name in sorted(locked) if name in actual}, sort_keys=True))
'''
    result = subprocess.run(
        [str(python), "-c", probe, str(PYTHON_REQUIREMENTS_LOCK)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    versions = json.loads(result.stdout)
    expected = {
        line.split("==", 1)[0].lower().replace("_", "-"): line.split("==", 1)[1]
        for line in PYTHON_REQUIREMENTS_LOCK.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    actual_names = {name.lower().replace("_", "-") for name in versions}
    if set(expected) != actual_names or any(
        versions.get(name) != version for name, version in expected.items()
    ):
        raise RuntimeError("Installed dependency set does not match the pinned Python lock")
    return versions


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


def validate_no_path_collisions(
    generated_outputs: list[tuple[str, Path]],
    protected_inputs: list[tuple[str, Path]],
    work_dir: Path,
) -> None:
    """Reject output aliases that could overwrite inputs or the work directory."""

    for index, (output_label, output_path) in enumerate(generated_outputs):
        if paths_alias(output_path, work_dir):
            raise RuntimeError(f"Generated {output_label} collides with the work directory")
        for input_label, input_path in protected_inputs:
            if paths_alias(output_path, input_path):
                raise RuntimeError(f"Generated {output_label} collides with protected {input_label}")
        for other_label, other_path in generated_outputs[index + 1 :]:
            if paths_alias(output_path, other_path):
                raise RuntimeError(f"Generated {output_label} collides with generated {other_label}")


def paths_alias(first: Path, second: Path) -> bool:
    """Compare normalized paths and, when present, filesystem identity."""

    if first.resolve() == second.resolve():
        return True
    try:
        return os.path.samefile(first, second)
    except FileNotFoundError:
        return False


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
