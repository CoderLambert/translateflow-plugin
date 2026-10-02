import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { e2eEnvironment, requireE2EArtifact } from "../scripts/run-e2e.mjs";

test("local E2E defaults exactly to WXT and explicit CI legacy also selects matching locale", () => {
  assert.deepEqual(e2eEnvironment({}), { TF_E2E_ARTIFACT: ".output/chrome-mv3", TF_I18N_ARTIFACT: ".output/chrome-mv3" });
  assert.deepEqual(e2eEnvironment({ TF_E2E_ARTIFACT: "dist/extension" }),
    { TF_E2E_ARTIFACT: "dist/extension", TF_I18N_ARTIFACT: "dist/extension" });
  assert.equal(e2eEnvironment({ TF_E2E_ARTIFACT: "own/package", TF_I18N_ARTIFACT: "own/locale" }).TF_I18N_ARTIFACT, "own/locale");
  assert.throws(() => e2eEnvironment({ TF_E2E_ARTIFACT: "" }));
});

test("missing selected WXT fails despite a leftover old package and never builds a replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "tf-e2e-entry-"));
  try {
    await mkdir(join(root, "dist/extension"), { recursive: true });
    await writeFile(join(root, "dist/extension/manifest.json"), "{}");
    await assert.rejects(requireE2EArtifact(e2eEnvironment({}), root), error => error.code === "ENOENT");
    assert.equal(await requireE2EArtifact(e2eEnvironment({ TF_E2E_ARTIFACT: "dist/extension" }), root), join(root, "dist/extension"));
    const result = spawnSync(process.execPath, ["scripts/run-e2e.mjs", "e2e/rich-mdict-product.spec.mjs"],
      { env: { ...process.env, TF_E2E_ARTIFACT: join(root, "missing") }, encoding: "utf8", timeout: 3000 });
    assert.equal(result.status, 1); assert(!result.error);
    assert.match(result.stderr, /ENOENT/); assert(!result.stdout.includes("Running"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
