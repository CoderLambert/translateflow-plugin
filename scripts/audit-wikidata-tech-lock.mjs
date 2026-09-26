#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DISALLOWED_KEYS = new Set(["image", "logo", "html", "css", "javascript", "wasm", "wikipediaText", "commonsMedia"]);

export function validateTechLock(value) {
  if (!value || value.version !== 1) throw new Error("Unsupported tech lock version.");
  if (value.license !== "CC0-1.0") throw new Error("Tech lock must contain only approved Wikidata CC0 structured data.");
  if (!Array.isArray(value.entities) || !value.entities.length) throw new Error("Tech lock has no entities.");

  const qids = new Set();
  const aliases = new Map();
  for (const entity of value.entities) {
    if (!/^Q[1-9]\d*$/.test(String(entity.qid || ""))) throw new Error(`Invalid QID: ${entity.qid}`);
    if (!Number.isInteger(entity.revision) || entity.revision <= 0) throw new Error(`Invalid revision for ${entity.qid}`);
    if (!String(entity.label || "").trim()) throw new Error(`Missing label for ${entity.qid}`);
    if (!String(entity.permanentUrl || "").includes(`title=${entity.qid}&oldid=${entity.revision}`)) {
      throw new Error(`Permanent URL does not bind QID + revision for ${entity.qid}`);
    }
    if (qids.has(entity.qid)) throw new Error(`Duplicate QID: ${entity.qid}`);
    qids.add(entity.qid);

    for (const key of Object.keys(entity)) {
      if (DISALLOWED_KEYS.has(key)) throw new Error(`Disallowed field ${key} in ${entity.qid}`);
    }

    for (const raw of [entity.label, ...(entity.aliases || [])]) {
      const key = normalizeAlias(raw);
      if (!key) continue;
      if (!aliases.has(key)) aliases.set(key, []);
      aliases.get(key).push(entity.qid);
    }
  }

  return {
    entityCount: value.entities.length,
    qids: [...qids].sort(),
    ambiguousAliases: [...aliases.entries()]
      .filter(([, ids]) => new Set(ids).size > 1)
      .map(([alias, ids]) => ({ alias, qids: [...new Set(ids)].sort() }))
  };
}

export function normalizeAlias(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: node scripts/audit-wikidata-tech-lock.mjs <lock.json>");
  const value = JSON.parse(await readFile(resolve(path), "utf8"));
  process.stdout.write(JSON.stringify(validateTechLock(value), null, 2) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
