import test from "node:test";
import assert from "node:assert/strict";
import { getCacheContext } from "../src/background/cache-db.js";

const legacyCompatibleConfig = {
  model: "deepseek-flash",
  targetLanguage: "Simplified Chinese",
  prompt: "same prompt"
};

test("adding the default provider field does not invalidate v0.3 cache identity", async () => {
  const before = await getCacheContext("https://example.com/docs?utm_source=x&id=1", legacyCompatibleConfig);
  const after = await getCacheContext("https://example.com/docs?id=1", {
    ...legacyCompatibleConfig,
    provider: "deepseek"
  });
  assert.equal(before.pageConfigKey, after.pageConfigKey);
});
