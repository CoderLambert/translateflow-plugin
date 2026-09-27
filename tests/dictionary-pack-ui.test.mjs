import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { requestDictionaryPackOriginPermission } from "../src/options/pack-ui.js";

test("Settings requests only the exact trusted optional-pack origin", async () => {
  const calls = [];
  const source = {
    originPattern: "https://packs.example.test/*"
  };
  const granted = await requestDictionaryPackOriginPermission(source, {
    async request(input) {
      calls.push(input);
      return true;
    }
  });

  assert.equal(granted, true);
  assert.deepEqual(calls, [{ origins: ["https://packs.example.test/*"] }]);
});

test("pack permission helper rejects broad, path-scoped and insecure production patterns", async () => {
  const permissions = {
    request: async () => true
  };
  await assert.rejects(
    requestDictionaryPackOriginPermission({ originPattern: "https://*/*" }, permissions),
    /exact trusted origin/
  );
  await assert.rejects(
    requestDictionaryPackOriginPermission({ originPattern: "https://packs.example.test/releases/*" }, permissions),
    /exact trusted origin/
  );
  await assert.rejects(
    requestDictionaryPackOriginPermission({ originPattern: "http://packs.example.test/*" }, permissions),
    /exact trusted origin/
  );
});

test("pack permission helper permits explicit insecure localhost only for development evidence", async () => {
  let requested;
  const granted = await requestDictionaryPackOriginPermission({
    originPattern: "http://127.0.0.1:8123/*",
    allowInsecureLocalhost: true
  }, {
    async request(input) {
      requested = input;
      return true;
    }
  });
  assert.equal(granted, true);
  assert.deepEqual(requested, { origins: ["http://127.0.0.1:8123/*"] });
});

test("pack Settings surface keeps permission request on the options user-gesture path", async () => {
  const source = await readFile(new URL("../src/options/pack-ui.js", import.meta.url), "utf8");
  const options = await readFile(new URL("../options.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../options.html", import.meta.url), "utf8");

  assert.match(source, /permissions\.request\(\{ origins: \[pattern\] \}\)/);
  assert.match(source, /DICTIONARY_PACK_INSTALL/);
  assert.match(source, /DICTIONARY_PACK_CANCEL/);
  assert.match(source, /DICTIONARY_PACK_ROLLBACK/);
  assert.match(source, /DICTIONARY_PACK_UNINSTALL/);
  assert.match(options, /initializePackUi\(\{ setStatus \}\)/);
  assert.match(html, /id="dictionary-packs"/);
});
