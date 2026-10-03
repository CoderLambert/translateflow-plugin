import { build } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
export const classicContractPath = resolve(root, "src/content/reading-contract.js");
export async function classicContractSource() {
  const result = await build({
    configFile: false, root, logLevel: "silent",
    build: { write: false, target: "chrome102", minify: "esbuild", sourcemap: false,
      lib: { entry: resolve(root, "scripts/reading-contract-entry.mjs"), name: "TranslateFlowReadingContract", formats: ["iife"] }
    }
  });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap((bundle) => bundle.output).filter((item) => item.type === "chunk");
  if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length) throw new Error("Reading classic contract must be one self-contained script");
  return "// Generated from src/shared/reading by scripts/reading-contract-classic.mjs; do not edit.\n" + chunks[0].code;
}
export async function checkClassicContract() {
  if (await readFile(classicContractPath, "utf8") !== await classicContractSource()) throw new Error("Reading classic contract is stale; run node scripts/reading-contract-classic.mjs");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--check")) await checkClassicContract();
  else await writeFile(classicContractPath, await classicContractSource());
}
