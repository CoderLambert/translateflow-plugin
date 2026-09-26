#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ALLOWED_ENTITY_KEYS = new Set([
  "qid",
  "revision",
  "label",
  "description",
  "aliases",
  "types",
  "zhLabel",
  "zhAliases",
  "zhTypes",
  "permanentUrl"
]);

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

    for (const key of Object.keys(entity)) {
      if (!ALLOWED_ENTITY_KEYS.has(key)) throw new Error(`Unexpected field ${key} in ${entity.qid}`);
    }

    validateStringArray(entity.aliases, "aliases", entity.qid);
    validateStringArray(entity.types, "types", entity.qid);
    validateOptionalStringArray(entity.zhAliases, "zhAliases", entity.qid);
    validateOptionalStringArray(entity.zhTypes, "zhTypes", entity.qid);
    if (entity.zhLabel != null && typeof entity.zhLabel !== "string") {
      throw new Error(`Invalid zhLabel for ${entity.qid}`);
    }
    if (entity.description != null && typeof entity.description !== "string") {
      throw new Error(`Invalid description for ${entity.qid}`);
    }

    validatePermanentUrl(entity);
    if (qids.has(entity.qid)) throw new Error(`Duplicate QID: ${entity.qid}`);
    qids.add(entity.qid);

    for (const raw of [
      entity.label,
      ...(entity.aliases || []),
      entity.zhLabel,
      ...(entity.zhAliases || [])
    ]) {
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

function validatePermanentUrl(entity) {
  let url;
  try {
    url = new URL(String(entity.permanentUrl || ""));
  } catch {
    throw new Error(`Invalid permanent URL for ${entity.qid}`);
  }

  if (
    url.protocol !== "https:"
    || url.hostname !== "www.wikidata.org"
    || url.pathname !== "/w/index.php"
    || url.username
    || url.password
    || url.hash
    || url.searchParams.get("title") !== entity.qid
    || url.searchParams.get("oldid") !== String(entity.revision)
  ) {
    throw new Error(`Permanent URL does not strictly bind Wikidata QID + revision for ${entity.qid}`);
  }
}

function validateStringArray(value, field, qid) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${field} for ${qid}`);
  }
}

function validateOptionalStringArray(value, field, qid) {
  if (value == null) return;
  validateStringArray(value, field, qid);
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
