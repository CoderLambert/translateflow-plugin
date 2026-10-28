#!/usr/bin/env node
// Publish the built extension zip to the self-hosted download mirror.
// Usage: node scripts/publish-mirror.mjs --zip <file> --version <x.y.z> [--host tencent] [--dir /var/www/translateflow] [--dry-run]
//
// The mirror is a static directory served by nginx; it is not a Git host, so the
// script uploads the exact file that was released and verifies it by hash.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";

const exec = promisify(execFile);
const argv = process.argv.slice(2);
function arg(name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}
const zipPath = arg("zip");
const version = arg("version");
const host = arg("host", "tencent");
const dir = arg("dir", "/var/www/translateflow");
const publicBase = arg("public-base", null);
const dryRun = argv.includes("--dry-run");

if (!zipPath || !/^\d+\.\d+\.\d+$/u.test(String(version))) {
  console.error("usage: node scripts/publish-mirror.mjs --zip <file> --version <x.y.z> [--host tencent] [--dir /var/www/translateflow] [--public-base https://.../translateflow] [--dry-run]");
  process.exit(2);
}

// Read manifest.json straight out of the zip (stored or deflated entries) so a
// mismatched or uninspectable package never reaches the mirror.
function manifestVersion(buffer) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip archive");
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("bad central directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === "manifest.json") {
      const localName = buffer.readUInt16LE(localOffset + 26), localExtra = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localName + localExtra;
      const raw = buffer.subarray(start, start + compressedSize);
      return JSON.parse((method === 0 ? raw : inflateRawSync(raw)).toString("utf8")).version;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("manifest.json not found in zip");
}

const ssh = async (command) => (await exec("ssh", ["-o", "BatchMode=yes", host, command])).stdout;
const bytes = await readFile(resolve(zipPath));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const packaged = manifestVersion(bytes);
if (packaged !== version) throw new Error(`zip contains manifest version ${packaged}, expected ${version}`);
const fileName = `translateflow-${version}-chrome.zip`;
console.log(`zip: ${basename(zipPath)} (${bytes.length} bytes, manifest ${packaged}, sha256 ${sha256})`);

const indexHtml = await ssh(`cat ${dir}/index.html`).catch(() => "");
if (!indexHtml) throw new Error(`cannot read ${dir}/index.html on ${host}`);
const previous = indexHtml.match(/translateflow-(\d+\.\d+\.\d+)-chrome\.zip/u)?.[1] ?? null;
const nextIndex = indexHtml
  .replaceAll(/v\d+\.\d+\.\d+/gu, `v${version}`)
  .replaceAll(/translateflow-\d+\.\d+\.\d+-chrome\.zip/gu, fileName)
  .replace(/sha256: [a-f0-9]{64}/u, `sha256: ${sha256}`);

if (dryRun) {
  console.log(`[dry-run] would upload ${fileName}, point translateflow-latest-chrome.zip at it, rewrite SHA256SUMS and index.html${previous ? ` (was v${previous})` : ""}`);
  process.exit(0);
}

await exec("scp", ["-q", resolve(zipPath), `${host}:${dir}/${fileName}`]);
await ssh(`set -e
  cd ${dir}
  cp ${fileName} translateflow-latest-chrome.zip
  sha256sum ${fileName} > SHA256SUMS
  cat > index.html.new <<'TF_INDEX'
${nextIndex}
TF_INDEX
  mv index.html.new index.html
  ls -1 translateflow-*.zip SHA256SUMS index.html
  sha256sum ${fileName} translateflow-latest-chrome.zip`);

const remoteSha = await ssh(`sha256sum ${dir}/translateflow-latest-chrome.zip | cut -d' ' -f1`);
if (remoteSha.trim() !== sha256) throw new Error(`mirror verification failed: ${remoteSha.trim()} != ${sha256}`);
console.log(`mirror updated: ${dir}/${fileName} + translateflow-latest-chrome.zip (sha256 verified)`);
if (publicBase) {
  console.log(`index:   ${publicBase}/`);
  console.log(`latest:  ${publicBase}/translateflow-latest-chrome.zip`);
  console.log(`version: ${publicBase}/${fileName}`);
}
