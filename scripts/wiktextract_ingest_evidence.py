#!/usr/bin/env python3
"""Create a bounded compatibility report from a WikitextProcessor SQLite DB.

This report records only source-lock identity and aggregate parser database
facts. It deliberately contains no database path, page titles, source bytes, or
database rows.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any


EXPECTED_SOURCE_ID = "wikimedia-enwiktionary-20260901"
EXPECTED_WIKTEXTRACT_COMMIT = "1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a"
EXPECTED_WIKITEXTPROCESSOR_COMMIT = "e3d6d4edb77618f4d6680edc66e3f774bea59820"
EXPECTED_NAMESPACE_IDS = {"main": 0, "template": 10, "module": 828}
MAX_EVIDENCE_BYTES = 2048


def collect_database_evidence(
    db_path: str | os.PathLike[str],
    lock: dict[str, Any],
    source_size: int,
    source_sha256: str,
) -> dict[str, Any]:
    """Read real namespace totals from WTP's `pages` table and return evidence.

    The table and namespace IDs match the reviewed WikitextProcessor revision:
    `pages(title, namespace_id, redirect_to, need_pre_expand, body, model)`;
    English Wiktionary uses namespace IDs 0, 10, and 828 for Main, Template,
    and Module respectively.
    """

    if not isinstance(lock, dict):
        raise ValueError("source lock must be a JSON object")
    if lock.get("schemaVersion") != 1 or lock.get("status") != "locked":
        raise ValueError("source lock must be schema version 1 and locked")
    if lock.get("sourceId") != EXPECTED_SOURCE_ID:
        raise ValueError("source lock identity is incompatible")

    artifact = lock.get("artifact")
    if not isinstance(artifact, dict):
        raise ValueError("source lock artifact is required")
    if (
        artifact.get("sizeBytes") != source_size
        or artifact.get("sha256") != source_sha256
    ):
        raise ValueError("verified source bytes do not match the source lock")
    if (
        not isinstance(source_size, int)
        or isinstance(source_size, bool)
        or source_size <= 0
    ):
        raise ValueError("verified source size must be a positive integer")
    if (
        not isinstance(source_sha256, str)
        or len(source_sha256) != 64
        or any(character not in "0123456789abcdef" for character in source_sha256)
    ):
        raise ValueError("verified source SHA-256 must be a lowercase hex digest")

    extractor = lock.get("extractor")
    if not isinstance(extractor, dict):
        raise ValueError("source lock extractor is required")
    if extractor.get("wiktextractCommit") != EXPECTED_WIKTEXTRACT_COMMIT:
        raise ValueError("source lock wiktextract commit is incompatible")
    if (
        extractor.get("wikitextprocessorCommit")
        != EXPECTED_WIKITEXTPROCESSOR_COMMIT
    ):
        raise ValueError("source lock wikitextprocessor commit is incompatible")

    database = Path(db_path)
    try:
        database_bytes = database.stat().st_size
    except OSError as error:
        raise ValueError("parser database is missing or unreadable") from error
    if not database.is_file() or database_bytes <= 0:
        raise ValueError("parser database must be a non-empty regular file")

    # Open read-only: evidence collection must not create, repair, or modify DBs.
    uri = database.resolve().as_uri() + "?mode=ro"
    try:
        with sqlite3.connect(uri, uri=True) as connection:
            columns = {
                row[1] for row in connection.execute("PRAGMA table_info(pages)")
            }
            required_columns = {"title", "namespace_id"}
            if not required_columns.issubset(columns):
                raise ValueError(
                    "parser database pages table is incompatible with WTP"
                )
            namespace_counts = {
                name: connection.execute(
                    "SELECT COUNT(*) FROM pages WHERE namespace_id = ?",
                    (namespace_id,),
                ).fetchone()[0]
                for name, namespace_id in EXPECTED_NAMESPACE_IDS.items()
            }
    except sqlite3.Error as error:
        raise ValueError("parser database pages table is missing or unreadable") from error

    if any(
        not isinstance(count, int) or isinstance(count, bool) or count <= 0
        for count in namespace_counts.values()
    ):
        raise ValueError(
            "parser database must contain non-zero Main, Template, and Module pages"
        )

    evidence = {
        "schemaVersion": 1,
        "source": {
            "sourceId": EXPECTED_SOURCE_ID,
            "sha256": source_sha256,
            "sizeBytes": source_size,
        },
        "extractor": {
            "wiktextractCommit": EXPECTED_WIKTEXTRACT_COMMIT,
            "wikitextprocessorCommit": EXPECTED_WIKITEXTPROCESSOR_COMMIT,
        },
        "parserDb": {
            "bytes": database_bytes,
            "namespacePageCounts": namespace_counts,
        },
    }
    serialized = json.dumps(evidence, separators=(",", ":"), sort_keys=True)
    if len(serialized.encode("utf-8")) > MAX_EVIDENCE_BYTES:
        raise ValueError("parser evidence exceeds the bounded report size")
    return evidence


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, help="completed WTP SQLite DB")
    parser.add_argument("--lock", required=True, help="verified source lock JSON")
    parser.add_argument("--source-size", type=int, required=True)
    parser.add_argument("--source-sha256", required=True)
    args = parser.parse_args(argv)

    try:
        lock = json.loads(Path(args.lock).read_text(encoding="utf-8"))
        evidence = collect_database_evidence(
            args.database, lock, args.source_size, args.source_sha256
        )
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"wiktextract ingest evidence failed: {error}", file=sys.stderr)
        return 1

    report = json.dumps(evidence, indent=2, sort_keys=True)
    if len(report.encode("utf-8")) > MAX_EVIDENCE_BYTES:
        print("wiktextract ingest evidence failed: bounded report exceeded", file=sys.stderr)
        return 1
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
