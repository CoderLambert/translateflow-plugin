import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import { pathRelation, assertBuildOutputLocation, assertBuildOutputPaths, assertDisjointPathsOnDisk } from "../scripts/path-boundaries.mjs";
import { buildExtension } from "../scripts/build-extension.mjs";
import { ROOT } from "../scripts/wxt-assets.mjs";

test("exported source root is normalized before any equality comparison", () => {
  assert.equal(ROOT, resolve(ROOT));
  // Pure predicate only: do not call a destructive builder with real source paths.
  for (const alias of [ROOT, `${ROOT}/`, `${ROOT}//`, join(ROOT, "src", "..")]) {
    assert.throws(() => assertBuildOutputLocation(ROOT, alias, { allowExternalOutput: true }), /Unsafe extension output/);
  }
});

test("one relation handles equality, separators, parent segments, drives and UNC", () => {
  for (const [api, root, same, child, parent, sibling] of [
    [posix, "/repo/", "/repo/sub/../", "/repo/dist/package/", "/", "/repo-other"],
    [win32, "C:\\Repo\\", "c:/REPO/sub/../", "C:/Repo/dist/package/", "C:\\", "C:\\Repo-other"],
    [win32, "\\\\server\\share\\repo\\", "\\\\SERVER\\share\\repo", "\\\\server\\share\\repo\\dist\\package", "\\\\server\\share\\", "\\\\server\\share\\repo-other"]
  ]) {
    assert.equal(pathRelation(root, same, api), "same");
    assert.equal(pathRelation(root, child, api), "descendant");
    assert.equal(pathRelation(root, parent, api), "ancestor");
    assert.equal(pathRelation(root, sibling, api), "disjoint");
    for (const candidate of [same, parent, root, api.join(root, "src"), api.join(root, ".git"), api.join(root, "dist")]) {
      assert.throws(() => assertBuildOutputLocation(root, candidate, { pathApi: api, allowExternalOutput: true }), /Unsafe extension output/);
    }
    assert.doesNotThrow(() => assertBuildOutputLocation(root, child, { pathApi: api }));
    assert.doesNotThrow(() => assertBuildOutputLocation(root, api.join(root, ".output/chrome-mv3"), { pathApi: api }));
    assert.throws(() => assertBuildOutputLocation(root, sibling, { pathApi: api }), /Unsafe extension output/);
    assert.doesNotThrow(() => assertBuildOutputLocation(root, sibling, { pathApi: api, allowExternalOutput: true }));
  }
  assert.equal(pathRelation("C:\\repo", "D:\\fixture", win32), "disjoint");
  assert.equal(pathRelation("\\\\server\\share1\\repo", "\\\\server\\share2\\copy", win32), "disjoint");
});

test("disk guard rejects links, missing descendants through links and other workspaces without mutation", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tf-path-boundary-"));
  try {
    const source = join(temp, "source");
    const foreign = join(temp, "foreign");
    await mkdir(source); await mkdir(foreign);
    await writeFile(join(foreign, ".git"), "synthetic worktree marker");
    await writeFile(join(source, "sentinel"), "source retained");
    const link = join(temp, "alias");
    await symlink(source, link, process.platform === "win32" ? "junction" : "dir");
    for (const output of [link, join(link, "missing/package"), foreign, join(foreign, "missing/package")]) {
      await assert.rejects(assertBuildOutputPaths(source, output, { allowExternalOutput: true }), /Unsafe extension output/);
    }
    await assert.rejects(assertDisjointPathsOnDisk(source, link), /symbolic link/);
    await assert.rejects(assertDisjointPathsOnDisk(source, join(link, "missing/package")), /symbolic link/);
    await mkdir(join(source, "dist"));
    await writeFile(join(source, ".git"), "synthetic owning worktree marker");
    const nested = join(source, "dist", "nested-worktree");
    await mkdir(nested); await writeFile(join(nested, ".git"), "synthetic foreign worktree marker");
    await writeFile(join(nested, "keep"), "foreign source retained");
    await assert.rejects(assertBuildOutputPaths(source, nested), /another Git workspace/);
    await assert.rejects(assertBuildOutputPaths(source, join(nested, "missing/package")), /another Git workspace/);
    assert.equal(await readFile(join(nested, "keep"), "utf8"), "foreign source retained");
    assert.equal(await assertBuildOutputPaths(source, join(source, "dist", "package")), join(source, "dist", "package"));
    await symlink(foreign, join(source, "dist", "redirect"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(assertBuildOutputPaths(source, join(source, "dist", "redirect", "new")), /symbolic link/);
    await writeFile(join(source, "dist", "file"), "not a directory");
    await assert.rejects(assertBuildOutputPaths(source, join(source, "dist", "file", "new")), /not a directory/);
    assert.equal(await readFile(join(source, "sentinel"), "utf8"), "source retained");
    assert.equal(await assertBuildOutputPaths(source, join(temp, "new/package"), { allowExternalOutput: true }), join(temp, "new/package"));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("real builder writes only disposable output; alias rejection preserves a disposable sentinel", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tf-safe-build-"));
  try {
    const output = join(temp, "package");
    const report = await buildExtension({ outDir: output, allowExternalOutput: true });
    assert.equal(report.output, output);
    assert.equal(JSON.parse(await readFile(join(output, "manifest.json"), "utf8")).manifest_version, 3);
    const victim = join(temp, "sentinel-directory");
    await mkdir(victim); await writeFile(join(victim, "keep"), "retained");
    const alias = join(temp, "alias");
    await symlink(victim, alias, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(buildExtension({ outDir: alias, allowExternalOutput: true }), /symbolic link/);
    assert.equal(await readFile(join(victim, "keep"), "utf8"), "retained");
  } finally { await rm(temp, { recursive: true, force: true }); }
});
