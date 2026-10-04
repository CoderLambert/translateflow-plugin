import { build } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, relative, resolve } from "node:path";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const CONTENT_SOURCE_ENTRY = "src/entries/content.js";

export function contentSourceFiles() {
  const source = readFileSync(resolve(ROOT, CONTENT_SOURCE_ENTRY), "utf8");
  const files = [...source.matchAll(/^import\s+["'](\.[^"']+)["'];$/gmu)].map(match =>
    relative(ROOT, resolve(ROOT, dirname(CONTENT_SOURCE_ENTRY), match[1])).replaceAll("\\", "/"));
  if (!files.length || new Set(files).size !== files.length || files.at(-1) !== "content.js") {
    throw new Error("Invalid Content source graph");
  }
  return files;
}

export async function contentRuntimeSource() {
  const result = await build({ configFile: false, root: ROOT, logLevel: "silent",
    build: { write: false, target: "chrome102", minify: "esbuild", sourcemap: false,
      lib: { entry: resolve(ROOT, CONTENT_SOURCE_ENTRY), name: "TranslateFlowContent", formats: ["iife"] } } });
  const chunks = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output).filter(item => item.type === "chunk");
  if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length) {
    throw new Error("Content runtime must produce one self-contained classic script");
  }
  return chunks[0].code;
}
