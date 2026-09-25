import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const release = await readFile(new URL("../docs/RELEASE_V0.8.md", import.meta.url), "utf8");
const youtube = await readFile(new URL("../docs/YOUTUBE_SUBTITLES.md", import.meta.url), "utf8");

test("v0.8 release metadata stays aligned", () => {
  assert.equal(manifest.version, "0.8.0");
  assert.equal(pkg.version, "0.8.0");
  assert.match(readme, /^# TranslateFlow v0\.8/m);
  assert.match(release, /TranslateFlow v0\.8 Release Gate/);
});

test("production permissions remain narrow", () => {
  assert.deepEqual(manifest.permissions, ["storage", "activeTab", "scripting"]);
  assert.deepEqual(manifest.host_permissions, ["https://api.deepseek.com/*"]);
  assert.ok(manifest.optional_host_permissions.includes("http://*/*"));
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
  assert.ok(!manifest.host_permissions.some((pattern) => /youtube\.com/i.test(pattern)));
});

test("release docs describe the final YouTube acquisition architecture", () => {
  assert.match(youtube, /MAIN-world player\/timedtext bridge/);
  assert.match(youtube, /player(?:-owned|\x27s own).*timedtext/i);
  assert.match(youtube, /TextTrack fallback/);
  assert.match(release, /PENDING manual/);
  assert.doesNotMatch(readme, /PDF、视频双语字幕尚未实现/);
});
