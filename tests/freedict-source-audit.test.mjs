import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  auditFreeDictSource,
  classifyFreeDictLicense,
  parseFreeDictTeiHeader
} from "../scripts/audit-freedict-source.mjs";

const tei = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader xml:lang="en">
    <fileDesc>
      <titleStmt>
        <title>English-Chinese FreeDict+WikDict dictionary</title>
        <respStmt><resp>Maintainer</resp><name xml:id="karlb">Karl Bartel</name></respStmt>
      </titleStmt>
      <editionStmt><edition>2025.11.21</edition></editionStmt>
      <extent>26,660 headwords</extent>
      <publicationStmt>
        <publisher>Karl Bartel</publisher>
        <availability status="free"><p>Licensed under the <ref target="https://creativecommons.org/licenses/by-sa/3.0/legalcode">Creative Commons Attribution-ShareAlike 3.0 Unported</ref> license</p></availability>
        <date>2025-11-21</date>
      </publicationStmt>
      <sourceDesc>
        <p>Automatic creation by <ref target="http://www.wikdict.com/">WikDict</ref>.</p>
        <p>Base data from <ref target="https://www.wiktionary.org/">Wiktionary.org</ref> via <ref target="http://kaiko.getalp.org/about-dbnary/">DBnary</ref>.</p>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
  <text><body xml:lang="en"></body></text>
</TEI>`;

const copying = `CREATIVE COMMONS CORPORATION IS NOT A LAW FIRM
License Elements
Attribution, ShareAlike
Creative Commons Corporation
`;

test("FreeDict TEI header parser extracts exact license and provenance metadata", () => {
  const header = parseFreeDictTeiHeader(tei);
  assert.equal(header.edition, "2025.11.21");
  assert.equal(header.headwords, 26660);
  assert.equal(header.publisher, "Karl Bartel");
  assert.equal(header.maintainer, "Karl Bartel");
  assert.equal(header.licenseUrl, "https://creativecommons.org/licenses/by-sa/3.0/legalcode");
  assert.match(header.sourceDescription, /WikDict/);
  assert.equal(classifyFreeDictLicense(header, copying), "CC-BY-SA-3.0");
});

test("FreeDict audit verifies exact archive checksum before approving license evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "translateflow-freedict-audit-"));
  const archive = Buffer.from("fixture archive bytes");
  const archivePath = join(root, "source.tar.xz");
  const teiPath = join(root, "eng-zho.tei");
  const copyingPath = join(root, "COPYING");
  const lockPath = join(root, "lock.json");
  await Promise.all([
    writeFile(archivePath, archive),
    writeFile(teiPath, tei),
    writeFile(copyingPath, copying),
    writeFile(lockPath, JSON.stringify({
      dictionary: "eng-zho",
      edition: "2025.11.23",
      source: {
        url: "https://example.invalid/freedict-eng-zho.src.tar.xz",
        sha512: createHash("sha512").update(archive).digest("hex"),
        sizeBytes: archive.byteLength
      }
    }))
  ]);
  const result = await auditFreeDictSource({ archivePath, teiPath, copyingPath, lockPath });
  assert.equal(result.copying.licenseId, "CC-BY-SA-3.0");
  assert.deepEqual(result.provenanceChecks, { wikDict: true, wiktionary: true, dbnary: true });

  const changed = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(lockPath, "utf8")));
  changed.source.sha512 = "0".repeat(128);
  await writeFile(lockPath, JSON.stringify(changed));
  await assert.rejects(
    auditFreeDictSource({ archivePath, teiPath, copyingPath, lockPath }),
    /SHA-512 mismatch/
  );
});

test("FreeDict audit rejects a license-version drift", () => {
  const header = parseFreeDictTeiHeader(
    tei.replaceAll("by-sa/3.0", "by-sa/4.0").replaceAll("3.0 Unported", "4.0 International")
  );
  assert.equal(classifyFreeDictLicense(header, copying), "UNVERIFIED");
});
