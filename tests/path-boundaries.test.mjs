import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import { pathRelation, assertBuildOutputLocation, assertBuildOutputPaths, assertDisjointPathsOnDisk } from "../scripts/path-boundaries.mjs";
import { buildExtension } from "../scripts/build-extension.mjs";
import { ROOT } from "../scripts/wxt-assets.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
    assert.throws(() => assertBuildOutputLocation(root, api.join(root, ".output/chrome-mv3"), { pathApi: api }), /Unsafe extension output/);
    assert.doesNotThrow(() => assertBuildOutputLocation(root, api.join(root, ".output/chrome-mv3"), { pathApi: api, allowWxtOutput: true }));
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
    const packagePath = join(source, "dist", "package");
    await mkdir(join(packagePath, "deep", "foreign"), { recursive: true });
    await writeFile(join(packagePath, "deep", "foreign", ".git"), "synthetic nested worktree");
    await writeFile(join(packagePath, "deep", "foreign", "keep"), "nested source retained");
    await assert.rejects(assertBuildOutputPaths(source, packagePath), /output tree contains a Git workspace/);
    const copy = join(temp, "copy");
    await mkdir(join(copy, "deep", "foreign"), { recursive: true });
    await writeFile(join(copy, "deep", "foreign", ".git"), "synthetic nested worktree");
    await assert.rejects(assertDisjointPathsOnDisk(source, copy), /output tree contains a Git workspace/);
    assert.equal(await readFile(join(packagePath, "deep", "foreign", "keep"), "utf8"), "nested source retained");
    await symlink(foreign, join(source, "dist", "redirect"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(assertBuildOutputPaths(source, join(source, "dist", "redirect", "new")), /symbolic link/);
    await writeFile(join(source, "dist", "file"), "not a directory");
    await assert.rejects(assertBuildOutputPaths(source, join(source, "dist", "file", "new")), /not a directory/);
    assert.equal(await readFile(join(source, "sentinel"), "utf8"), "source retained");
    assert.equal(await assertBuildOutputPaths(source, join(temp, "new/package"), { allowExternalOutput: true }), join(temp, "new/package"));
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("trusted OS temporary root permits system aliases", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tf-temp-root-alias-"));
  try {
    const real = join(temp, "real"); await mkdir(join(real, "folders"), { recursive: true });
    await mkdir(join(temp, "source"));
    await symlink(real, join(temp, "system-alias"), process.platform === "win32" ? "junction" : "dir");
    const temporaryRoot = join(temp, "system-alias", "folders");
    await symlink(join(temp, "source"), join(temporaryRoot, "redirect"), process.platform === "win32" ? "junction" : "dir");
    const code = `import assert from "node:assert/strict";
      import { join } from "node:path";
      import { assertBuildOutputPaths, assertDisjointPathsOnDisk } from ${JSON.stringify(new URL("../scripts/path-boundaries.mjs", import.meta.url).href)};
      const source = process.argv[1];
      for (const root of process.argv.slice(2)) {
        await assertBuildOutputPaths(source, join(root, "package"), {allowExternalOutput:true});
        await assertDisjointPathsOnDisk(source, join(root, "copy"));
        await assert.rejects(assertBuildOutputPaths(source, root, {allowExternalOutput:true}), /below the temporary directory/);
        await assert.rejects(assertDisjointPathsOnDisk(source, root), /below the temporary directory/);
        await assert.rejects(assertBuildOutputPaths(source, join(root, "redirect", "missing"), {allowExternalOutput:true}), /symbolic link/);
        await assert.rejects(assertDisjointPathsOnDisk(source, join(root, "redirect", "missing")), /symbolic link/);
      }`;
    await promisify(execFile)(process.execPath, ["--input-type=module", "-e", code, join(temp, "source"), temporaryRoot, join(real, "folders")],
      { env: { ...process.env, TMPDIR: temporaryRoot, TMP: temporaryRoot, TEMP: temporaryRoot } });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("real builder writes only disposable output; alias rejection preserves a disposable sentinel", async () => {
  const temp = await mkdtemp(join(tmpdir(), "tf-safe-build-"));
  try {
    const output = join(temp, "package");
    const report = await buildExtension({ outDir: output, allowExternalOutput: true });
    assert.equal(report.output, output);
    assert.equal(report.builder, "WXT");
    assert.doesNotMatch(await readFile(join(output, "background.js"), "utf8"), /from ["']\.\/src\/background\/index\.js/);
    assert.match(await readFile(join(output, "options.html"), "utf8"), /chunks\/options-/);
    assert.equal(JSON.parse(await readFile(join(output, "manifest.json"), "utf8")).manifest_version, 3);
    const victim = join(temp, "sentinel-directory");
    await mkdir(victim); await writeFile(join(victim, "keep"), "retained");
    const alias = join(temp, "alias");
    await symlink(victim, alias, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(buildExtension({ outDir: alias, allowExternalOutput: true }), /symbolic link/);
    assert.equal(await readFile(join(victim, "keep"), "utf8"), "retained");
    const nested = join(output, "deep", "foreign");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, ".git"), "synthetic nested worktree");
    await writeFile(join(nested, "keep"), "nested source retained");
    await assert.rejects(buildExtension({ outDir: output, allowExternalOutput: true }), /output tree contains a Git workspace/);
    await assert.rejects(assertDisjointPathsOnDisk(victim, output), /output tree contains a Git workspace/);
    assert.equal(await readFile(join(nested, "keep"), "utf8"), "nested source retained");
    await rm(join(nested, ".git"));
    await symlink(victim, join(nested, "redirect"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(buildExtension({ outDir: output, allowExternalOutput: true }), /symbolic link in output tree/);
    await assert.rejects(assertDisjointPathsOnDisk(victim, output), /symbolic link in output tree/);
    assert.equal(await readFile(join(nested, "keep"), "utf8"), "nested source retained");
    assert.equal(await readFile(join(victim, "keep"), "utf8"), "retained");
  } finally { await rm(temp, { recursive: true, force: true }); }
});
