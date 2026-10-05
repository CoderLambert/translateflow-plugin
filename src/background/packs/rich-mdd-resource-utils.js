import {
  RICH_MDD_MAX_SIDECAR_BYTES,
  RICH_MDD_MAX_SIDECAR_FILES,
  RICH_MDD_MAX_SIDECAR_FILE_BYTES,
  classifyMddSidecarPath
} from "./rich-mdd-contract.js";
import { MDD_IMPORT_LIMITS } from "./importers/mdd.js";
import { classifyMddResource } from "./importers/mdd-resource-policy.js";
import { assertRichMddLookupActive } from "./rich-mdd-lookup-cancellation.js";
import { richError, richMdictAbortError, sha256 } from "./rich-mdict-contract.js";

export function normalizeSidecarPreflightFiles(input) {
  if (!Array.isArray(input) || input.length > RICH_MDD_MAX_SIDECAR_FILES) {
    throw richError("RICH_MDD_LIMIT", "Select no more than 32 CSS, image, or audio sidecars.");
  }
  const paths = new Set();
  let total = 0;
  return input.map((item) => {
    const path = String(item?.path || "");
    const type = classifyMddSidecarPath(path);
    const size = Number(item?.size);
    if (!type || item?.kind !== type.kind || item?.mime !== type.mime || !Number.isSafeInteger(size) || size <= 0 ||
        size > RICH_MDD_MAX_SIDECAR_FILE_BYTES || (type.kind === "stylesheet" && size > 64 * 1024)) {
      throw richError("RICH_MDD_INPUT", "A sidecar file path, type, or size is invalid.");
    }
    const key = path.toLocaleLowerCase("en-US");
    if (paths.has(key)) throw richError("RICH_MDD_INPUT", "Duplicate sidecar resource paths are not allowed.");
    paths.add(key);
    total += size;
    if (total > RICH_MDD_MAX_SIDECAR_BYTES) throw richError("RICH_MDD_LIMIT", "Sidecar files exceed the 64 MiB total safety limit.");
    return { path, size, kind: type.kind, mime: type.mime };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

export function resourceReader(store, storePackId, version, descriptor, signal) {
  return {
    size: descriptor.sourceSize,
    async read(offset, length, readSignal = signal) {
      const activeSignal = readSignal || signal;
      if (activeSignal?.aborted) throw richMdictAbortError();
      const bytes = await store.readFileRange(storePackId, version, descriptor.sourcePath, offset, length, activeSignal);
      if (activeSignal?.aborted) throw richMdictAbortError();
      return bytes;
    }
  };
}

export async function assertStagedSidecars({ store, packId, resourceVersion, sidecars = [], signal, cryptoProvider }) {
  for (const sidecar of sidecars) {
    if (signal?.aborted) throw richMdictAbortError();
    if (await store.getFileSize(packId, resourceVersion, sidecar.sourcePath) !== sidecar.sourceSize) {
      throw richError("RICH_MDD_CORRUPT", "Staged sidecar source has an invalid size.");
    }
    const bytes = await store.readFile(packId, resourceVersion, sidecar.sourcePath);
    if (bytes.byteLength !== sidecar.sourceSize || await sha256(bytes, cryptoProvider) !== sidecar.sha256) {
      throw richError("RICH_MDD_CORRUPT", "Staged sidecar checksum failed.");
    }
    const actual = classifyMddResource(sidecar.path, bytes, MDD_IMPORT_LIMITS);
    if (actual.kind !== sidecar.kind || actual.mime !== sidecar.mime) {
      throw richError("RICH_MDD_CORRUPT", "Staged sidecar resource type does not match its manifest.");
    }
  }
}

export function validateResourceMime(result) {
  const expected = {
    image: /^image\/(?:png|jpeg|gif|webp)$/u,
    audio: /^audio\/(?:wav|mpeg|ogg|mp4|aac|flac)$/u,
    stylesheet: /^text\/css$/u
  }[result.kind];
  if (!expected || !expected.test(String(result.mime || ""))) {
    throw richError("RICH_MDD_CORRUPT", "MDD resource type failed MIME verification.");
  }
}

export function bytesToBase64(bytes, signal) {
  let binary = "";
  const chunkBytes = 0x6000;
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    assertRichMddLookupActive(signal);
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkBytes));
    let part = "";
    for (let index = 0; index < chunk.length; index += 1) part += String.fromCharCode(chunk[index]);
    binary += part;
  }
  assertRichMddLookupActive(signal);
  return btoa(binary);
}
