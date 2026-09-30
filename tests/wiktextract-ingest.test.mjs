import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildExtension } from "../scripts/build-extension.mjs";

const runner = new URL("../scripts/run-pinned-wiktextract-ingest.py", import.meta.url);
const evidenceTool = new URL(
  "../scripts/wiktextract_ingest_evidence.py",
  import.meta.url
);
const lockPath = new URL(
  "../lexicon/source-locks/wikimedia-enwiktionary-2026-09-01.json",
  import.meta.url
);
const python = process.env.PYTHON || "python3";

async function makeFixture(t, rows) {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wikt-ingest-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, "parser.db");
  const statements = [
    "CREATE TABLE pages (title TEXT, namespace_id INTEGER, redirect_to TEXT, need_pre_expand INTEGER, body TEXT, model TEXT, PRIMARY KEY(title, namespace_id));",
    ...rows.map(([title, namespaceId]) =>
      `INSERT INTO pages(title, namespace_id, body, model) VALUES (${JSON.stringify(title)}, ${namespaceId}, '', 'wikitext');`
    )
  ].join("\n");
  execFileSync(python, ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit(); c.close()", database, statements]);
  return { database, directory };
}

async function invokeEvidence(database, outputPath) {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const result = spawnSync(
    python,
    [
      evidenceTool.pathname,
      "--database", database,
      "--lock", lockPath.pathname,
      "--source-size", String(lock.artifact.sizeBytes),
      "--source-sha256", lock.artifact.sha256
    ],
    { encoding: "utf8" }
  );
  if (outputPath && result.status === 0) {
    await writeFile(outputPath, result.stdout, "utf8");
  }
  return result;
}

function writeManifestHash(algorithm, bytes, filename) {
  return `${createHash(algorithm).update(bytes).digest("hex")}  ${filename}\n`;
}

async function makeRunnerFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wikt-runner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "enwiktionary-20260901-pages-articles.xml.bz2");
  const bytes = Buffer.from("small source fixture; never parsed\n", "utf8");
  const sha1sums = join(directory, "sha1sums.txt");
  const md5sums = join(directory, "md5sums.txt");
  await writeFile(source, bytes);
  await writeFile(sha1sums, writeManifestHash("sha1", bytes, "enwiktionary-20260901-pages-articles.xml.bz2"));
  await writeFile(md5sums, writeManifestHash("md5", bytes, "enwiktionary-20260901-pages-articles.xml.bz2"));

  const mockBin = join(directory, "bin");
  const gitLog = join(directory, "git.log");
  const git = join(mockBin, "git");
  const work = join(directory, "work");
  const evidence = join(directory, "evidence.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const lockFile = join(directory, "lock.json");
  await mkdir(mockBin);
  await writeFile(git, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$GIT_LOG\"\nexit 99\n");
  await chmod(git, 0o755);
  return {
    directory, source, bytes, sha1sums, md5sums, mockBin, gitLog, work, evidence,
    lock, lockFile, git
  };
}

function runnerArgs(fixture, lockPathname = fixture.lockFile) {
  return [
    runner.pathname,
    "--source", fixture.source,
    "--sha1sums", fixture.sha1sums,
    "--md5sums", fixture.md5sums,
    "--lock", lockPathname,
    "--work-dir", fixture.work,
    "--evidence", fixture.evidence
  ];
}

function spawnRunner(fixture, lockPathname = fixture.lockFile) {
  return spawnSync(
    python,
    runnerArgs(fixture, lockPathname),
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fixture.mockBin}:${process.env.PATH}`,
        GIT_LOG: fixture.gitLog,
        PYTHONDONTWRITEBYTECODE: "1"
      }
    }
  );
}

test("Wiktextract evidence counts real WTP pages by the pinned namespace IDs", async (t) => {
  const fixture = await makeFixture(t, [
    ["water", 0], ["river", 0], ["bank", 0],
    ["Template:en-noun", 10], ["Template:head", 10],
    ["Module:en-headword", 828], ["Module:languages", 828],
    ["Wiktionary talk:Entry", 1], ["Category:English nouns", 14]
  ]);

  const result = await invokeEvidence(fixture.database);

  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(evidence).sort(), [
    "extractor", "parserDb", "schemaVersion", "source"
  ]);
  assert.deepEqual(evidence, {
    schemaVersion: 1,
    source: {
      sourceId: "wikimedia-enwiktionary-20260901",
      sha256: "06acca8138eacb3e8ae9c1d6232f836e37c3bf9b6d582a86693731fe0d336c20",
      sizeBytes: 1632298458
    },
    extractor: {
      wiktextractCommit: "1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a",
      wikitextprocessorCommit: "e3d6d4edb77618f4d6680edc66e3f774bea59820"
    },
    parserDb: {
      bytes: (await stat(fixture.database)).size,
      namespacePageCounts: { main: 3, template: 2, module: 2 }
    }
  });
  assert.ok(Buffer.byteLength(result.stdout) < 2048);
  assert.equal(result.stdout.includes(fixture.directory), false);
  assert.equal(result.stdout.includes("water"), false);
});

test("Wiktextract evidence fails for absent database pages and zero namespace counts", async (t) => {
  const missingModule = await makeFixture(t, [
    ["water", 0], ["Template:en-noun", 10]
  ]);
  const noPages = await makeFixture(t, []);
  const lock = JSON.parse(await readFile(lockPath, "utf8"));

  for (const database of [missingModule.database, noPages.database]) {
    const result = spawnSync(
      python,
      [
        evidenceTool.pathname,
        "--database", database,
        "--lock", lockPath.pathname,
        "--source-size", String(lock.artifact.sizeBytes),
        "--source-sha256", lock.artifact.sha256
      ],
      { encoding: "utf8" }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /non-zero Main, Template, and Module pages/);
    assert.equal(result.stdout, "");
  }

  const absent = spawnSync(
    python,
    [
      evidenceTool.pathname,
      "--database", join(missingModule.directory, "absent.db"),
      "--lock", lockPath.pathname,
      "--source-size", String(lock.artifact.sizeBytes),
      "--source-sha256", lock.artifact.sha256
    ],
    { encoding: "utf8" }
  );
  assert.notEqual(absent.status, 0);
  assert.match(absent.stderr, /parser database is missing or unreadable/);
  assert.equal(absent.stdout, "");
});

test("Wiktextract runner rejects a wrong pinned revision before checkout or parser work", async (t) => {
  const fixture = await makeRunnerFixture(t);
  fixture.lock.extractor.wiktextractCommit = "2a05e46f9efbccda6a2b2f8e21b30a9c0c46513a";
  await writeFile(fixture.lockFile, JSON.stringify(fixture.lock));

  const result = spawnRunner(fixture);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Committed source lock is not the reviewed Wikimedia\/extractor identity/);
  await assert.rejects(stat(fixture.gitLog), { code: "ENOENT" });
  await assert.rejects(stat(fixture.evidence), { code: "ENOENT" });
});

test("Wiktextract runner verifies the full source lock before invoking git or wiktwords", async (t) => {
  const fixture = await makeRunnerFixture(t);
  fixture.lock = JSON.parse(await readFile(lockPath, "utf8"));
  await writeFile(fixture.lockFile, JSON.stringify(fixture.lock));

  const result = spawnRunner(fixture);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Command failed with exit/);
  assert.match(result.stderr, /source-lock-verification\.log/);
  await assert.rejects(stat(fixture.gitLog), { code: "ENOENT" });
  await assert.rejects(stat(fixture.evidence), { code: "ENOENT" });
});

test("pinned checkout verification checks the observed Git HEAD", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wikt-git-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mockBin = join(directory, "bin");
  const logs = join(directory, "logs");
  const checkout = join(directory, "wikitextprocessor");
  const git = join(mockBin, "git");
  const commands = join(directory, "git.commands");
  const root = new URL("../", import.meta.url).pathname;
  const commit = "e3d6d4edb77618f4d6680edc66e3f774bea59820";
  await mkdir(mockBin);
  await mkdir(logs);
  await writeFile(git, [
    "#!/bin/sh",
    "printf '%s\\n' \"$*\" >> \"$GIT_COMMANDS\"",
    "if [ \"$1\" = clone ]; then for target do :; done; mkdir -p \"$target\"; exit 0; fi",
    "if [ \"$1\" = checkout ]; then exit 0; fi",
    "if [ \"$1\" = rev-parse ]; then printf '%s\\n' 0000000000000000000000000000000000000000; exit 0; fi",
    "exit 2"
  ].join("\n") + "\n");
  await chmod(git, 0o755);
  const probe = [
    "import importlib.util, os, pathlib, sys",
    "spec = importlib.util.spec_from_file_location('runner', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "try:",
    "    module.clone_exact_revision(sys.argv[2], 'https://github.com/tatuylonen/wikitextprocessor.git', sys.argv[3], pathlib.Path(sys.argv[4]), pathlib.Path(sys.argv[5]), os.environ.copy())",
    "except RuntimeError as error:",
    "    print(error)",
    "    raise SystemExit(1)",
    "raise SystemExit('wrong HEAD was accepted')"
  ].join("\n");
  const result = spawnSync(
    python,
    ["-c", probe, runner.pathname, git, commit, checkout, logs],
    { encoding: "utf8", env: { ...process.env, GIT_COMMANDS: commands, PYTHONDONTWRITEBYTECODE: "1" } }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /checkout mismatch: expected .* got 0000000000000000000000000000000000000000/);
  assert.match(await readFile(commands, "utf8"), /rev-parse HEAD/);
});

test("installed module verification rejects packages outside their exact source checkouts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wikt-module-origin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mockPython = join(directory, "python-probe");
  const logs = join(directory, "logs");
  const checkout = join(directory, "wiktextract");
  const wtpCheckout = join(directory, "wikitextprocessor");
  await mkdir(logs);
  await mkdir(join(checkout, "src", "wiktextract"), { recursive: true });
  await mkdir(join(wtpCheckout, "src", "wikitextprocessor"), { recursive: true });
  await writeFile(mockPython, "#!/bin/sh\nprintf '%s\\n' \"$ORIGIN_JSON\"\n");
  await chmod(mockPython, 0o755);
  const runProbe = (wiktOrigin, wtpOrigin) => {
    const probe = [
      "import importlib.util, os, pathlib, sys",
      "spec = importlib.util.spec_from_file_location('runner', sys.argv[1])",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "try:",
      "    module.verify_installed_sources(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4]), pathlib.Path(sys.argv[5]), os.environ.copy())",
      "except RuntimeError as error:",
      "    print(error)",
      "    raise SystemExit(1)",
      "print('origins accepted')"
    ].join("\n");
    return spawnSync(
      python,
      ["-c", probe, runner.pathname, mockPython, checkout, wtpCheckout, logs],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ORIGIN_JSON: JSON.stringify({ wiktextract: wiktOrigin, wikitextprocessor: wtpOrigin }),
          PYTHONDONTWRITEBYTECODE: "1"
        }
      }
    );
  };

  const accepted = runProbe(
    join(checkout, "src", "wiktextract", "__init__.py"),
    join(wtpCheckout, "src", "wikitextprocessor", "__init__.py")
  );
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /origins accepted/);

  const rejected = runProbe(
    join(checkout, "src", "wiktextract", "__init__.py"),
    "/usr/lib/python3/dist-packages/wikitextprocessor/__init__.py"
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stdout, /Installed wikitextprocessor module does not come from its exact local checkout/);
});

test("workflow keeps the raw dump and parser DB outside CI artifacts and release output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-wikt-release-tree-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "extension");
  const report = await buildExtension({ outDir: output, allowExternalOutput: true });
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else files.push(child.slice(output.length + 1).replaceAll("\\", "/"));
    }
  }
  await walk(output);

  const [workflow, packageJson] = await Promise.all([
    readFile(new URL("../.github/workflows/wiktextract-ingest.yml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8")
  ]);
  assert.ok(report.fileCount > 0);
  assert.equal(JSON.parse(packageJson).scripts["ingest:wiktextract"], "python3 scripts/run-pinned-wiktextract-ingest.py");
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /--work-dir \/tmp\/wiktextract-ingest-work/);
  assert.match(workflow, /--evidence \/tmp\/wiktextract-ingest-work\/evidence\.json/);
  assert.doesNotMatch(workflow, /actions\/cache@/);
  const uploadSteps = workflow
    .split(/(?=^      - )/m)
    .filter((step) => /uses:\s*actions\/upload-artifact@/.test(step));
  assert.equal(uploadSteps.length, 1);
  assert.match(uploadSteps[0], /^      - name: Upload bounded ingest evidence/m);
  assert.match(uploadSteps[0], /if: success\(\)/);
  assert.match(uploadSteps[0], /path: \/tmp\/wiktextract-ingest-work\/evidence\.json/);
  assert.doesNotMatch(uploadSteps[0], /parser\.sqlite3|\.db|logs|pages-articles\.xml\.bz2|wiktextract-ingest-work\s*$/);
  assert.equal(
    uploadSteps[0].match(/^\s+path:.*$/m)?.[0].trim(),
    "path: /tmp/wiktextract-ingest-work/evidence.json"
  );
  assert.doesNotMatch(workflow, /parser\.sqlite3|pages-articles\.xml\.bz2/);
  assert.equal(files.some((path) => /(?:\.db|\.sqlite3?|pages-articles\.xml\.bz2)$/.test(path)), false);
  assert.equal(files.some((path) => path.startsWith("lexicon/") || path.startsWith("scripts/")), false);

  const workflowSteps = workflow.split(/(?=^      - )/m);
  const lockStep = workflowSteps.find((step) => step.includes("- name: Read locked source URLs"));
  const downloadStep = workflowSteps.find((step) => step.includes("- name: Download dated Wikimedia checksums and dump"));
  const ingestStep = workflowSteps.find((step) => step.includes("- name: Run source-locked pinned Wiktextract first phase"));
  assert.ok(lockStep && downloadStep && ingestStep, "source lock, download, and ingest steps are required");
  assert.match(lockStep, /validateWikimediaSourceLock/);
  assert.ok(
    lockStep.indexOf("validateWikimediaSourceLock") < lockStep.indexOf("artifact_url="),
    "the lock must be validated before its URLs or filename are emitted"
  );
  assert.match(downloadStep, /SOURCE_FILENAME:\s*\$\{\{\s*steps\.source\.outputs\.filename\s*\}\}/);
  assert.match(downloadStep, /--output "\/tmp\/\$SOURCE_FILENAME"/);
  assert.doesNotMatch(downloadStep, /--output[^\n]*\$\{\{/);
  assert.match(ingestStep, /SOURCE_FILENAME:\s*\$\{\{\s*steps\.source\.outputs\.filename\s*\}\}/);
  assert.match(ingestStep, /--source "\/tmp\/\$SOURCE_FILENAME"/);
  assert.doesNotMatch(ingestStep, /--source[^\n]*\$\{\{/);
});
