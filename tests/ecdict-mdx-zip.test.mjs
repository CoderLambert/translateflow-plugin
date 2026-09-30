import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  extractPinnedEcdictMdx,
  extractSingleRootMdxZip
} from "../src/background/packs/importers/ecdict-mdx-zip.js";

const encoder = new TextEncoder();
const expectedName = encoder.encode("word.mdx");

function policy(overrides = {}) {
  return {
    expectedNameBytesHex: toHex(expectedName),
    expectedBytes: 5,
    maxArchiveBytes: 1024 * 1024,
    maxExpandedBytes: 1024 * 1024,
    maxFileBytes: 1024 * 1024,
    maxCompressionRatio: 100,
    ...overrides
  };
}

test("single-root MDX ZIP extraction supports stored and deflated members", async () => {
  const body = encoder.encode("hello");
  for (const method of [0, 8]) {
    const zip = makeZip([{ name: expectedName, body, method }]);
    const extracted = await extractSingleRootMdxZip(zip, policy());
    assert.deepEqual(extracted, body);
  }
});

test("single-root MDX ZIP extraction validates a signed data descriptor", async () => {
  const body = encoder.encode("hello");
  const zip = makeZip([{
    name: expectedName,
    body,
    method: 8,
    dataDescriptor: true
  }]);
  assert.deepEqual(
    await extractSingleRootMdxZip(zip, policy()),
    body
  );
});

test("ZIP extraction rejects traversal, additional members, and nested archives", async () => {
  const body = encoder.encode("hello");
  const traversal = makeZip([{
    name: encoder.encode("../word.mdx"),
    body
  }]);
  await assert.rejects(
    extractSingleRootMdxZip(traversal, policy({
      expectedNameBytesHex: toHex(encoder.encode("../word.mdx"))
    })),
    /root-level \.mdx filename/u
  );

  const twoMembers = makeZip([
    { name: expectedName, body },
    { name: encoder.encode("extra.txt"), body }
  ]);
  await assert.rejects(
    extractSingleRootMdxZip(twoMembers, policy()),
    /one non-ZIP64 member/u
  );

  const nested = encoder.encode("PK\u0003\u0004nested");
  const nestedZip = makeZip([{ name: expectedName, body: nested }]);
  await assert.rejects(
    extractSingleRootMdxZip(nestedZip, policy({
      expectedBytes: nested.byteLength
    })),
    /Nested archives/u
  );
});

test("ZIP extraction rejects encryption, ZIP64, bad CRC, and size bombs", async () => {
  const body = encoder.encode("hello");
  const encrypted = makeZip([{
    name: expectedName,
    body,
    flags: 1
  }]);
  await assert.rejects(
    extractSingleRootMdxZip(encrypted, policy()),
    /encryption or unsupported flags/u
  );

  const zip64 = makeZip([{
    name: expectedName,
    body,
    centralExtra: new Uint8Array([1, 0, 4, 0, 0, 0, 0, 0])
  }]);
  await assert.rejects(
    extractSingleRootMdxZip(zip64, policy()),
    /ZIP64/u
  );

  const badCrc = makeZip([{
    name: expectedName,
    body,
    centralCrc: 0,
    localCrc: 0
  }]);
  await assert.rejects(
    extractSingleRootMdxZip(badCrc, policy()),
    /CRC-32/u
  );

  const large = encoder.encode("x".repeat(4096));
  const bomb = makeZip([{
    name: expectedName,
    body: large,
    method: 8
  }]);
  await assert.rejects(
    extractSingleRootMdxZip(bomb, policy({
      expectedBytes: large.byteLength,
      maxExpandedBytes: 8192,
      maxFileBytes: 8192,
      maxCompressionRatio: 2
    })),
    /compression ratio limit/u
  );
  await assert.rejects(
    extractSingleRootMdxZip(bomb, policy({
      expectedBytes: large.byteLength,
      maxExpandedBytes: 1024,
      maxFileBytes: 8192,
      maxCompressionRatio: 100
    })),
    /size limit/u
  );

  const understated = makeZip([{
    name: expectedName,
    body: large,
    method: 8,
    localUncompressed: 1024,
    centralUncompressed: 1024
  }]);
  await assert.rejects(
    extractSingleRootMdxZip(understated, policy({
      expectedBytes: 1024,
      maxExpandedBytes: 8192,
      maxFileBytes: 8192,
      maxCompressionRatio: 100
    })),
    /expansion exceeded/u
  );
});

test("ZIP extraction rejects hidden gaps and cancellation", async () => {
  const body = encoder.encode("hello");
  const withGap = makeZip([{ name: expectedName, body }], {
    gapBeforeCentral: new Uint8Array([0x41])
  });
  await assert.rejects(
    extractSingleRootMdxZip(withGap, policy()),
    /hidden bytes/u
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    extractSingleRootMdxZip(
      makeZip([{ name: expectedName, body }]),
      policy({ signal: controller.signal })
    ),
    { name: "AbortError" }
  );

  const duringInflate = new AbortController();
  await assert.rejects(
    extractSingleRootMdxZip(
      makeZip([{ name: expectedName, body, method: 8 }]),
      policy({
        signal: duringInflate.signal,
        onProgress(event) {
          if (event.phase === "extract" && event.outputBytes > 0) {
            duringInflate.abort();
          }
        }
      })
    ),
    { name: "AbortError" }
  );
});

test("pinned extractor rejects undeclared recipes before consuming a response", async () => {
  let read = false;
  const response = {
    ok: true,
    body: {
      getReader() {
        read = true;
        throw new Error("must not read");
      }
    }
  };
  await assert.rejects(
    extractPinnedEcdictMdx(response, {
      source: {
        id: "ecdict-en-zh-mdx-curated",
        importerType: "ecdict-mdx-zip-v1"
      }
    }),
    /extension-declared recipe/u
  );
  assert.equal(read, false);
});

function makeZip(entries, {
  gapBeforeCentral = new Uint8Array(),
  defaultMethod = 0
} = {}) {
  const prepared = entries.map((entry) => {
    const method = entry.method ?? defaultMethod;
    const compressed = method === 8
      ? new Uint8Array(deflateRawSync(entry.body))
      : entry.body;
    return {
      ...entry,
      method,
      compressed,
      crc: crc32(entry.body),
      flags: entry.flags || 0
    };
  });
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of prepared) {
    const dataDescriptorBytes = entry.dataDescriptor ? 16 : 0;
    const local = new Uint8Array(30 + entry.name.byteLength + entry.compressed.byteLength + dataDescriptorBytes);
    put32(local, 0, 0x04034b50);
    put16(local, 4, entry.method === 8 ? 20 : 10);
    put16(local, 6, entry.flags | (entry.dataDescriptor ? 8 : 0));
    put16(local, 8, entry.method);
    put32(local, 14, entry.dataDescriptor ? 0 : (entry.localCrc ?? entry.crc));
    put32(local, 18, entry.dataDescriptor ? 0 : entry.compressed.byteLength);
    put32(local, 22, entry.dataDescriptor ? 0 : (entry.localUncompressed ?? entry.body.byteLength));
    put16(local, 26, entry.name.byteLength);
    local.set(entry.name, 30);
    local.set(entry.compressed, 30 + entry.name.byteLength);
    if (entry.dataDescriptor) {
      const descriptorOffset = local.byteLength - 16;
      put32(local, descriptorOffset, 0x08074b50);
      put32(local, descriptorOffset + 4, entry.crc);
      put32(local, descriptorOffset + 8, entry.compressed.byteLength);
      put32(local, descriptorOffset + 12, entry.body.byteLength);
    }
    localParts.push(local);

    const extra = entry.centralExtra || new Uint8Array();
    const central = new Uint8Array(46 + entry.name.byteLength + extra.byteLength);
    put32(central, 0, 0x02014b50);
    put16(central, 4, 20);
    put16(central, 6, entry.method === 8 ? 20 : 10);
    put16(central, 8, entry.flags | (entry.dataDescriptor ? 8 : 0));
    put16(central, 10, entry.method);
    put32(central, 16, entry.centralCrc ?? entry.crc);
    put32(central, 20, entry.compressed.byteLength);
    put32(central, 24, entry.centralUncompressed ?? entry.body.byteLength);
    put16(central, 28, entry.name.byteLength);
    put16(central, 30, extra.byteLength);
    put32(central, 42, localOffset);
    central.set(entry.name, 46);
    central.set(extra, 46 + entry.name.byteLength);
    centralParts.push(central);
    localOffset += local.byteLength;
  }

  const localBytes = concat(localParts);
  const centralBytes = concat(centralParts);
  const eocd = new Uint8Array(22);
  put32(eocd, 0, 0x06054b50);
  put16(eocd, 8, prepared.length);
  put16(eocd, 10, prepared.length);
  put32(eocd, 12, centralBytes.byteLength);
  put32(eocd, 16, localBytes.byteLength + gapBeforeCentral.byteLength);
  return concat([localBytes, gapBeforeCentral, centralBytes, eocd]);
}

function crc32(input) {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function put16(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function put32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function toHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
