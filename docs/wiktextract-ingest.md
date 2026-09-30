# Pinned Wiktextract first-phase ingest

The ingest gate demonstrates that the locked `wikimedia-enwiktionary-20260901` dump can be loaded by the exact extractor revisions recorded in the committed source lock. It verifies the full compressed source bytes against the lock and Wikimedia's dated SHA-1 and MD5 manifests before it checks out or installs either parser.

The runner checks out these commits and fails if Git resolves either revision differently:

- `wiktextract`: `1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a`
- `wikitextprocessor`: `e3d6d4edb77618f4d6680edc66e3f774bea59820`

At the pinned Wiktextract revision, `wiktwords DUMP --dump-file-language-code en --skip-extraction --db-path DB --quiet` performs the full first phase: it parses the dump and stores Main, Template, and Module pages in the WikitextProcessor SQLite `pages` table, then skips Wiktextract's second-pass word extraction. The runner installs WikitextProcessor from its verified local checkout first. It removes the single reviewed floating Git dependency declaration from the temporary Wiktextract `pyproject.toml` during its local editable install, with an exact occurrence check, and restores that file afterward. Both installed Python modules must resolve to their matching local checkouts, and the Wiktextract package metadata must not retain the floating dependency.

Run locally after obtaining the exact dated source dump and official manifests:

```sh
python scripts/run-pinned-wiktextract-ingest.py \
  --source /tmp/enwiktionary-20260901-pages-articles.xml.bz2 \
  --sha1sums /tmp/enwiktionary-sha1sums.txt \
  --md5sums /tmp/enwiktionary-md5sums.txt \
  --lock lexicon/source-locks/wikimedia-enwiktionary-2026-09-01.json \
  --candidate lexicon/source-candidates/wikimedia-enwiktionary-2026-09-01.json \
  --work-dir /tmp/wiktextract-ingest-work \
  --evidence /tmp/wiktextract-ingest-work/evidence.json
```

The dump, parser checkouts, virtual environment, SQLite database, and command logs stay in the external work directory. They are build-only; the workflow does not upload them or configure dependency caches. On success, the runner emits one bounded JSON record with the source and extractor identities, parser database byte size, and non-zero Main, Template, and Module page counts. This confirms parser ingestion only. It does not measure extracted dictionary coverage, English-to-Chinese quality, or release suitability.

The GitHub Actions workflow checks out the exact pull request head, downloads the dated locked dump and checksum manifests, and runs the full first phase with a six-hour job limit. The hosted runner removes its temporary build data when the job ends; no raw dump, parser database, or parser logs are published as artifacts.
