import path from "node:path";
import { lstat, realpath, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";

// Relations include equality. Never compare raw path strings or slash prefixes.
export function pathRelation(parent, candidate, pathApi = path) {
  const root = pathApi.resolve(parent);
  const target = pathApi.resolve(candidate);
  const within = pathApi.relative(root, target);
  if (within === "") return "same";
  if (!pathApi.isAbsolute(within) && within !== ".." && !within.startsWith(`..${pathApi.sep}`)) return "descendant";
  const reverse = pathApi.relative(target, root);
  if (!pathApi.isAbsolute(reverse) && reverse !== ".." && !reverse.startsWith(`..${pathApi.sep}`)) return "ancestor";
  return "disjoint";
}

export function assertDisjointPaths(source, destination, pathApi = path) {
  if (pathRelation(source, destination, pathApi) !== "disjoint") {
    throw new Error("Test copy must be isolated from the production artifact");
  }
}

export function assertBuildOutputLocation(sourceRoot, output, { allowExternalOutput = false, allowWxtOutput = false, pathApi = path } = {}) {
  const root = pathApi.resolve(sourceRoot);
  const target = pathApi.resolve(output);
  const relation = pathRelation(root, target, pathApi);
  const inDist = pathRelation(pathApi.join(root, "dist"), target, pathApi) === "descendant";
  const wxtPackage = allowWxtOutput && pathRelation(pathApi.join(root, ".output", "chrome-mv3"), target, pathApi) === "same";
  if (relation === "same" || relation === "ancestor" || target === pathApi.parse(target).root
    || relation === "descendant" && !inDist && !wxtPackage
    || relation === "disjoint" && !allowExternalOutput) {
    throw new Error("Unsafe extension output: use a package directory under dist/ or an isolated test directory");
  }
  return target;
}

async function optionalLstat(target) {
  try { return await lstat(target); }
  catch (error) { if (error.code !== "ENOENT") throw error; return null; }
}

// realpath also protects a not-yet-created output by resolving its existing parent.
export async function canonicalPath(target) {
  let current = path.resolve(target);
  const missing = [];
  for (;;) {
    const entry = await optionalLstat(current);
    if (entry) return path.resolve(await realpath(current), ...missing.reverse());
    const parent = path.dirname(current);
    if (parent === current) throw new Error("No existing filesystem root");
    missing.push(path.basename(current));
    current = parent;
  }
}

export async function assertBuildOutputPaths(sourceRoot, output, options = {}) {
  const target = assertBuildOutputLocation(sourceRoot, output, options);
  const external = pathRelation(sourceRoot, target) === "disjoint";
  const ownershipRoot = external
    ? await temporaryWriteRoot(target, "Unsafe extension output: external test output must be below the temporary directory")
    : path.resolve(sourceRoot);
  await assertDirectoryWritePath(target, ownershipRoot);
  await assertDisposableOutputTree(target);
  assertBuildOutputLocation(await canonicalPath(sourceRoot), await canonicalPath(target), options);
  return target;
}

async function temporaryWriteRoot(target, failureMessage) {
  const temporaryRoot = path.resolve(tmpdir());
  if (pathRelation(temporaryRoot, target) === "descendant") return temporaryRoot;
  const canonicalRoot = await realpath(temporaryRoot);
  if (pathRelation(canonicalRoot, target) !== "descendant") throw new Error(failureMessage);
  return canonicalRoot;
}

async function assertDirectoryWritePath(target, ownershipRoot) {
  // Resolve the trusted source/OS-temp boundary, then inspect links below it.
  const canonicalRoot = await realpath(ownershipRoot);
  if (!(await lstat(canonicalRoot)).isDirectory()) throw new Error("Unsafe extension output: ownership root is not a directory");
  let current = target;
  while (pathRelation(ownershipRoot, current) === "descendant") {
    const entry = await optionalLstat(current);
    if (entry?.isSymbolicLink()) throw new Error("Unsafe extension output: symbolic link in output path");
    if (entry && !entry.isDirectory()) throw new Error("Unsafe extension output: output path is not a directory");
    // The owning source/temp root may have metadata; nested Git workspaces are not ours.
    if (await optionalLstat(path.join(current, ".git"))) {
      throw new Error("Unsafe extension output: destination belongs to another Git workspace");
    }
    const parent = path.dirname(current);
    current = parent;
  }
}

async function assertDisposableOutputTree(target) {
  const entry = await optionalLstat(target);
  if (!entry) return;
  if (entry.isSymbolicLink()) throw new Error("Unsafe extension output: symbolic link in output tree");
  if (!entry.isDirectory()) return;
  for (const child of await readdir(target)) {
    if (child.toLowerCase() === ".git") throw new Error("Unsafe extension output: output tree contains a Git workspace");
    await assertDisposableOutputTree(path.join(target, child));
  }
}

export async function assertDisjointPathsOnDisk(source, destination) {
  assertDisjointPaths(source, destination);
  const target = path.resolve(destination);
  const temporaryRoot = await temporaryWriteRoot(target, "Unsafe extension output: test copy must be below the temporary directory");
  await assertDirectoryWritePath(target, temporaryRoot);
  await assertDisposableOutputTree(target);
  assertDisjointPaths(await canonicalPath(source), await canonicalPath(destination));
}
