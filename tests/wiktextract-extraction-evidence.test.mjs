import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const evidenceTool = new URL("../scripts/wiktextract_extraction_evidence.py", import.meta.url);
const runnerTool = new URL("../scripts/run-pinned-wiktextract-ingest.py", import.meta.url);
const lockPath = new URL("../lexicon/source-locks/wikimedia-enwiktionary-2026-09-01.json", import.meta.url);
const nltkLockPath = new URL("../scripts/wiktextract-nltk-data-lock.json", import.meta.url);
const python = process.env.PYTHON || "python3";
const scribuntoCommit = "d35ca1f8d5fd23f1a9915e497cc00cac238f28c4";
const hostMetadata = {
  system: "test",
  release: "test",
  machine: "test",
  sqliteVersion: "test"
};

async function makeFixture(t, rows = [{ lang_code: "en", word: "fixture-word", senses: [] }], errors = {}) {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wikt-extraction-evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const nltkLock = JSON.parse(await readFile(nltkLockPath, "utf8"));
  const outputPath = join(directory, "output.jsonl");
  const errorsPath = join(directory, "errors.json");
  const parserEvidencePath = join(directory, "parser-evidence.json");
  const requirementsLockPath = join(directory, "requirements.lock");
  const parserEvidence = {
    schemaVersion: 1,
    externalInputCacheRows: {
      interwiki_maps: 12,
      wikidata_items: 3,
      wikidata_properties: 2,
      wikidata_property_values: 4,
      wiki_articles: 1
    },
    source: {
      sourceId: lock.sourceId,
      sha256: lock.artifact.sha256,
      sizeBytes: lock.artifact.sizeBytes
    },
    extractor: { ...lock.extractor },
    parserDb: {
      bytes: 123,
      namespacePageCounts: { main: 1, template: 1, module: 1 }
    }
  };

  await writeFile(outputPath, rows.map(row => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
  await writeFile(errorsPath, JSON.stringify({
    errors: [], warnings: [], debugs: [], notes: [], wiki_notices: [], ...errors
  }));
  await writeFile(parserEvidencePath, JSON.stringify(parserEvidence));
  await writeFile(requirementsLockPath, "wiktextract==1.2.3\n");

  return {
    directory, lock, outputPath, errorsPath, parserEvidencePath, requirementsLockPath,
    parserEvidence,
    nltkDataMetadata: {
      repositoryCommit: nltkLock.repositoryCommit,
      archiveSha256: nltkLock.sha256,
      license: nltkLock.license
    }
  };
}

function runCollector(fixture, {
  lock = fixture.lock,
  packages = { wiktextract: "1.2.3" },
  nltkDataMetadata = fixture.nltkDataMetadata,
  pageHandlerLogMarkers = 0,
  pythonHashSeed = 0,
  actualScribuntoCommit = scribuntoCommit,
  buildHost = hostMetadata
} = {}) {
  const lockPathname = join(fixture.directory, "lock.json");
  const lockWrite = writeFile(lockPathname, JSON.stringify(lock));
  // The caller awaits this function, so the lock is present before the child starts.
  return lockWrite.then(() => spawnSync(python, [
    evidenceTool.pathname,
    "--output", fixture.outputPath,
    "--errors", fixture.errorsPath,
    "--lock", lockPathname,
    "--parser-evidence", fixture.parserEvidencePath,
    "--duration-seconds", "1.25",
    "--num-processes", "1",
    "--python-version", "3.12.0",
    "--requirements-lock", fixture.requirementsLockPath,
    "--package-versions", JSON.stringify(packages),
    "--nltk-data-metadata", JSON.stringify(nltkDataMetadata),
    "--page-handler-log-markers", String(pageHandlerLogMarkers),
    "--python-hash-seed", String(pythonHashSeed),
    "--wikitextprocessor-scribunto-commit", actualScribuntoCommit,
    "--host-metadata", JSON.stringify(buildHost)
  ], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } }));
}

function runPythonSnippet(source, args = []) {
  return spawnSync(python, ["-c", source, ...args], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });
}

test("extraction evidence binds nonempty English output hashes and bounded diagnostics", async t => {
  const row = { lang_code: "en", word: "fixture-word", senses: [{ glosses: ["fixture gloss"] }] };
  const fixture = await makeFixture(t, [row], {
    errors: [{ called_from: "page_handler_exception", message: "fixture parser exception" }],
    warnings: [{ message: "fixture warning" }]
  });

  const result = await runCollector(fixture);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.source.sourceId, fixture.lock.sourceId);
  assert.equal(report.source.sha256, fixture.lock.artifact.sha256);
  assert.equal(report.extractor.wiktextractCommit, fixture.lock.extractor.wiktextractCommit);
  assert.equal(report.extraction.languageCode, "en");
  assert.equal(report.extraction.recordCount, 1);
  assert.equal(report.extraction.langCodeRecordCounts.en, 1);
  assert.equal(report.extraction.outputBytes, Buffer.byteLength(`${JSON.stringify(row)}\n`));
  assert.equal(report.extraction.outputSha256, createHash("sha256").update(`${JSON.stringify(row)}\n`).digest("hex"));
  assert.equal(report.diagnostics.arrays.errors.records, 1);
  assert.equal(report.diagnostics.arrays.warnings.records, 1);
  assert.equal(report.diagnostics.pageHandlerExceptionRecords, 1);
  assert.equal(report.diagnostics.pageHandlerExceptionLogMarkers, 0);
  assert.equal(report.diagnostics.pageHandlerExceptionEventsLowerBound, 1);
  assert.equal(report.extractionStatus, "completed-with-page-failures");
  assert.deepEqual(report.buildEnvironment.nltkBrownCorpus, fixture.nltkDataMetadata);
  assert.equal(report.buildEnvironment.pythonHashSeed, 0);
  assert.equal(report.buildEnvironment.wikitextprocessorScribuntoCommit, scribuntoCommit);
  assert.deepEqual(report.buildEnvironment.host, hostMetadata);
  assert.equal(report.externalInputs.fullyInputLocked, false);
  assert.deepEqual(report.externalInputs.unlockedLiveInputs, [
    "Pinned WikitextProcessor initializes interwiki siteinfo from a live network response during phase one.",
    "Pinned Wiktextract may make conditional live Wikidata/SPARQL requests during phase two."
  ]);
  assert.equal(
    report.externalInputs.qualification,
    "Live responses are not pinned or captured; this is an experimental measurement, not a fully reproducible build."
  );
  assert.deepEqual(report.externalInputs.cacheTableRows, fixture.parserEvidence.externalInputCacheRows);
  assert.equal(
    report.scope,
    "build-only experimental evidence; not a fully input-locked build or dictionary quality claim"
  );
  assert.ok(Buffer.byteLength(result.stdout) <= 8192);
  assert.equal(result.stdout.includes("fixture-word"), false);
  assert.equal(result.stdout.includes("fixture parser exception"), false);
});

test("rejects empty output even if an upstream extractor process could exit zero", async t => {
  const fixture = await makeFixture(t, []);

  const result = await runCollector(fixture);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains no English records|output is empty/);
  assert.equal(result.stdout, "");
});

test("rejects output containing only records outside requested English", async t => {
  const fixture = await makeFixture(t, [{ lang_code: "de", word: "fixture-word" }]);

  const result = await runCollector(fixture);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /contains no English records/);
  assert.equal(result.stdout, "");
});

test("rejects mixed output with explicit non-English records instead of certifying partial output", async t => {
  const fixture = await makeFixture(t, [
    { lang_code: "en", word: "fixture-en" },
    { lang_code: "de", word: "fixture-de" }
  ]);

  const result = await runCollector(fixture);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /records outside the requested English language/);
  assert.equal(result.stdout, "");
});

test("allows and separately counts records without a language code", async t => {
  const fixture = await makeFixture(t, [
    { lang_code: "en", word: "fixture-en" },
    { word: "fixture-redirect" }
  ]);

  const result = await runCollector(fixture);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.extraction.langCodeRecordCounts.en, 1);
  assert.equal(report.extraction.langCodeRecordCounts.missing, 1);
  assert.equal(report.extraction.langCodeRecordCounts.other || 0, 0);
});

test("nonzero page-handler log markers qualify otherwise nonempty output as partial", async t => {
  const fixture = await makeFixture(t);

  const result = await runCollector(fixture, { pageHandlerLogMarkers: 4 });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.extraction.recordCount, 1);
  assert.equal(report.diagnostics.arrays.errors.records, 0);
  assert.equal(report.diagnostics.pageHandlerExceptionRecords, 0);
  assert.equal(report.diagnostics.pageHandlerExceptionLogMarkers, 4);
  assert.equal(report.diagnostics.pageHandlerExceptionEventsLowerBound, 4);
  assert.equal(report.extractionStatus, "completed-with-page-failures");
});

test("rejects a lock whose source bytes differ from verified parser evidence", async t => {
  const fixture = await makeFixture(t);
  const mismatched = structuredClone(fixture.lock);
  mismatched.artifact.sha256 = "f".repeat(64);

  const result = await runCollector(fixture, { lock: mismatched });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /verified source facts do not match the committed lock/);
  assert.equal(result.stdout, "");
});

test("rejects build-only Brown corpus metadata that differs from its external lock", async t => {
  const fixture = await makeFixture(t);
  const mismatchedNltkData = { ...fixture.nltkDataMetadata, archiveSha256: "f".repeat(64) };

  const result = await runCollector(fixture, { nltkDataMetadata: mismatchedNltkData });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /NLTK Brown data does not match its exact external lock/);
  assert.equal(result.stdout, "");
});

test("phase 1 does not fetch Brown data or set NLTK_DATA", async t => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wikt-phase-one-resources-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source.xml.bz2");
  const sha1sums = join(directory, "sha1sums.txt");
  const md5sums = join(directory, "md5sums.txt");
  const workDir = join(directory, "work");
  const evidence = join(directory, "parser-evidence.json");
  const lock = lockPath.pathname;
  const candidate = new URL(
    "../lexicon/source-candidates/wikimedia-enwiktionary-2026-09-01.json",
    import.meta.url
  ).pathname;
  await Promise.all([
    writeFile(source, "fixture dump bytes"),
    writeFile(sha1sums, "fixture sha1 manifest"),
    writeFile(md5sums, "fixture md5 manifest")
  ]);

  const program = String.raw`
import importlib.util
import os
import sys
import types
from pathlib import Path

runner_path, source, sha1sums, md5sums, work_dir, evidence, lock, candidate = sys.argv[1:]
spec = importlib.util.spec_from_file_location("pinned_runner", runner_path)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
os.environ.pop("NLTK_DATA", None)
commands = []
run_dirs = []

def logged(command, log_path, *, cwd, env=None, show_failure_tail=True):
    commands.append({"command": [str(value) for value in command], "env": dict(env or {})})

def clone(*args, **kwargs):
    return None

def brown_fetch(*args, **kwargs):
    raise AssertionError("phase 1 must not fetch the Brown corpus")

original_mkdtemp = runner.tempfile.mkdtemp
def record_run_dir(*args, **kwargs):
    path = original_mkdtemp(*args, **kwargs)
    run_dirs.append(Path(path))
    return path

def collect_database_evidence(db_path, lock_data, source_size, source_sha256):
    return {
        "schemaVersion": 1,
        "source": {
            "sourceId": lock_data["sourceId"],
            "sha256": source_sha256,
            "sizeBytes": source_size,
        },
        "extractor": lock_data["extractor"],
        "parserDb": {
            "bytes": 123,
            "namespacePageCounts": {"main": 1, "template": 1, "module": 1},
        },
    }

runner.shutil.which = lambda name: "/mock/" + name
runner.run_logged = logged
runner.clone_exact_revision = clone
runner.verify_checkout_revision = lambda *args, **kwargs: None
runner.verify_installed_sources = lambda *args, **kwargs: None
runner.validate_python_requirements_lock = lambda *args, **kwargs: None
runner.install_wiktextract_without_floating_dependency = lambda *args, **kwargs: None
runner.install_pinned_nltk_brown_data = brown_fetch
runner.tempfile.mkdtemp = record_run_dir
sys.modules["wiktextract_ingest_evidence"] = types.SimpleNamespace(
    collect_database_evidence=collect_database_evidence
)
sys.argv = [
    runner_path,
    "--source", source,
    "--sha1sums", sha1sums,
    "--md5sums", md5sums,
    "--lock", lock,
    "--candidate", candidate,
    "--work-dir", work_dir,
    "--evidence", evidence,
]
assert runner.main() == 0
phase1 = [item for item in commands if "--skip-extraction" in item["command"]]
assert len(phase1) == 1
assert "--dump-file-language-code" in phase1[0]["command"]
assert phase1[0]["command"][phase1[0]["command"].index("--dump-file-language-code") + 1] == "en"
assert "--db-path" in phase1[0]["command"]
assert "NLTK_DATA" not in phase1[0]["env"]
assert not (run_dirs[0] / "nltk_data").exists()
assert not (run_dirs[0] / "external-locks").exists()
assert all(not any("brown.zip" in token or "nltk-data" in token for token in item["command"]) for item in commands)
print("PHASE1_RESOURCE_BOUNDARY_OK")
`;
  const result = runPythonSnippet(program, [
    runnerTool.pathname,
    source,
    sha1sums,
    md5sums,
    workDir,
    evidence,
    lock,
    candidate
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PHASE1_RESOURCE_BOUNDARY_OK/);
});

test("Scribunto initialization pins the gitlink and rejects a wrong gitlink or child HEAD", () => {
  const program = String.raw`
import importlib.util
import pathlib
import subprocess
import sys
import tempfile
from unittest.mock import patch

runner_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("pinned_runner", runner_path)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
expected_child = "d35ca1f8d5fd23f1a9915e497cc00cac238f28c4"
submodule_path = "src/wikitextprocessor/lua/mediawiki-extensions-Scribunto"
assert runner.WIKITEXTPROCESSOR_SCRIBUNTO_COMMIT == expected_child
assert runner.WIKITEXTPROCESSOR_SCRIBUNTO_PATH == submodule_path

base = pathlib.Path(tempfile.mkdtemp(prefix="translateflow-scribunto-gitlink-"))

def git(cwd, *args):
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
    )

def make_parent(name, gitlink_sha):
    parent = base / name
    parent.mkdir()
    git(parent, "init", "--quiet")
    git(parent, "config", "user.email", "fixture@example.invalid")
    git(parent, "config", "user.name", "Fixture")
    (parent / "root.txt").write_text("fixture\n", encoding="utf-8")
    git(parent, "add", "root.txt")
    git(parent, "commit", "--quiet", "-m", "fixture parent")
    child = parent / submodule_path
    child.mkdir(parents=True)
    git(child, "init", "--quiet")
    git(child, "config", "user.email", "fixture@example.invalid")
    git(child, "config", "user.name", "Fixture")
    (child / "fixture.txt").write_text("fixture\n", encoding="utf-8")
    git(child, "add", "fixture.txt")
    git(child, "commit", "--quiet", "-m", "fixture child")
    git(
        parent, "update-index", "--add", "--cacheinfo",
        f"160000,{gitlink_sha},{submodule_path}",
    )
    git(parent, "commit", "--quiet", "-m", "fixture gitlink")
    return parent

def expect_runtime_error(action, expected):
    try:
        action()
    except RuntimeError as error:
        assert expected in str(error), str(error)
    else:
        raise AssertionError("expected RuntimeError containing " + expected)

wrong_gitlink_parent = make_parent("wrong-gitlink", "a" * 40)
expect_runtime_error(
    lambda: runner.verify_wikitextprocessor_scribunto("git", wrong_gitlink_parent, {}),
    "unexpected Scribunto gitlink",
)

wrong_child_parent = make_parent("wrong-child", expected_child)
expect_runtime_error(
    lambda: runner.verify_wikitextprocessor_scribunto("git", wrong_child_parent, {}),
    "Scribunto submodule checkout does not match the WikitextProcessor gitlink",
)

mock_checkout = base / "mock-wikitextprocessor"
commands = []
def fake_run(command, *, cwd, **kwargs):
    command = [str(value) for value in command]
    if command[1:3] == ["rev-parse", "HEAD"]:
        observed = (
            runner.WIKITEXTPROCESSOR_COMMIT
            if pathlib.Path(cwd) == mock_checkout
            else expected_child
        )
        return subprocess.CompletedProcess(command, 0, stdout=observed + "\n", stderr="")
    if command[1:3] == ["ls-tree", "HEAD"]:
        line = f"160000 commit {expected_child}\t{submodule_path}\n"
        return subprocess.CompletedProcess(command, 0, stdout=line, stderr="")
    raise AssertionError("unexpected Git command: " + repr(command))

def fake_logged(command, log_path, *, cwd, env=None, show_failure_tail=True):
    commands.append([str(value) for value in command])

with patch.object(runner.subprocess, "run", side_effect=fake_run):
    with patch.object(runner, "run_logged", side_effect=fake_logged):
        runner.initialize_wikitextprocessor_scribunto(
            "git", mock_checkout, base / "logs", {}
        )

assert commands == [[
    "git", "submodule", "update", "--init", "--depth", "1", "--", submodule_path
]]
print("SCRIBUNTO_GITLINK_GUARDS_OK")
`;
  const result = runPythonSnippet(program, [runnerTool.pathname]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /SCRIBUNTO_GITLINK_GUARDS_OK/);
});

test("output collisions with protected inputs fail before setup and preserve every input", async t => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wikt-path-collisions-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source.xml.bz2");
  const sha1sums = join(directory, "sha1sums.txt");
  const md5sums = join(directory, "md5sums.txt");
  const lock = lockPath.pathname;
  const candidate = new URL(
    "../lexicon/source-candidates/wikimedia-enwiktionary-2026-09-01.json",
    import.meta.url
  ).pathname;
  await Promise.all([
    writeFile(source, "protected raw fixture bytes"),
    writeFile(sha1sums, "protected sha1 manifest bytes"),
    writeFile(md5sums, "protected md5 manifest bytes")
  ]);

  const cases = [
    {
      label: "parser evidence",
      evidence: source,
      reason: "Generated parser evidence collides with protected raw source"
    },
    {
      label: "extraction output",
      evidence: join(directory, "extract-output-evidence.json"),
      extractionOutput: sha1sums,
      extractionEvidence: join(directory, "extract-output-report.json"),
      extractionErrors: join(directory, "extract-output-errors.json"),
      reason: "Generated extraction output collides with protected SHA-1 manifest"
    },
    {
      label: "extraction diagnostics",
      evidence: join(directory, "extract-errors-evidence.json"),
      extractionOutput: join(directory, "extract-errors-output.jsonl"),
      extractionEvidence: join(directory, "extract-errors-report.json"),
      extractionErrors: md5sums,
      reason: "Generated extraction diagnostics collides with protected MD5 manifest"
    }
  ];

  const temporarySource = join(directory, "temporary-source.jsonl.tmp");
  await writeFile(temporarySource, "protected temporary collision bytes");
  cases.push({
    label: "temporary output",
    source: temporarySource,
    evidence: join(directory, "temporary-evidence.json"),
    extractionOutput: temporarySource.slice(0, -".tmp".length),
    extractionEvidence: join(directory, "temporary-report.json"),
    extractionErrors: join(directory, "temporary-errors.json"),
    reason: "Generated extraction output temporary file collides with protected raw source"
  });

  const protectedPaths = [source, sha1sums, md5sums, temporarySource, lock, candidate];
  const before = await Promise.all(protectedPaths.map(path => readFile(path)));
  const program = String.raw`
import importlib.util
import json
import sys
from pathlib import Path

runner_path, directory, sha1sums, md5sums, lock, candidate, case_json = sys.argv[1:]
cases = json.loads(case_json)
spec = importlib.util.spec_from_file_location("pinned_runner", runner_path)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

setup_calls = []
def setup_was_reached(*args, **kwargs):
    setup_calls.append((args, kwargs))
    raise AssertionError("path collision must fail before setup")

runner.shutil.which = setup_was_reached
runner.tempfile.mkdtemp = setup_was_reached
runner.run_logged = setup_was_reached

def invoke(case):
    work_dir = Path(directory) / ("work-" + case["label"].replace(" ", "-"))
    argv = [
        runner_path,
        "--source", case.get("source", str(Path(directory) / "source.xml.bz2")),
        "--sha1sums", sha1sums,
        "--md5sums", md5sums,
        "--lock", lock,
        "--candidate", candidate,
        "--work-dir", str(work_dir),
        "--evidence", case["evidence"],
    ]
    if "extractionOutput" in case:
        argv.extend([
            "--extraction-output", case["extractionOutput"],
            "--extraction-evidence", case["extractionEvidence"],
            "--extraction-errors", case["extractionErrors"],
        ])
    sys.argv = argv
    try:
        runner.main()
    except RuntimeError as error:
        assert case["reason"] in str(error), f"{case['label']}: {error}"
    else:
        raise AssertionError(case["label"] + " collision was accepted")
    assert not work_dir.exists(), case["label"] + " created the work directory"

for case in cases:
    invoke(case)
assert setup_calls == [], "source verification or parser setup ran before collision rejection"
print("OUTPUT_COLLISION_GUARDS_OK")
`;
  const result = runPythonSnippet(program, [
    runnerTool.pathname,
    directory,
    sha1sums,
    md5sums,
    lock,
    candidate,
    JSON.stringify(cases)
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /OUTPUT_COLLISION_GUARDS_OK/);
  const after = await Promise.all(protectedPaths.map(path => readFile(path)));
  assert.deepEqual(after, before);
});

test("extraction evidence rejects a Scribunto commit that differs from the locked gitlink", async t => {
  const fixture = await makeFixture(t);

  const result = await runCollector(fixture, { actualScribuntoCommit: "a".repeat(40) });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Scribunto submodule does not match its exact gitlink/);
  assert.equal(result.stdout, "");
});

test("rejects extraction evidence whose package inventory would exceed the report cap", async t => {
  const fixture = await makeFixture(t);
  const packages = Object.fromEntries(Array.from({ length: 700 }, (_, index) => [
    `fixture-package-${index.toString().padStart(4, "0")}`,
    "a-version-string-large-enough-to-exceed-the-evidence-budget"
  ]));

  const result = await runCollector(fixture, { packages });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exceeds the bounded report size/);
  assert.equal(result.stdout, "");
});
