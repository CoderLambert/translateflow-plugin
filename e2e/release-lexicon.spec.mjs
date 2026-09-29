import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "./support/extension-fixture.mjs";

const releaseRoot = join(process.cwd(), "assets", "lexicon");
const coreManifestPath = join(releaseRoot, "core", "manifest.json");
const technicalManifestPath = join(releaseRoot, "technical", "manifest.json");

test.use({ lexiconPacks: "release" });
test.skip(
  process.env.REQUIRE_RELEASE_LEXICON_PACKS !== "1" &&
    (!existsSync(coreManifestPath) || !existsSync(technicalManifestPath)),
  "requires built Core and Technical release packs"
);

test("production extension resolves the built Core and Technical packs without Provider calls", async ({ harness }) => {
  const [core, technical] = await Promise.all([
    readFile(coreManifestPath, "utf8").then(JSON.parse),
    readFile(technicalManifestPath, "utf8").then(JSON.parse)
  ]);
  const page = await harness.open("/article");
  const bundledStatus = await harness.runtime({
    type: "BUNDLED_LEXICON_STATUS"
  });
  expect(bundledStatus.packs).toHaveLength(2);
  expect(bundledStatus.packs.map((pack) => pack.status)).toEqual(["ready", "ready"]);
  expect(bundledStatus.packs.map((pack) => pack.packId)).toEqual([core.packId, technical.packId]);

  const lookup = (text, extra = {}) => harness.runtime({
    type: "LEXICAL_LOOKUP",
    text,
    pageUrl: page.url(),
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    ...extra
  });

  const persistent = await lookup("persistent");
  expect(persistent.status).toBe("candidates");
  expect(persistent.candidates.some((candidate) =>
    candidate.provenance.packId === core.packId &&
    candidate.provenance.fingerprint === core.fingerprint
  )).toBe(true);

  const tmux = await lookup("tmux");
  expect(tmux.status).toBe("candidates");
  expect(tmux.candidates.some((candidate) =>
    candidate.provenance.packId === technical.packId &&
    candidate.provenance.fingerprint === technical.fingerprint
  )).toBe(true);

  const session = await lookup("session");
  expect(session.status).toBe("candidates");
  expect(session.candidates.some((candidate) => candidate.kind === "technical-concept")).toBe(true);
  expect(session.candidates.some((candidate) => candidate.provenance.packId === core.packId)).toBe(true);

  expect((await lookup("runtime system")).status).toBe("candidates");
  const phraseMiss = await lookup("persistent session");
  expect(phraseMiss.status).toBe("no-hit");
  expect(phraseMiss.evidence).toBeInstanceOf(Array);
  expect((await lookup("sessions")).status).toBe("candidates");
  expect((await lookup("persistent", { sourceLanguage: "ja" })).status).toBe("unsupported");
  expect(harness.server.calls).toHaveLength(0);

  const settings = await harness.context.newPage();
  await settings.goto(`chrome-extension://${harness.extensionId}/options.html#dictionary-packs`);
  await expect(settings.locator("#bundledLexiconList .site-row")).toHaveCount(2);
  await expect(settings.locator("#bundledLexiconList")).toContainText("Core Semantic");
  await expect(settings.locator("#bundledLexiconList")).toContainText("Technical Concepts");
  await expect(settings.locator("#bundledLexiconList")).toContainText("已就绪");
  await expect(settings.locator("#dictionaryPacksList")).toContainText("暂无官方推荐词典");
  await settings.close();

  expect(harness.server.calls).toHaveLength(0);
  await page.close();
});
