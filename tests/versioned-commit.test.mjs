import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, mkdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextCommitVersion, prepareVersionedCommit } from "../scripts/prepare-versioned-commit.mjs";
const exec = promisify(execFile);
const git = async (root, ...args) => (await exec("git", args, { cwd: root })).stdout.trim();
const json = (root, path) => readFile(join(root, path), "utf8").then(JSON.parse);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "tf-commit-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, "init", "-q"); await git(root, "config", "user.name", "Synthetic test"); await git(root, "config", "user.email", "test@example.invalid");
  for (const [path, value] of Object.entries({ "package.json": { name: "synthetic", version: "0.8.1", description: "initial" }, "package-lock.json": { version: "0.8.1", packages: { "": { name: "synthetic", version: "0.8.1" }, dependency: { version: "99.0.0" } } }, "manifest.json": { manifest_version: 3, version: "0.8.1" }, "source.js": "initial", "README.md": "# TranslateFlow v0.8.1\n\nSynthetic documentation.\n" })) {
    await writeFile(join(root, path), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
  }
  await git(root, "add", "."); await git(root, "-c", "core.hooksPath=/dev/null", "commit", "-qm", "synthetic baseline"); return root;
}
const build = async snapshot => {
  await mkdir(join(snapshot, "dist/extension"), { recursive: true });
  await writeFile(join(snapshot, "dist/extension/manifest.json"), JSON.stringify(await json(snapshot, "manifest.json")));
};
test("commit versions increment patch, preserve explicit forward bumps and reject rollback", () => {
  assert.equal(nextCommitVersion("0.8.1", "0.8.1"), "0.8.2");
  assert.equal(nextCommitVersion("0.8.1", "0.9.0"), "0.9.0");
  assert.throws(() => nextCommitVersion("0.8.2", "0.8.1"), /older/);
  assert.throws(() => nextCommitVersion("0.8.65535", "0.8.65535"), /exhausted/);
});
test("explicit version preparation compiles the index and preserves unrelated unstaged changes", async t => {
  const root = await fixture(t);
  const staged = { ...await json(root, "package.json"), description: "staged description" };
  await writeFile(join(root, "package.json"), JSON.stringify(staged, null, 2) + "\n"); await git(root, "add", "package.json");
  await writeFile(join(root, "package.json"), JSON.stringify({ ...staged, description: "unstaged description" }, null, 2) + "\n");
  await writeFile(join(root, "source.js"), "unstaged source");
  const result = await prepareVersionedCommit({ root, build: async snapshot => {
    assert.equal((await json(snapshot, "package.json")).description, "staged description");
    assert.equal(await readFile(join(snapshot, "source.js"), "utf8"), "initial"); await build(snapshot);
  } });
  assert.equal(result.version, "0.8.2");
  assert.equal((await json(root, "package.json")).description, "unstaged description");
  const indexed = JSON.parse(await git(root, "show", ":package.json"));
  assert.equal(indexed.description, "staged description"); assert.equal(indexed.version, "0.8.2");
  assert.equal((await json(root, "package-lock.json")).packages.dependency.version, "99.0.0");
  assert.equal((await json(root, "dist/extension/manifest.json")).version, "0.8.2");
  assert.match(await readFile(join(root, "README.md"), "utf8"), /^# TranslateFlow v0\.8\.2/m);
  assert.equal(await git(root, "show", ":source.js"), "initial");
});
test("failed compilation leaves versions and index untouched", async t => {
  const root = await fixture(t), tree = await git(root, "write-tree");
  await assert.rejects(prepareVersionedCommit({ root, build: async () => { throw new Error("synthetic compile failure"); } }), /compile failure/);
  assert.equal(await git(root, "write-tree"), tree); assert.equal((await json(root, "manifest.json")).version, "0.8.1");
});
test("preview builds without mutating the index or working versions", async t => {
  const root = await fixture(t), tree = await git(root, "write-tree");
  const result = await prepareVersionedCommit({ root, preview: true, build });
  assert.equal(result.version, "0.8.2"); assert.equal(await git(root, "write-tree"), tree);
  assert.equal((await json(root, "package.json")).version, "0.8.1");
});
test("concurrent staging is detected after compilation without overwriting user changes", async t => {
  const root = await fixture(t);
  await assert.rejects(prepareVersionedCommit({ root, build: async snapshot => {
    await build(snapshot); await writeFile(join(root, "source.js"), "new staged source"); await git(root, "add", "source.js");
  } }), /index changed/);
  assert.equal(await git(root, "show", ":source.js"), "new staged source"); assert.equal((await json(root, "package.json")).version, "0.8.1");
});
test("an unstaged manual version choice is preserved and requires explicit staging", async t => {
  const root = await fixture(t), tree = await git(root, "write-tree");
  const pkg = await json(root, "package.json");
  await writeFile(join(root, "package.json"), JSON.stringify({ ...pkg, version: "0.9.0" }, null, 2) + "\n");
  await assert.rejects(prepareVersionedCommit({ root, build: () => assert.fail("must reject before compilation") }), /Stage the manual version/);
  assert.equal(await git(root, "write-tree"), tree); assert.equal((await json(root, "package.json")).version, "0.9.0");
});
test("ordinary commits preserve versions and skip compilation while rejecting staged whitespace errors", async t => {
  const root = await fixture(t);
  await mkdir(join(root, ".githooks"));
  const hook = join(root, ".githooks/pre-commit");
  await writeFile(hook, await readFile(new URL("../.githooks/pre-commit", import.meta.url)));
  await chmod(hook, 0o755);
  await git(root, "config", "core.hooksPath", ".githooks");
  await writeFile(join(root, "notes.md"), "Evidence archive\n");
  await git(root, "add", "notes.md");
  await git(root, "commit", "-qm", "archive evidence without changing product version");
  assert.equal((await json(root, "package.json")).version, "0.8.1");
  assert.equal((await json(root, "manifest.json")).version, "0.8.1");
  await assert.rejects(readFile(join(root, "dist/extension/manifest.json")), { code: "ENOENT" });
  const head = await git(root, "rev-parse", "HEAD");
  await writeFile(join(root, "notes.md"), "Invalid trailing whitespace \n");
  await git(root, "add", "notes.md");
  await assert.rejects(git(root, "commit", "-qm", "must reject whitespace"));
  assert.equal(await git(root, "rev-parse", "HEAD"), head);
});
