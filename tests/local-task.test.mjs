import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, freeze, gate, runCheck, fingerprint } from "../scripts/local-task.mjs";

function fixture(t, dependencies = []) {
  const root = mkdtempSync(join(tmpdir(), "tf-local-task-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const save = (path, value) => writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
  const load = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
  mkdirSync(join(root, "docs/tasks/234"), { recursive: true });
  mkdirSync(join(root, "docs/task-execution"), { recursive: true });
  writeFileSync(join(root, "docs/task-execution/.gitignore"), "local/\n");
  writeFileSync(join(root, "docs/tasks/234/task.md"), "# Synthetic task contract\n");
  save("package.json", { scripts: { validate: "node -e \"process.exit(0)\"" } });
  save("docs/tasks/234/state.json", { schema: 1, task: "234", status: "working", dependencies, validationCommands: [["npm", "run", "validate"]], artifactRequired: false });
  save("docs/tasks/234/acceptance.json", {});
  writeFileSync(join(root, "docs/tasks/234/review.md"), "NOT RUN\n");
  save("docs/tasks/index.json", buildIndex(root));
  git("init", "-b", "main"); git("config", "user.name", "Synthetic Test"); git("config", "user.email", "test@example.invalid");
  git("add", "."); git("commit", "-m", "candidate");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  return { root, git, save, load };
}
async function ready(f) {
  const a = freeze(f.root, "234");
  const check = await runCheck(f.root, "234", ["npm", "run", "validate"]);
  assert.equal(check.result, "PASS"); assert.ok(check.durationMs > 0);
  const s = f.load("docs/tasks/234/state.json"); s.status = "ready_to_sync"; s.candidateHead = a.candidateHead;
  f.save("docs/tasks/234/state.json", s);
  f.save("docs/tasks/index.json", buildIndex(f.root));
  writeFileSync(join(f.root, "docs/tasks/234/review.md"), `<!-- local-review ${JSON.stringify({ schema: 1, task: "234", candidateHead: a.candidateHead, result: "PASS", role: "dev_reviewer", independent: true })} -->\nSynthetic reviewer fixture, not a real approval.\n`);
  return a;
}

test("actual commands, monotonic duration and log hash permit only evidence archive commits", async (t) => {
  const f = fixture(t), a = await ready(f);
  assert.equal(gate(f.root, "234").candidateHead, a.candidateHead);
  f.git("add", "docs/tasks"); f.git("commit", "-m", "archive only");
  const result = gate(f.root, "234");
  assert.notEqual(result.syncHead, result.candidateHead);
  assert.equal(result.syncHead, f.git("rev-parse", "HEAD"));
});
test("candidate requires committed clean inputs; later tracked, staged and untracked code rejects", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, "scratch.js"), "export const value = 1;\n");
  assert.throws(() => freeze(f.root, "234"), /Commit the candidate/u);
  rmSync(join(f.root, "scratch.js")); await ready(f);
  writeFileSync(join(f.root, "scratch.js"), "export const value = 2;\n");
  assert.throws(() => gate(f.root, "234"), /Uncommitted/u);
  f.git("add", "scratch.js"); assert.throws(() => gate(f.root, "234"), /Uncommitted/u);
  f.git("commit", "-m", "new code"); assert.throws(() => gate(f.root, "234"), /Code or task contract changed/u);
});
test("freezing refuses a clean branch missing a real current main commit", (t) => {
  const f = fixture(t);
  const newMain = f.git("commit-tree", f.git("rev-parse", "HEAD^{tree}"), "-p", "HEAD", "-m", "main progressed");
  f.git("update-ref", "refs/remotes/origin/main", newMain);
  assert.throws(() => freeze(f.root, "234"));
});
test("task contract and frozen required checks cannot be weakened by metadata archive", async (t) => {
  const f = fixture(t); await ready(f);
  const s = f.load("docs/tasks/234/state.json"); s.dependencies = ["233"]; f.save("docs/tasks/234/state.json", s);
  assert.throws(() => gate(f.root, "234"), /requirements changed/u);
  s.dependencies = []; s.validationCommands = []; f.save("docs/tasks/234/state.json", s);
  assert.throws(() => gate(f.root, "234"), /Full local validate/u);
  s.validationCommands = [["npm", "run", "validate"]]; f.save("docs/tasks/234/state.json", s);
  writeFileSync(join(f.root, "docs/tasks/234/task.md"), "Changed contract\n");
  assert.throws(() => gate(f.root, "234"), /Uncommitted/u);
});
test("missing, self-declared and stale reviewer records reject synchronization", async (t) => {
  const f = fixture(t), a = await ready(f), path = join(f.root, "docs/tasks/234/review.md");
  writeFileSync(path, "NOT RUN\n"); assert.throws(() => gate(f.root, "234"), /review is missing/u);
  for (const fields of [{ role: "main" }, { independent: false }, { candidateHead: "0".repeat(40) }, { result: "CHANGES_REQUESTED" }]) {
    writeFileSync(path, `<!-- local-review ${JSON.stringify({ task: "234", candidateHead: a.candidateHead, result: "PASS", role: "dev_reviewer", independent: true, ...fields })} -->\n`);
    assert.throws(() => gate(f.root, "234"), /stale or not passing/u);
  }
});
test("missing checks, changed logs, stale index and unapproved commands reject", async (t) => {
  const f = fixture(t); await ready(f);
  const a = f.load("docs/tasks/234/acceptance.json"), c = a.checks[0];
  await assert.rejects(() => runCheck(f.root, "234", ["node", "-e", "process.exit(0)"]), /not in task acceptance/u);
  a.checks = []; f.save("docs/tasks/234/acceptance.json", a);
  assert.throws(() => gate(f.root, "234"), /Missing passing check/u);
  a.checks = [c]; f.save("docs/tasks/234/acceptance.json", a);
  writeFileSync(join(f.root, c.log), "tampered\n"); assert.throws(() => gate(f.root, "234"), /Evidence log changed/u);
  f.save("docs/tasks/index.json", {}); assert.throws(() => gate(f.root, "234"), /index is stale/u);
});
test("unfinished dependency rejects synchronization", async (t) => {
  const f = fixture(t, ["233"]);
  mkdirSync(join(f.root, "docs/tasks/233")); f.save("docs/tasks/233/state.json", { task: "233", status: "paused", dependencies: [], mergeHead: f.git("rev-parse", "HEAD") });
  f.save("docs/tasks/index.json", buildIndex(f.root)); f.git("add", "."); f.git("commit", "-m", "dependency");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  await ready(f); assert.throws(() => gate(f.root, "234"), /Dependency 233 is not merged/u);
});
test("completed dependency must actually be on the fetched main ancestry", async (t) => {
  const f = fixture(t, ["233"]), oldMain = f.git("rev-parse", "HEAD");
  mkdirSync(join(f.root, "docs/tasks/233"));
  f.save("docs/tasks/233/state.json", { task: "233", status: "completed", dependencies: [], mergeHead: oldMain });
  f.save("docs/tasks/index.json", buildIndex(f.root)); f.git("add", "."); f.git("commit", "-m", "completed dependency");
  const candidate = await ready(f); assert.equal(gate(f.root, "234").result, "PASS");
  // A real existing commit, but absent from the fetched main ref.
  const other = f.git("commit-tree", f.git("rev-parse", "HEAD^{tree}"), "-m", "unrelated main");
  f.git("update-ref", "refs/remotes/origin/main", other);
  assert.throws(() => gate(f.root, "234"));
  assert.ok(candidate.candidateHead);
});
test("actual nonzero validation exit is FAIL, with measured duration and no passing gate", async (t) => {
  const f = fixture(t);
  f.save("package.json", { scripts: { validate: "node -e \"process.exit(3)\"" } });
  f.git("add", "package.json"); f.git("commit", "-m", "failing validation input");
  const a = freeze(f.root, "234");
  const result = await runCheck(f.root, "234", ["npm", "run", "validate"]);
  assert.equal(result.result, "FAIL"); assert.notEqual(result.exitCode, 0); assert.ok(result.durationMs > 0);
  const s = f.load("docs/tasks/234/state.json"); s.candidateHead = a.candidateHead; f.save("docs/tasks/234/state.json", s);
  f.save("docs/tasks/index.json", buildIndex(f.root));
  assert.throws(() => gate(f.root, "234"), /Missing passing check/u);
});
test("state and index cannot name a different candidate from acceptance and review", async (t) => {
  const f = fixture(t); await ready(f);
  const s = f.load("docs/tasks/234/state.json"); s.candidateHead = "0".repeat(40); f.save("docs/tasks/234/state.json", s);
  f.save("docs/tasks/index.json", buildIndex(f.root));
  assert.throws(() => gate(f.root, "234"), /State candidate/u);
});
test("dangling event links are rejected without creating a file outside the fixture", (t) => {
  const f = fixture(t), outside = mkdtempSync(join(tmpdir(), "tf-local-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(join(f.root, "docs/task-execution/local/234"), { recursive: true });
  const target = join(outside, "must-not-exist.jsonl");
  symlinkSync(target, join(f.root, "docs/task-execution/local/234/events.jsonl"));
  assert.throws(() => freeze(f.root, "234"), /Symlinked/u);
  assert.equal(existsSync(target), false);
});
test("normalized log boundary cannot replace a missing log with a tracked task card", async (t) => {
  const f = fixture(t); await ready(f);
  const a = f.load("docs/tasks/234/acceptance.json"), c = a.checks[0]; rmSync(join(f.root, c.log));
  assert.throws(() => gate(f.root, "234"), /ENOENT/u);
  c.log = "docs/task-execution/local/234/../../../tasks/234/task.md";
  c.logSha256 = createHash("sha256").update(readFileSync(join(f.root, "docs/tasks/234/task.md"))).digest("hex");
  f.save("docs/tasks/234/acceptance.json", a);
  assert.throws(() => gate(f.root, "234"), /Invalid evidence log boundary/u);
});
test("Git assume-unchanged and skip-worktree cannot conceal altered disk input at freeze or gate", async (t) => {
  for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
    const f = fixture(t); writeFileSync(join(f.root, "source.txt"), "version1");
    f.git("add", "source.txt"); f.git("commit", "-m", "source input");
    f.git("update-index", flag, "source.txt"); writeFileSync(join(f.root, "source.txt"), "version2");
    assert.equal(f.git("status", "--porcelain"), "");
    assert.throws(() => freeze(f.root, "234"), /Disk input differs/u);
    writeFileSync(join(f.root, "source.txt"), "version1"); await ready(f);
    writeFileSync(join(f.root, "source.txt"), "version2");
    await assert.rejects(() => runCheck(f.root, "234", ["npm", "run", "validate"]), /Disk input differs/u);
    assert.throws(() => gate(f.root, "234"), /Disk input differs/u);
  }
});
test("artifact fingerprint uses actual bytes and rejects symlink/root escape", (t) => {
  const f = fixture(t); mkdirSync(join(f.root, "dist/extension"), { recursive: true });
  writeFileSync(join(f.root, "dist/extension/manifest.json"), "{}");
  const old = fingerprint(f.root, "dist/extension");
  writeFileSync(join(f.root, "dist/extension/manifest.json"), '{"version":"new"}');
  assert.notEqual(fingerprint(f.root, "dist/extension"), old);
  assert.throws(() => fingerprint(f.root, "../"), /Only actual/u);
  symlinkSync(join(f.root, "package.json"), join(f.root, "dist/extension/link.json"));
  assert.throws(() => fingerprint(f.root, "dist/extension"), /Symlinked/u);
});
test("all workflows are manual-only; original job bodies and manual inputs remain intact", () => {
  const directory = fileURLToPath(new URL("../.github/workflows/", import.meta.url));
  const names = readdirSync(directory).filter((n) => n.endsWith(".yml")); assert.equal(names.length, 11);
  for (const name of names) {
    const text = readFileSync(join(directory, name), "utf8"), block = text.split(/^on:\s*$/mu)[1]?.split(/^permissions:/mu)[0];
    assert.ok(block, name); assert.deepEqual([...block.matchAll(/^  ([a-z_]+):/gmu)].map((m) => m[1]), ["workflow_dispatch"], name);
    assert.match(text, /^jobs:/mu);
  }
  assert.match(readFileSync(join(directory, "dictionary-library-vnext-certification.yml"), "utf8"), /base_sha:/u);
  assert.match(readFileSync(join(directory, "wiktextract-rich-poc.yml"), "utf8"), /run_experimental_full_extraction:/u);
});
