import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectMdictFiles, runCli } from "../scripts/inspect-mdict-compatibility.mjs";
import { makeRichMdx } from "./helpers/rich-mdict-fixture.mjs";
import { makeMdd, readMddInteropFixture } from "./helpers/mdd-fixture.mjs";

test("inspector reports aggregate-only compatibility for independent MDX and MDD fixtures", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-mdict-inspector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { mdx, mdd } = await readMddInteropFixture();
  const mdxPath = join(directory, "fixture.mdx");
  const mddPath = join(directory, "fixture.mdd");
  await Promise.all([writeFile(mdxPath, mdx), writeFile(mddPath, mdd)]);

  const report = await inspectMdictFiles({
    mdxPath,
    mddPaths: [mddPath],
    label: "local fixture",
    includeHashes: false
  });

  assert.equal(report.result, "supported");
  assert.equal(report.mdx.parser.result, "supported");
  assert.equal(report.mdx.metadata.generatedByEngineVersion, "2.0");
  assert.equal(report.mdx.structure.entryCount, 1);
  assert.deepEqual(report.mdx.structure.recordBlockCompression, { none: 0, zlib: 1, lzo: 0, unknown: 0 });
  assert.equal(report.mdx.featureSampling.imageReferenceRecords, 1);
  assert.equal(report.mdx.featureSampling.audioReferenceRecords, 1);
  assert.equal(report.mdx.featureSampling.remoteUrlRecords, 1);
  assert.ok(report.mdx.featureSampling.observedCapabilities.includes("rich.image-reference"));
  assert.ok(report.mdx.featureSampling.observedCapabilities.includes("rich.remote-url"));
  assert.equal(report.mdd.count, 1);
  assert.equal(report.mdd.files[0].parser.result, "supported");
  assert.equal(report.mdd.files[0].parser.supportedCapabilities.includes("mdd.encoding.utf16le"), true);
  assert.equal(report.mdd.files[0].structure.resourceCount, 3);
  assert.deepEqual(report.mdd.files[0].structure.resourceExtensionHistogram, { css: 1, png: 1, wav: 1 });
  assert.equal(report.mdd.files[0].structure.resourcePathNormalizationChanges, 3);
  assert.equal(report.mdd.files[0].structure.resourcePathNormalizationIssues, 0);

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /mddinteropfixture|interop\/sample\.png|tone\.wav|remote\.invalid/iu);
  assert.equal(Object.hasOwn(report.mdx.file, "sha256"), false);
  assert.equal(Object.hasOwn(report.mdd.files[0].file, "sha256"), false);
});

test("inspector samples rich semantics and counts alias links without emitting record text", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-mdict-inspector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mdxPath = join(directory, "features.mdx");
  const mddPath = join(directory, "features.mdd");
  const mdx = makeRichMdx([
    ["alpha", "@@@LINK=beta"],
    ["beta", '<p style="color:red"><a href="#part">anchor</a><a href="entry://next">entry</a><a href="https://example.invalid">remote</a><a href="custom://asset">other</a><img src="assets/oddshape.qzx"><audio src="sound://beta"></audio></p> PRIVATE_DEFINITION_SENTINEL']
  ], { keyBlockEntryCounts: [1, 1] });
  await Promise.all([
    writeFile(mdxPath, mdx),
    writeFile(mddPath, makeMdd([["assets/oddshape.qzx", Buffer.from("synthetic bytes")]]))
  ]);

  const report = await inspectMdictFiles({ mdxPath, mddPaths: [mddPath], sampleRecords: 2 });
  const sample = report.mdx.featureSampling;
  assert.equal(report.mdx.structure.aliasLink.presence, true);
  assert.equal(report.mdx.structure.aliasLink.observedRecords, 1);
  assert.equal(sample.inlineStyleRecords, 1);
  assert.equal(sample.localAnchorRecords, 1);
  assert.equal(sample.entryReferenceRecords, 1);
  assert.equal(sample.soundReferenceRecords, 1);
  assert.ok(sample.observedCapabilities.includes("rich.entry-reference"));
  assert.ok(sample.observedCapabilities.includes("rich.sound-reference"));
  assert.equal(sample.relativeResourcePathRecords, 1);
  assert.equal(sample.remoteUrlRecords, 1);
  assert.equal(sample.otherUriSchemeRecords, 1);
  assert.equal(sample.unusualResourceExtensionReferences, 1);
  assert.equal(report.mdd.files[0].structure.unsupportedResourceForms.unknownExtension, 1);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_DEFINITION_SENTINEL|oddshape\.qzx|assets\//u);
});

test("unsupported engine requirements return stable capability codes and corrupt bytes are not exported", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-mdict-inspector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mdxPath = join(directory, "new-engine.mdx");
  await writeFile(mdxPath, makeRichMdx([["alpha", "private"]], { requiredEngineVersion: "3.0" }));
  const report = await inspectMdictFiles({ mdxPath, includeHashes: false });
  assert.equal(report.mdx.parser.result, "unsupported");
  assert.equal(report.result, "unsupported");
  assert.equal(Object.hasOwn(report.mdx.file, "sha256"), false);
  assert.ok(report.mdx.parser.unsupportedCapabilities.includes("mdx.required-engine-version"));
  assert.doesNotMatch(JSON.stringify(report), /private/iu);
  await assert.rejects(
    inspectMdictFiles({ mdxPath, mddPaths: Array(17).fill(mdxPath) }),
    /At most 16 companion MDD files/iu
  );

  const corruptPath = join(directory, "corrupt.mdx");
  await writeFile(corruptPath, Buffer.from("not an mdict").subarray(0, 12));
  await assert.rejects(inspectMdictFiles({ mdxPath: corruptPath }), /MDict header/iu);
});

test("overall result includes unsupported companion MDD parser outcomes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-mdict-inspector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mdxPath = join(directory, "supported.mdx");
  const mddPath = join(directory, "password-protected.mdd");
  await Promise.all([
    writeFile(mdxPath, makeRichMdx([["alpha", "private definition"]])),
    writeFile(mddPath, makeMdd([["asset.png", Buffer.from("resource bytes")]], { encrypted: 1 }))
  ]);

  const report = await inspectMdictFiles({ mdxPath, mddPaths: [mddPath] });
  assert.equal(report.mdx.parser.result, "supported");
  assert.equal(report.mdd.files[0].parser.result, "unsupported");
  assert.ok(report.mdd.files[0].parser.unsupportedCapabilities.includes("mdd.encryption.password-protected"));
  assert.equal(report.result, "partially_supported");
});

test("CLI refuses direct and symlink output collisions while preserving distinct output behavior", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "translateflow-mdict-inspector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const mdxPath = join(directory, "safe.mdx");
  const mddPath = join(directory, "safe.mdd");
  const mdx = makeRichMdx([["alpha", "private definition"]]);
  const mdd = makeMdd([["asset.png", Buffer.from("resource bytes")]]);
  await Promise.all([writeFile(mdxPath, mdx), writeFile(mddPath, mdd)]);

  await assert.rejects(
    runCli([mdxPath, "--output", mdxPath]),
    /Output must be distinct from every MDX\/MDD input/iu
  );
  assert.deepEqual(await readFile(mdxPath), mdx);
  assert.deepEqual(await readFile(mddPath), mdd);

  const mddAliasPath = join(directory, "mdd-output-alias.json");
  await symlink(mddPath, mddAliasPath);
  await assert.rejects(
    runCli([mdxPath, mddPath, "--output", mddAliasPath]),
    /Output must be distinct from every MDX\/MDD input/iu
  );
  assert.deepEqual(await readFile(mdxPath), mdx);
  assert.deepEqual(await readFile(mddPath), mdd);

  const safeOutputPath = join(directory, "report.json");
  await runCli([mdxPath, mddPath, "--output", safeOutputPath]);
  const report = JSON.parse(await readFile(safeOutputPath, "utf8"));
  assert.equal(report.result, "supported");
  assert.deepEqual(await readFile(mdxPath), mdx);
  assert.deepEqual(await readFile(mddPath), mdd);
});

test("independent synthetic report is repeatable and stays tied to the writer lock", async () => {
  const lock = JSON.parse(await readFile(resolve("tests/fixtures/mdd-interop/corpus-lock.json"), "utf8"));
  assert.equal(lock.purpose, "synthetic-interoperability-fixture-not-dictionary-corpus");
  assert.equal(lock.independentWriter.name, "writemdict");
  assert.equal(lock.independentWriter.license, "MIT");
  assert.equal(lock.generation.mdx.sha256, "b8996c8cd7449e67a5049ba0cd284fb1528385ff090c82af4113c67e050a8a82");
  const baseline = JSON.parse(await readFile(resolve("lexicon/build-evidence/mdict-compatibility/writemdict-synthetic-interop.json"), "utf8"));
  const actual = await inspectMdictFiles({
    mdxPath: resolve("tests/fixtures/mdd-interop/interop.mdx"),
    mddPaths: [resolve("tests/fixtures/mdd-interop/interop.mdd")],
    label: "writemdict-synthetic-interop",
    includeHashes: true
  });
  assert.deepEqual(actual, baseline);
});

test("ECDICT report structural evidence matches its pinned lock without lexical content", async () => {
  const lock = JSON.parse(await readFile(resolve("lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json"), "utf8"));
  const report = JSON.parse(await readFile(resolve("lexicon/build-evidence/mdict-compatibility/ecdict-1.0.28.json"), "utf8"));
  assert.equal(report.mdx.file.sha256, lock.mdx.sha256);
  assert.equal(report.mdx.file.bytes, lock.mdx.bytes);
  assert.equal(report.mdx.structure.entryCount, lock.mdx.entryCount);
  assert.equal(report.mdx.structure.keyBlockCount, lock.mdx.keyBlockCount);
  assert.equal(report.mdx.structure.recordBlockCount, lock.mdx.recordBlockCount);
  assert.equal(report.mdx.structure.keyInfoCompression, "zlib");
  assert.deepEqual(report.mdx.structure.keyInfo, {
    compression: "zlib",
    compressedBytes: lock.mdx.keyInfoCompressedBytes,
    decompressedBytes: lock.mdx.keyInfoDecompressedBytes,
    encrypted: true
  });
  assert.deepEqual(report.mdx.structure.keyBlockCompression, { none: 0, zlib: lock.mdx.keyBlockCount, lzo: 0, unknown: 0 });
  for (const kind of ["none", "zlib", "lzo"]) {
    assert.equal(report.mdx.structure.recordBlockCompression[kind], lock.mdx.recordBlockCompression[kind]);
  }
  assert.equal(report.mdx.structure.keyBlocks.totalCompressedBytes, lock.mdx.compressedKeyBlockBytes);
  assert.equal(report.mdx.structure.recordBlocks.totalCompressedBytes, lock.mdx.compressedRecordBlockBytes);
  assert.equal(report.mdx.structure.recordBlocks.totalDecompressedBytes, lock.mdx.decompressedRecordBytes);
  assert.equal(report.mdx.structure.recordBlocks.maxDecompressedBytes, lock.mdx.maximumDecompressedRecordBlockBytes);
  assert.ok(report.mdx.structure.keyBlocks.maxDecompressedBytes > 0);
  assert.ok(report.mdx.structure.keyBlocks.maxDecompressedBytes <= 4 * 1024 * 1024);
  assert.equal(report.mdx.parser.result, "supported");
  assert.equal(report.mdx.parser.supportedCapabilities.includes("mdx.compression.zlib"), true);
  assert.equal(report.mdx.parser.supportedCapabilities.includes("mdx.key-info.compression-zlib"), true);
  assert.doesNotMatch(JSON.stringify(report), /n\. 跑|n\. 州|n\. 程序|n\. 发行/iu);
});
