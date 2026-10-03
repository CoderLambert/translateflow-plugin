#!/usr/bin/env node
// One production engine: WXT. Preserve the stable install path and caller contract.
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertBuildOutputPaths } from "./path-boundaries.mjs";
import { auditWxtExtension } from "./audit-wxt-extension.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUT = resolve(ROOT, "dist/extension");

export async function buildExtension({ outDir = DEFAULT_OUT, requireLexicon = false, allowExternalOutput = false } = {}) {
  const options = { allowExternalOutput, allowWxtOutput: true };
  const output = await assertBuildOutputPaths(ROOT, outDir, options);
  // Each invocation builds in its own staging directory, including parallel Node
  // tests/certifiers. Failed build/audit leaves the installed package untouched.
  const staging = await mkdtemp(resolve(tmpdir(), "tf-wxt-build-"));
  try {
    const reportDir = resolve(staging, "reports");
    const artifact = resolve(staging, "output/chrome-mv3");
    await promisify(execFile)(process.execPath, [resolve(ROOT, "node_modules/wxt/bin/wxt.mjs"), "build", "-b", "chrome", "--mv3"], {
      cwd: ROOT, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, TF_WXT_BUILD_ROOT: staging, TRANSLATEFLOW_WXT_REQUIRE_LEXICON: requireLexicon ? "1" : "0" }
    });
    const audit = await auditWxtExtension({ output: artifact, reportDir });
    await assertBuildOutputPaths(ROOT, output, options);
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await cp(artifact, output, { recursive: true });
    // Standalone smoke consumes these reports with the explicit WXT output.
    if (output === resolve(ROOT, ".output/chrome-mv3")) {
      await mkdir(resolve(ROOT, ".wxt/reports"), { recursive: true });
      await cp(reportDir, resolve(ROOT, ".wxt/reports"), { recursive: true });
    }
    return { output, builder: "WXT", fileCount: audit.fileCount, totalBytes: audit.totalBytes,
      lexicalBytes: audit.lexicalBytes, lexicalAssetsIncluded: audit.lexicalBytes > 0,
      largestFiles: [...audit.files].sort((a,b) => b.size - a.size || a.path.localeCompare(b.path)).slice(0,20) };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

function parseArgs(argv) {
  const args = { outDir: DEFAULT_OUT, requireLexicon: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--require-lexicon") { args.requireLexicon = true; continue; }
    if (arg === "--out") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("missing value for --out");
      args.outDir = resolve(ROOT, value); continue;
    }
    throw new Error("unknown argument: " + arg);
  }
  return args;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildExtension(parseArgs(process.argv.slice(2))).then(report => console.log(JSON.stringify(report,null,2)))
    .catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
}
