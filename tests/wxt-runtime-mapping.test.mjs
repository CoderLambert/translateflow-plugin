import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { assertRuntimeMapping, mappingForGeneration, preSwitchRuntimeMapping } from "../e2e/support/runtime-mapping.mjs";

test("pre-switch 19e mapping is frozen with exact Git source identities and order", async () => {
  const bytes = await readFile(new URL("../e2e/support/19e89b6-runtime-mapping.json", import.meta.url));
  const frozen = JSON.parse(bytes);
  assert.equal(frozen.sourceCommit, "19e89b65fd3600073410407392da82ffa666ffc8");
  assert.deepEqual(frozen.sourceFiles.map(file => file.gitBlob),
    ["7e5a25ffbc98cefda828c09dfc96006977b42eb8", "0628bc76a82ecf2ca1b8c98be25fa236a44dea60"]);
  assert.equal(frozen.contentScripts.length, 48); assert.equal(frozen.contentScripts.at(-1), "content.js");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "21eb874a9db5abf840537398dbf4fe9ed49b3338defed1b4e76ad1ed0dde1d35");
  assert.deepEqual(mappingForGeneration("pre-switch-19e"), frozen);
  assert.throws(() => mappingForGeneration("unknown"));
});

test("a legitimate new resource is required for new closure but cannot be demanded of the immutable old mapping", () => {
  const manifest = { background: { service_worker: "background.js" } };
  const old = preSwitchRuntimeMapping;
  const paths = new Set(["manifest.json", "background.js", ...Object.values(old.extensionPages),
    ...old.contentScripts, ...old.contentStyles, ...Object.values(old.workers), ...old.mainFiles]);
  const current = mappingForGeneration("current");
  const future = { ...current, contentScripts: [...current.contentScripts, "src/content/new-approved-resource.js"] };
  assert.doesNotThrow(() => assertRuntimeMapping(paths, manifest, old));
  assert.throws(() => assertRuntimeMapping(paths, manifest, current), /learning-center/u);
  for (const resource of Object.values(current.extensionPages)) paths.add(resource);
  assert.throws(() => assertRuntimeMapping(paths, manifest, current), /src\/content\//u);
  for (const resource of current.contentScripts) paths.add(resource);
  assert.throws(() => assertRuntimeMapping(paths, manifest, future), /new-approved-resource/u);
  paths.add("src/content/new-approved-resource.js");
  assert.doesNotThrow(() => assertRuntimeMapping(paths, manifest, future));
  paths.delete(old.workers.mddResourceImport);
  assert.throws(() => assertRuntimeMapping(paths, manifest, old), /mdd-resource-import-worker/u);
});
