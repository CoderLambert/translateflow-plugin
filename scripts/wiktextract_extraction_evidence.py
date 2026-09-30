#!/usr/bin/env python3
"""Write bounded aggregate evidence for a full pinned Wiktextract JSONL run.

Raw JSONL, parser databases, and Wiktextract diagnostics remain build-only. This
module streams both output files and reports hashes/counts without retaining rows.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any, TextIO

MAX_REPORT_BYTES = 8192
DIAGNOSTIC_ARRAY_CAPS = {
    "errors": 100_000,
    "warnings": 100_000,
    "debugs": 3_000_000,
    "notes": 100_000,
    "wiki_notices": 100_000,
}
EXPECTED_SOURCE_ID = "wikimedia-enwiktionary-20260901"
EXPECTED_WIKTEXTRACT_COMMIT = "1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a"
EXPECTED_WIKITEXTPROCESSOR_COMMIT = "e3d6d4edb77618f4d6680edc66e3f774bea59820"
EXPECTED_WIKITEXTPROCESSOR_SCRIBUNTO_COMMIT = "d35ca1f8d5fd23f1a9915e497cc00cac238f28c4"
EXPECTED_NLTK_DATA_COMMIT = "550b6625bcef1f2abff2ff770a5a0d272c9c6b2a"
EXPECTED_NLTK_BROWN_SHA256 = "9b275f9b3b95d7bd66ccfb7cd259f445a13bbe5d1f4107aba09fd3e8364bafa6"
EXPECTED_EXTERNAL_CACHE_TABLES = {
    "interwiki_maps",
    "wikidata_items",
    "wikidata_properties",
    "wikidata_property_values",
    "wiki_articles",
}


def collect_extraction_evidence(
    output_path: str | os.PathLike[str],
    errors_path: str | os.PathLike[str],
    lock: dict[str, Any],
    parser_evidence: dict[str, Any],
    duration_seconds: float,
    num_processes: int,
    python_version: str,
    dependency_versions: dict[str, str],
    requirements_lock: str | os.PathLike[str],
    nltk_data_metadata: dict[str, Any],
    page_handler_log_markers: int,
    python_hash_seed: int,
    wikitextprocessor_scribunto_commit: str,
    host_metadata: dict[str, str],
) -> dict[str, Any]:
    """Validate source identities and collect deterministic aggregate facts."""

    source = parser_evidence.get("source")
    extractor = parser_evidence.get("extractor")
    if not isinstance(source, dict) or not isinstance(extractor, dict):
        raise ValueError("completed first-phase evidence is required")
    if source.get("sourceId") != EXPECTED_SOURCE_ID:
        raise ValueError("source identity does not match the reviewed lock")
    if (
        extractor.get("wiktextractCommit") != EXPECTED_WIKTEXTRACT_COMMIT
        or extractor.get("wikitextprocessorCommit") != EXPECTED_WIKITEXTPROCESSOR_COMMIT
    ):
        raise ValueError("extractor revisions do not match the reviewed lock")
    artifact = lock.get("artifact") if isinstance(lock, dict) else None
    if (
        lock.get("sourceId") != EXPECTED_SOURCE_ID
        or not isinstance(artifact, dict)
        or artifact.get("sizeBytes") != source.get("sizeBytes")
        or artifact.get("sha256") != source.get("sha256")
    ):
        raise ValueError("verified source facts do not match the committed lock")
    if num_processes not in (1, 2):
        raise ValueError("extraction worker count must be one or two")
    if (
        nltk_data_metadata.get("repositoryCommit") != EXPECTED_NLTK_DATA_COMMIT
        or nltk_data_metadata.get("archiveSha256") != EXPECTED_NLTK_BROWN_SHA256
        or nltk_data_metadata.get("license") != "May be used for non-commercial purposes."
    ):
        raise ValueError("build-only NLTK Brown data does not match its exact external lock")
    if (
        not isinstance(page_handler_log_markers, int)
        or isinstance(page_handler_log_markers, bool)
        or page_handler_log_markers < 0
    ):
        raise ValueError("page-handler exception marker count must be non-negative")
    if python_hash_seed != 0:
        raise ValueError("extraction evidence requires the fixed Python hash seed 0")
    if wikitextprocessor_scribunto_commit != EXPECTED_WIKITEXTPROCESSOR_SCRIBUNTO_COMMIT:
        raise ValueError("WikitextProcessor Scribunto submodule does not match its exact gitlink")
    if not isinstance(host_metadata, dict) or any(
        not isinstance(host_metadata.get(key), str) or not host_metadata[key]
        for key in ("system", "release", "machine", "sqliteVersion")
    ):
        raise ValueError("host metadata must include OS, release, machine, and SQLite version")
    cache_rows = parser_evidence.get("externalInputCacheRows")
    if cache_rows is not None and (
        not isinstance(cache_rows, dict)
        or set(cache_rows) != EXPECTED_EXTERNAL_CACHE_TABLES
        or any(
            value is not None
            and (not isinstance(value, int) or isinstance(value, bool) or value < 0)
            for value in cache_rows.values()
        )
    ):
        raise ValueError("external-input cache evidence must contain only aggregate non-negative row counts")

    output_facts = count_jsonl_records(output_path)
    if output_facts["recordCount"] <= 0:
        raise ValueError("Wiktextract JSONL output is empty")
    if output_facts["langCodeRecordCounts"].get("en", 0) <= 0:
        raise ValueError("Wiktextract JSONL contains no English records")
    if output_facts["langCodeRecordCounts"].get("other", 0) > 0:
        raise ValueError("Wiktextract JSONL contains records outside the requested English language")
    diagnostics = count_diagnostic_arrays(errors_path)
    page_handler_error_records = diagnostics.pop("pageHandlerExceptionRecords")
    page_handler_exceptions = max(page_handler_log_markers, page_handler_error_records)
    dependency_lock_path = Path(requirements_lock)
    dependency_lock_sha256 = sha256_file(dependency_lock_path)

    report = {
        "schemaVersion": 1,
        "source": {
            "sourceId": source["sourceId"],
            "sha256": source["sha256"],
            "sizeBytes": source["sizeBytes"],
        },
        "extractor": {
            "wiktextractCommit": extractor["wiktextractCommit"],
            "wikitextprocessorCommit": extractor["wikitextprocessorCommit"],
        },
        "parserDb": parser_evidence["parserDb"],
        "extraction": {
            **output_facts,
            "durationSeconds": round(duration_seconds, 3),
            "languageCode": "en",
            "translations": True,
            "pronunciations": True,
            "numProcesses": num_processes,
        },
        "extractionStatus": (
            "completed-with-page-failures"
            if page_handler_exceptions > 0
            else "completed-without-observed-page-handler-failures"
        ),
        "diagnostics": {
            **diagnostics,
            "pageHandlerExceptionRecords": page_handler_error_records,
            "pageHandlerExceptionLogMarkers": page_handler_log_markers,
            "pageHandlerExceptionEventsLowerBound": page_handler_exceptions,
        },
        "buildEnvironment": {
            "pythonVersion": python_version,
            "pythonHashSeed": python_hash_seed,
            "requirementsLockSha256": dependency_lock_sha256,
            "packageVersions": dict(sorted(dependency_versions.items())),
            "nltkBrownCorpus": nltk_data_metadata,
            "wikitextprocessorScribuntoCommit": wikitextprocessor_scribunto_commit,
            "host": {key: host_metadata[key] for key in ("system", "release", "machine", "sqliteVersion")},
        },
        "externalInputs": {
            "fullyInputLocked": False,
            "unlockedLiveInputs": [
                "Pinned WikitextProcessor initializes interwiki siteinfo from a live network response during phase one.",
                "Pinned Wiktextract may make conditional live Wikidata/SPARQL requests during phase two.",
            ],
            "cacheTableRows": cache_rows,
            "qualification": "Live responses are not pinned or captured; this is an experimental measurement, not a fully reproducible build.",
        },
        "scope": "build-only experimental evidence; not a fully input-locked build or dictionary quality claim",
    }
    serialized = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(serialized.encode("utf-8")) > MAX_REPORT_BYTES:
        raise ValueError("extraction evidence exceeds the bounded report size")
    return report


def count_jsonl_records(path: str | os.PathLike[str]) -> dict[str, Any]:
    output = Path(path)
    digest = hashlib.sha256()
    byte_count = 0
    record_count = 0
    code_counts: Counter[str] = Counter()
    entries_with_translations = 0
    top_level_translation_rows = 0
    senses_with_translations = 0
    sense_translation_rows = 0
    entries_with_senses = 0

    with output.open("rb") as stream:
        while True:
            line = stream.readline()
            if not line:
                break
            digest.update(line)
            byte_count += len(line)
            if not line.strip():
                raise ValueError("Wiktextract JSONL contains a blank record line")
            try:
                record = json.loads(line)
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise ValueError(f"Wiktextract JSONL record {record_count + 1} is invalid") from error
            if not isinstance(record, dict):
                raise ValueError("Wiktextract JSONL records must be JSON objects")
            record_count += 1

            language = record.get("lang_code")
            if language == "en":
                code_counts["en"] += 1
            elif language is None:
                code_counts["missing"] += 1
            else:
                code_counts["other"] += 1

            translations = record.get("translations")
            if isinstance(translations, list):
                entries_with_translations += 1
                top_level_translation_rows += len(translations)

            senses = record.get("senses")
            if isinstance(senses, list):
                entries_with_senses += 1
                for sense in senses:
                    if not isinstance(sense, dict):
                        continue
                    sense_translations = sense.get("translations")
                    if isinstance(sense_translations, list):
                        senses_with_translations += 1
                        sense_translation_rows += len(sense_translations)

    return {
        "outputSha256": digest.hexdigest(),
        "outputBytes": byte_count,
        "recordCount": record_count,
        "langCodeRecordCounts": {key: code_counts[key] for key in sorted(code_counts)},
        "recordsWithSenses": entries_with_senses,
        "recordsWithTopLevelTranslations": entries_with_translations,
        "topLevelTranslationRows": top_level_translation_rows,
        "sensesWithTranslations": senses_with_translations,
        "senseTranslationRows": sense_translation_rows,
    }


def count_diagnostic_arrays(path: str | os.PathLike[str]) -> dict[str, Any]:
    """Count top-level diagnostic arrays without loading the large JSON file."""

    counts, page_handler_exception_records = stream_top_level_array_counts(Path(path))
    missing = set(DIAGNOSTIC_ARRAY_CAPS) - set(counts)
    if missing:
        raise ValueError("Wiktextract diagnostics are missing expected arrays")
    arrays = {
        key: {
            "records": counts[key],
            "cap": DIAGNOSTIC_ARRAY_CAPS[key],
            "mayBeTruncated": counts[key] >= DIAGNOSTIC_ARRAY_CAPS[key],
        }
        for key in DIAGNOSTIC_ARRAY_CAPS
    }
    return {
        "arrays": arrays,
        "pageHandlerExceptionRecords": page_handler_exception_records,
        "aggregationNotes": [
            "Pinned Wiktextract caps accumulated errors and warnings at 100000 records and debugs at 3000000 records; counts at a cap may be truncated.",
            "Pinned config.py copies warning records into notes and wiki_notices during worker aggregation, so those two arrays are not independent counts.",
            "Counts describe upstream diagnostic array records, not a count of rejected dictionary entries.",
        ],
    }


def stream_top_level_array_counts(path: Path) -> tuple[dict[str, int], int]:
    if not path.is_file() or path.stat().st_size <= 0:
        raise ValueError("Wiktextract diagnostics JSON is missing or empty")
    counts: dict[str, int] = {}
    page_handler_exception_records = 0
    with path.open("r", encoding="utf-8") as stream:
        reader = JsonCharReader(stream)
        reader.expect("{")
        while True:
            reader.skip_whitespace()
            if reader.peek() == "}":
                reader.read()
                break
            key = reader.read_json_string()
            reader.skip_whitespace()
            reader.expect(":")
            reader.skip_whitespace()
            if key in DIAGNOSTIC_ARRAY_CAPS:
                counts[key], page_exceptions = reader.count_array_items(
                    inspect_page_handler_errors=key == "errors"
                )
                page_handler_exception_records += page_exceptions
            else:
                reader.skip_json_value()
            reader.skip_whitespace()
            delimiter = reader.read()
            if delimiter == "}":
                break
            if delimiter != ",":
                raise ValueError("Wiktextract diagnostics JSON has invalid object syntax")
        reader.skip_whitespace()
        if reader.read() is not None:
            raise ValueError("Wiktextract diagnostics JSON has trailing content")
    return counts, page_handler_exception_records


class JsonCharReader:
    """Small buffered JSON structural scanner for giant top-level diagnostics arrays."""

    def __init__(self, stream: TextIO):
        self.stream = stream
        self.buffer = ""
        self.offset = 0
        self.pushed: str | None = None

    def read(self) -> str | None:
        if self.pushed is not None:
            char = self.pushed
            self.pushed = None
            return char
        if self.offset >= len(self.buffer):
            self.buffer = self.stream.read(64 * 1024)
            self.offset = 0
            if not self.buffer:
                return None
        char = self.buffer[self.offset]
        self.offset += 1
        return char

    def unread(self, char: str) -> None:
        if self.pushed is not None:
            raise RuntimeError("JSON scanner pushback overflow")
        self.pushed = char

    def peek(self) -> str | None:
        char = self.read()
        if char is not None:
            self.unread(char)
        return char

    def expect(self, expected: str) -> None:
        if self.read() != expected:
            raise ValueError(f"Wiktextract diagnostics JSON expected {expected!r}")

    def skip_whitespace(self) -> None:
        while (char := self.read()) is not None:
            if char not in " \t\r\n":
                self.unread(char)
                return

    def read_json_string(self) -> str:
        first = self.read()
        if first != '"':
            raise ValueError("Wiktextract diagnostics JSON object key is not a string")
        raw = ['"']
        escaped = False
        while (char := self.read()) is not None:
            raw.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                try:
                    value = json.loads("".join(raw))
                except json.JSONDecodeError as error:
                    raise ValueError("Wiktextract diagnostics JSON key is malformed") from error
                if not isinstance(value, str):
                    raise ValueError("Wiktextract diagnostics JSON key is not a string")
                return value
        raise ValueError("Wiktextract diagnostics JSON string is unterminated")

    def count_array_items(self, *, inspect_page_handler_errors: bool = False) -> tuple[int, int]:
        self.expect("[")
        self.skip_whitespace()
        if self.peek() == "]":
            self.read()
            return 0, 0
        count = 0
        page_handler_errors = 0
        while True:
            if inspect_page_handler_errors:
                item = self.skip_json_value(capture=True)
                try:
                    record = json.loads(item)
                except json.JSONDecodeError as error:
                    raise ValueError("Wiktextract diagnostic error record is malformed") from error
                if isinstance(record, dict) and record.get("called_from") == "page_handler_exception":
                    page_handler_errors += 1
            else:
                self.skip_json_value()
            count += 1
            self.skip_whitespace()
            delimiter = self.read()
            if delimiter == "]":
                return count, page_handler_errors
            if delimiter != ",":
                raise ValueError("Wiktextract diagnostics JSON array syntax is invalid")

    def skip_json_value(self, *, capture: bool = False) -> str | None:
        self.skip_whitespace()
        first = self.read()
        if first is None:
            raise ValueError("Wiktextract diagnostics JSON ended unexpectedly")
        raw = [first] if capture else None
        if first == '"':
            self._scan_string_body(raw)
            return "".join(raw) if raw is not None else None
        if first in "[{":
            self._scan_container(first, raw)
            return "".join(raw) if raw is not None else None
        while (char := self.read()) is not None:
            if char in ",]}" or char in " \t\r\n":
                self.unread(char)
                return "".join(raw) if raw is not None else None
            if raw is not None:
                raw.append(char)
        return "".join(raw) if raw is not None else None

    def _scan_string_body(self, raw: list[str] | None = None) -> None:
        escaped = False
        while (char := self.read()) is not None:
            if raw is not None:
                raw.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                return
        raise ValueError("Wiktextract diagnostics JSON string is unterminated")

    def _scan_container(self, first: str, raw: list[str] | None = None) -> None:
        depth = 1
        in_string = False
        escaped = False
        while (char := self.read()) is not None:
            if raw is not None:
                raw.append(char)
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
            elif char == '"':
                in_string = True
            elif char in "[{":
                depth += 1
            elif char in "]}":
                depth -= 1
                if depth == 0:
                    return
        raise ValueError("Wiktextract diagnostics JSON container is unterminated")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument("--errors", required=True)
    parser.add_argument("--lock", required=True)
    parser.add_argument("--parser-evidence", required=True)
    parser.add_argument("--duration-seconds", type=float, required=True)
    parser.add_argument("--num-processes", type=int, choices=(1, 2), required=True)
    parser.add_argument("--python-version", required=True)
    parser.add_argument("--requirements-lock", required=True)
    parser.add_argument("--package-versions", required=True, help="JSON mapping of pinned installed package versions")
    parser.add_argument("--nltk-data-metadata", required=True, help="JSON metadata for the verified build-only Brown corpus")
    parser.add_argument("--page-handler-log-markers", type=int, default=0)
    parser.add_argument("--python-hash-seed", type=int, default=0)
    parser.add_argument("--wikitextprocessor-scribunto-commit", required=True)
    parser.add_argument("--host-metadata", required=True, help="JSON object with system, release, machine, sqliteVersion")
    args = parser.parse_args(argv)
    try:
        report = collect_extraction_evidence(
            args.output,
            args.errors,
            json.loads(Path(args.lock).read_text(encoding="utf-8")),
            json.loads(Path(args.parser_evidence).read_text(encoding="utf-8")),
            args.duration_seconds,
            args.num_processes,
            args.python_version,
            json.loads(args.package_versions),
            args.requirements_lock,
            json.loads(args.nltk_data_metadata),
            args.page_handler_log_markers,
            args.python_hash_seed,
            args.wikitextprocessor_scribunto_commit,
            json.loads(args.host_metadata),
        )
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"wiktextract extraction evidence failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
