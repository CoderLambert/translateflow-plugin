import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COMMANDS, isSupportedPage } from "../src/background/commands.js";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

test("manifest exposes exactly the three v0.8 commands", () => {
  assert.deepEqual(Object.keys(manifest.commands).sort(), Object.values(COMMANDS).sort());
  assert.equal(manifest.permissions.includes("activeTab"), true);
  assert.equal(manifest.permissions.includes("scripting"), true);
  assert.deepEqual(manifest.host_permissions, ["https://api.deepseek.com/*"]);
});

test("command routing accepts only normal web pages", () => {
  assert.equal(isSupportedPage("https://example.com/docs"), true);
  assert.equal(isSupportedPage("http://localhost:3000"), true);
  assert.equal(isSupportedPage("chrome://extensions/"), false);
  assert.equal(isSupportedPage("file:///tmp/test.html"), false);
  assert.equal(isSupportedPage("not a url"), false);
});
