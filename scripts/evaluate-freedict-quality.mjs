#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { certifyFreeDictPack } from "./certify-freedict-pack.mjs";

export async function evaluateFreeDictQuality({ packDir, sourceLockPath }) {
  const lock = JSON.parse(await readFile(resolveRequired(sourceLockPath, "sourceLockPath"), "utf8"));
  const decision = lock.qualityDecision;
  if (
    decision?.status !== "no-ship" ||
    decision?.approvedForProductDistribution !== false ||
    lock.qualityRole !== "research-only-no-ship"
  ) {
    throw new Error("FreeDict quality lock must explicitly require no-ship");
  }

  const terms = unique([
    ...decision.positiveCoverage.map((item) => item.term),
    ...decision.misleadingOrWrong.map((item) => item.term),
    ...decision.absentTechnical
  ]);
  const certification = await certifyFreeDictPack({ packDir, terms });
  const translationsByTerm = Object.fromEntries(
    Object.entries(certification.terms).map(([term, hits]) => [
      term,
      unique(hits.flatMap((hit) =>
        hit.senses.flatMap((sense) => sense.translations || [])
      ))
    ])
  );

  const positiveCoverage = decision.positiveCoverage.map((item) => {
    const observed = translationsByTerm[item.term] || [];
    const matched = item.observed.every((value) => observed.includes(value));
    if (!matched) throw new Error("FreeDict positive coverage drift for " + item.term);
    return { term: item.term, observed, matched };
  });

  const misleadingOrWrong = decision.misleadingOrWrong.map((item) => {
    const observed = translationsByTerm[item.term] || [];
    const matched = item.observed.every((value) => observed.includes(value));
    if (!matched) throw new Error("FreeDict misleading-quality evidence drift for " + item.term);
    return { term: item.term, observed, reason: item.reason, matched };
  });

  const absentTechnical = decision.absentTechnical.map((term) => {
    const observed = translationsByTerm[term] || [];
    if (observed.length) throw new Error("FreeDict formerly absent technical term now has data: " + term);
    return { term, absent: true };
  });

  if (!positiveCoverage.length || misleadingOrWrong.length < 3 || absentTechnical.length < 3) {
    throw new Error("FreeDict no-ship quality decision lacks sufficient evidence");
  }

  return {
    status: "no-ship",
    approvedForProductDistribution: false,
    packId: certification.packId,
    packVersion: certification.packVersion,
    fingerprint: certification.fingerprint,
    positiveCoverage,
    misleadingOrWrong,
    absentTechnical,
    rationale: decision.rationale
  };
}

function unique(values) {
  return [...new Set(values)];
}

function resolveRequired(value, label) {
  if (!value) throw new Error(label + " is required");
  return resolve(value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("missing value for --" + key);
    result[key] = value;
    index += 1;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await evaluateFreeDictQuality({
    packDir: args.pack,
    sourceLockPath: args["source-lock"]
  });
  const text = JSON.stringify(result, null, 2) + "\n";
  if (args.out) await writeFile(resolve(args.out), text, "utf8");
  process.stdout.write(text);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
