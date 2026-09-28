import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildFreeDictRecords,
  compileTflexFreeDict,
  validateFreeDictPackOutput,
  validateFreeDictSourceLock
} from "../scripts/build-tflex-freedict.mjs";

const copying = `CREATIVE COMMONS CORPORATION IS NOT A LAW FIRM
License Elements
Attribution, ShareAlike
Creative Commons Corporation
`;

function fixtureTei(licenseVersion = "3.0") {
  const licenseName = licenseVersion === "3.0"
    ? "Creative Commons Attribution-ShareAlike 3.0 Unported"
    : "Creative Commons Attribution-ShareAlike 4.0 International";
  return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0" xmlns:wikdict="http://www.wikdict.com/ns/1.0">
  <teiHeader xml:lang="en">
    <fileDesc>
      <titleStmt>
        <title>English-中文 (Zhōngwén) FreeDict+WikDict dictionary</title>
        <respStmt><resp>Maintainer</resp><name xml:id="karlb">Karl Bartel</name></respStmt>
      </titleStmt>
      <editionStmt><edition>2025.11.23</edition></editionStmt>
      <extent>3 headwords</extent>
      <publicationStmt>
        <publisher>Karl Bartel</publisher>
        <availability status="free"><p>Licensed under the <ref target="https://creativecommons.org/licenses/by-sa/${licenseVersion}/legalcode">${licenseName}</ref> license</p></availability>
        <date>2025-11-23</date>
      </publicationStmt>
      <sourceDesc>
        <p>Automatic creation of this bilingual dictionary by <ref target="http://www.wikdict.com/">WikDict</ref>.</p>
        <p>Base data from <ref target="https://www.wiktionary.org/">Wiktionary.org</ref> via <ref target="http://kaiko.getalp.org/about-dbnary/">DBnary</ref>.</p>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
  <text><body xml:lang="en">
    <entry>
      <form><orth>persistent</orth><form type="infl"><orth wikdict:show="true">persisted</orth></form></form>
      <gramGrp><pos>adj</pos></gramGrp>
      <sense><cit type="trans" xml:lang="zh"><quote>持久的</quote><quote>持续的</quote></cit></sense>
    </entry>
    <entry>
      <form><orth>persistent</orth></form>
      <gramGrp><pos>n</pos></gramGrp>
      <sense><cit type="trans" xml:lang="zh"><quote>持久性</quote></cit></sense>
    </entry>
    <entry>
      <form><orth>cache</orth></form>
      <gramGrp><pos>n</pos></gramGrp>
      <sense><cit type="trans" xml:lang="zh"><quote>缓存</quote></cit><sense><def>computing</def></sense></sense>
    </entry>
  </body></text>
</TEI>`;
}

async function fixture(name, { licenseVersion = "3.0" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "translateflow-freedict-" + name + "-"));
  const archive = Buffer.from("fixture FreeDict archive bytes");
  const tei = fixtureTei(licenseVersion);
  const archivePath = join(root, "source.tar.xz");
  const teiPath = join(root, "eng-zho.tei");
  const copyingPath = join(root, "COPYING");
  const lockPath = join(root, "lock.json");
  const lock = {
    schemaVersion: 1,
    formatVersion: 1,
    readerMinVersion: 1,
    normalizationVersion: 1,
    packId: "freedict-eng-zho",
    packVersion: "2025.11.23",
    sourceLanguage: "en",
    targetLanguage: "zh-CN",
    source: {
      id: "freedict-eng-zho",
      dictionary: "eng-zho",
      edition: "2025.11.23",
      url: "https://example.invalid/freedict-eng-zho.src.tar.xz",
      archiveSha512: digest("sha512", archive),
      archiveSizeBytes: archive.byteLength,
      tei: {
        filename: "eng-zho.tei",
        sha256: digest("sha256", Buffer.from(tei)),
        sizeBytes: Buffer.byteLength(tei),
        title: "English-中文 (Zhōngwén) FreeDict+WikDict dictionary",
        edition: "2025.11.23",
        publicationDate: "2025-11-23",
        headwords: 3,
        publisher: "Karl Bartel",
        maintainer: "Karl Bartel",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/legalcode",
        licenseName: "Creative Commons Attribution-ShareAlike 3.0 Unported",
        sourceDescription: "Automatic creation of this bilingual dictionary by WikDict . Base data from Wiktionary.org via DBnary ."
      },
      copying: {
        filename: "COPYING",
        sha256: digest("sha256", Buffer.from(copying)),
        sizeBytes: Buffer.byteLength(copying)
      }
    },
    provenance: {
      generator: "WikDict / wikdict-gen"
    },
    license: {
      id: "CC-BY-SA-3.0",
      name: "Creative Commons Attribution-ShareAlike 3.0 Unported",
      source: "https://creativecommons.org/licenses/by-sa/3.0/legalcode",
      approvedForOfficialPack: true,
      adaptationLicense: "CC-BY-SA-3.0",
      notice: "Fixture attribution and ShareAlike notice."
    },
    modificationPolicy: {
      retain: ["headword", "part-of-speech", "direct Chinese translations", "inflected-form aliases", "source provenance"],
      recordOmissions: ["pronunciation", "grammatical gender"],
      semanticRewriting: false
    },
    qualityRole: "optional-complement-only"
  };
  await Promise.all([
    writeFile(archivePath, archive),
    writeFile(teiPath, tei),
    writeFile(copyingPath, copying),
    writeFile(lockPath, JSON.stringify(lock))
  ]);
  return { root, archivePath, teiPath, copyingPath, lockPath, lock };
}

async function build(name) {
  const env = await fixture(name);
  const outDir = join(env.root, "out");
  const result = await compileTflexFreeDict({ ...env, sourceLockPath: env.lockPath, outDir });
  return { ...env, outDir, result };
}

async function snapshot(root) {
  const result = {};
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile()) result[entry.name] = await readFile(join(root, entry.name), "utf8");
  }
  return result;
}

test("FreeDict compiler emits deterministic opfs-indexed TFLex with separate license evidence", async () => {
  const first = await build("a");
  const second = await build("b");
  assert.deepEqual(await snapshot(first.outDir), await snapshot(second.outDir));
  assert.equal(first.result.manifest.profile, "opfs-indexed-v1");
  assert.equal(first.result.manifest.license.id, "CC-BY-SA-3.0");
  assert.match(first.result.manifest.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.ok(first.result.manifest.files.some((file) => file.path === "LICENSE_CC_BY_SA_3.0.txt"));
  assert.ok(first.result.manifest.files.some((file) => file.path === "MODIFICATIONS.txt"));
  assert.equal((await validateFreeDictPackOutput({ outDir: first.outDir })).validatedRecords, 2);
});

test("FreeDict compiler groups headword senses and indexes inflected aliases without overwriting provenance", () => {
  const records = buildFreeDictRecords(fixtureTei());
  const persistent = records.find((record) => record.lookupKey === "persistent");
  assert.ok(persistent);
  assert.equal(persistent.senses.length, 2);
  assert.deepEqual(persistent.senses.map((sense) => sense.partOfSpeech), ["adjective", "noun"]);
  assert.deepEqual(persistent.aliases, ["persisted"]);
  assert.ok(persistent.senses.every((sense) => sense.sourceRefs[0].sourceId === "freedict-eng-zho"));
  const cache = records.find((record) => record.lookupKey === "cache");
  assert.deepEqual(cache.senses[0].translations, ["缓存"]);
});

test("FreeDict source lock fails closed when official-pack license approval is absent", async () => {
  const env = await fixture("license-approval");
  const changed = structuredClone(env.lock);
  changed.license.approvedForOfficialPack = false;
  assert.throws(() => validateFreeDictSourceLock(changed), /license approval/);
});

test("FreeDict compiler rejects exact TEI license drift even when fixture hash is updated", async () => {
  const env = await fixture("license-drift", { licenseVersion: "4.0" });
  const outDir = join(env.root, "out");
  await assert.rejects(
    compileTflexFreeDict({ ...env, sourceLockPath: env.lockPath, outDir }),
    /license could not be verified|TEI license/
  );
});

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest("hex");
}
