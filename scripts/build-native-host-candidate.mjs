#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertOwnedOutputPath } from "./path-boundaries.mjs";
import { validHostVersion } from "../src/shared/chatgpt-native-host.js";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HOST_ROOT = resolve(ROOT, "native-host");

export function validateNativeHostReleaseInput(extensionId, version) {
  if (typeof extensionId !== "string" || !/^[a-p]{32}$/u.test(extensionId)) throw new Error("TF_CHROME_EXTENSION_ID must be the exact 32-character Chrome Web Store ID");
  if (typeof version !== "string" || version === "dev" || !validHostVersion(version)) throw new Error("TF_NATIVE_HOST_VERSION must be an exact safe x.y.z version");
  return { extensionId, version };
}

export function nativeHostLdflags(extensionId, version) {
  validateNativeHostReleaseInput(extensionId, version);
  return `-s -w -X main.pinnedExtensionID=${extensionId} -X main.version=${version}`;
}

export async function buildNativeHostCandidate({
  extensionId = process.env.TF_CHROME_EXTENSION_ID,
  version = process.env.TF_NATIVE_HOST_VERSION,
  output = resolve(ROOT, ".output/native-host-candidate")
} = {}) {
  validateNativeHostReleaseInput(extensionId, version);
  const targetRoot = await assertOwnedOutputPath(ROOT, resolve(ROOT, ".output"), output);
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  const commit = (await capture("git", ["rev-parse", "HEAD"], ROOT)).trim();
  const targets = [
    { os: "linux", arch: "amd64", file: `translateflow-host-${version}-linux-amd64` },
    { os: "windows", arch: "amd64", file: `translateflow-host-${version}-windows-amd64.exe` }
  ];
  const artifacts = [];
  for (const target of targets) {
    const path = resolve(targetRoot, target.file);
    await run("go", ["build", "-trimpath", "-ldflags", nativeHostLdflags(extensionId, version), "-o", path, "./cmd/translateflow-host"], HOST_ROOT, {
      ...process.env, GOOS: target.os, GOARCH: target.arch, CGO_ENABLED: "0"
    });
    const bytes = await readFile(path);
    artifacts.push({ ...target, bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const manifest = {
    schemaVersion: 1,
    kind: "translateflow-native-host-unsigned-candidate",
    publishable: false,
    version,
    commit,
    extensionId,
    hostName: "com.coderlambert.translateflow",
    signing: { windows: "NOT_SIGNED", linux: "NOT_SIGNED" },
    artifacts
  };
  await writeFile(resolve(targetRoot, "release-candidate.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(resolve(targetRoot, "SHA256SUMS"), artifacts.map(value => `${value.sha256}  ${value.file}`).join("\n") + "\n");
  return manifest;
}

async function run(command, args, cwd, env = process.env) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function capture(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.on("data", value => chunks.push(value));
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolvePromise(Buffer.concat(chunks).toString("utf8")) : reject(new Error(`${command} exited with ${code}`)));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildNativeHostCandidate().then(value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
