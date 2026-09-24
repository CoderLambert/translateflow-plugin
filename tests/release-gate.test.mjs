import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const e2eDoc = await readFile(new URL("../docs/E2E.md", import.meta.url), "utf8");
const release = await readFile(new URL("../docs/RELEASE_V0.8.md", import.meta.url), "utf8");

test("v0.8 release metadata and public docs agree", () => {
  assert.equal(manifest.version, "0.8.0");
  assert.equal(pkg.version, "0.8.0");
  assert.match(readme, /^# TranslateFlow v0\.8/m);
  assert.match(readme, /YouTube 双语字幕/);
  assert.match(readme, /Quick Control/);
  assert.doesNotMatch(readme, /PDF、视频双语字幕尚未实现/);
});

test("release keeps required permissions narrow", () => {
  assert.deepEqual(manifest.permissions, ["storage", "activeTab", "scripting"]);
  assert.deepEqual(manifest.host_permissions, ["https://api.deepseek.com/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
});

test("release checklist maps automated and manual certification surfaces", () => {
  for (const phrase of [
    "Web reading", "Popup", "Commands", "Settings", "Subtitle source",
    "YouTube renderer", "Accessibility/UX", "Permissions"
  ]) assert.match(release, new RegExp(phrase));
  assert.match(release, /PENDING manual/);
  assert.match(release, /Do not mark Issue #28 audited\/release-ready/);
  assert.match(e2eDoc, /v0\.8 smoke flows/i);
});
