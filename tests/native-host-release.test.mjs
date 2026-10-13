import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeHostLdflags, validateNativeHostReleaseInput } from "../scripts/build-native-host-candidate.mjs";
import { assertOwnedOutputPath } from "../scripts/path-boundaries.mjs";

const id = "abcdefghijklmnopabcdefghijklmnop";

test("native host candidate requires an exact store identity and semantic version", () => {
  assert.deepEqual(validateNativeHostReleaseInput(id, "0.8.0"), { extensionId: id, version: "0.8.0" });
  for (const candidate of ["", "short", `${id}a`, id.replace("a", "q")]) {
    assert.throws(() => validateNativeHostReleaseInput(candidate, "0.8.0"), /Chrome Web Store ID/u);
  }
  for (const version of ["", "dev", "v0.8.0", "0.8", "01.0.0", "9007199254740992.0.0"]) {
    assert.throws(() => validateNativeHostReleaseInput(id, version), /exact safe x\.y\.z/u);
  }
  assert.throws(() => validateNativeHostReleaseInput([id], "0.8.0"), /Chrome Web Store ID/u);
  assert.throws(() => validateNativeHostReleaseInput(id, ["0.8.0"]), /exact safe x\.y\.z/u);
});

test("native host candidate rejects symlinked output before any artifact write", async t => {
  const temp = await mkdtemp(join(tmpdir(), "tf-native-candidate-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const source = join(temp, "source");
  const boundary = join(source, ".output");
  const outside = join(temp, "outside");
  await mkdir(boundary, { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, "keep"), "retained");
  await symlink(outside, join(boundary, "native-host-candidate"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(assertOwnedOutputPath(source, boundary, join(boundary, "native-host-candidate")), /symbolic link/u);
  assert.equal(await readFile(join(outside, "keep"), "utf8"), "retained");
});

test("native host candidate pins the store ID and host version into both binaries", () => {
  const flags = nativeHostLdflags(id, "0.8.0");
  assert.match(flags, new RegExp(`main\\.pinnedExtensionID=${id}`, "u"));
  assert.match(flags, /main\.version=0\.8\.0/u);
});
