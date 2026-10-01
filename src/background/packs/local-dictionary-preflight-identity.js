import { assertPreflightActive, readPreflightRange, safeFileLabel } from "./local-dictionary-preflight-contract.js";

const SAMPLE_BYTES = 16 * 1024;
const encoder = new TextEncoder();

export async function makeBoundedFileIdentityHint(file, readableEnd, signal) {
  assertPreflightActive(signal);
  if (!Number.isSafeInteger(readableEnd) || readableEnd < 0 || readableEnd > file.size) {
    return null;
  }
  const firstLength = Math.min(SAMPLE_BYTES, readableEnd);
  const first = firstLength
    ? await readPreflightRange(file, 0, firstLength, signal)
    : new Uint8Array();
  const tailStart = Math.max(firstLength, readableEnd - SAMPLE_BYTES);
  const tailLength = Math.max(0, readableEnd - tailStart);
  const tail = tailLength
    ? await readPreflightRange(file, tailStart, tailLength, signal)
    : new Uint8Array();
  return makeBoundedBytesIdentityHint(file, [
    { offset: 0, bytes: first },
    ...(tailLength ? [{ offset: tailStart, bytes: tail }] : [])
  ], readableEnd, signal);
}

export async function makeBoundedBytesIdentityHint(file, ranges, readableEnd = file.size, signal) {
  assertPreflightActive(signal);
  const digest = globalThis.crypto?.subtle?.digest;
  if (typeof digest !== "function") return null;
  const sampleBytes = ranges.reduce((sum, range) => sum + range.bytes.byteLength, 0);
  const rangeDescriptor = ranges.map(({ offset, bytes }) => `${offset}+${bytes.byteLength}`).join(",");
  const metadata = encoder.encode(
    `translateflow-local-preflight-sample-v1\0${file.size}\0${readableEnd}\0${rangeDescriptor}\0`
  );
  const combined = new Uint8Array(metadata.byteLength + sampleBytes);
  combined.set(metadata);
  let cursor = metadata.byteLength;
  for (const range of ranges) {
    combined.set(range.bytes, cursor);
    cursor += range.bytes.byteLength;
  }
  const hash = new Uint8Array(await digest.call(globalThis.crypto.subtle, "SHA-256", combined));
  assertPreflightActive(signal);
  return {
    kind: "bounded-byte-sample-sha256",
    fileName: safeFileLabel(file.name),
    size: file.size,
    readableEnd,
    sampleBytes,
    ranges: ranges.map(({ offset, bytes }) => ({ offset, length: bytes.byteLength })),
    value: `sha256:${[...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`,
    verified: false,
    verification: "unverified"
  };
}
