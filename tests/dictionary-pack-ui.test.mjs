import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describeBundledPackState, getBundledPackPresentation, requestDictionaryPackOriginPermission } from "../src/options/pack-ui.js";

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

test("Settings presents bundled lexicon health as scannable status metadata", async () => {
  assert.deepEqual(getBundledPackPresentation({
    status: "ready",
    packVersion: "locked-v1",
    recordCount: 1234
  }), {
    kind: "success",
    label: "已就绪",
    meta: ["版本 locked-v1", "1,234 条记录"],
    detail: ""
  });

  assert.equal(getBundledPackPresentation({ status: "unavailable" }).label, "资源缺失");
  assert.equal(getBundledPackPresentation({ status: "corrupt" }).label, "校验失败");
  assert.equal(getBundledPackPresentation({ status: "incompatible" }).kind, "warning");
  assert.equal(getBundledPackPresentation({ status: "unhealthy" }).label, "健康检查失败");
  assert.equal(getBundledPackPresentation({ status: "unknown", message: "probe failed" }).detail, "probe failed");

  assert.match(describeBundledPackState({
    status: "ready",
    packVersion: "locked-v1",
    recordCount: 1234
  }), /已就绪.*版本 locked-v1.*1,234 条记录/);
  assert.doesNotMatch(describeBundledPackState({ status: "unavailable" }), /npm run setup:lexicon/);

  const source = await readFile(new URL("../src/options/pack-ui.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../options.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../options.css", import.meta.url), "utf8");
  assert.match(source, /BUNDLED_LEXICON_STATUS/);
  assert.match(source, /dictionary-health-badge/);
  assert.match(source, /暂无官方推荐词典/);
  assert.match(html, /AI 详解深度/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /dictionary-repair-help/);
  assert.match(html, /npm run setup:lexicon/);
  assert.doesNotMatch(html, /FreeDict eng-zho 2025\.11\.23/);
  assert.match(css, /dictionary-health-badge\[data-kind="success"\]/);
  assert.match(css, /dictionary-health-badge\[data-kind="warning"\]/);
  assert.match(css, /dictionary-health-badge\[data-kind="error"\]/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /\.site-row\s*\{[\s\S]*grid-template-columns:\s*1fr/);
});
