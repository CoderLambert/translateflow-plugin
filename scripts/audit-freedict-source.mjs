#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function parseFreeDictTeiHeader(teiText) {
  const source = String(teiText || "");
  const headerMatch = source.match(/<teiHeader\b[^>]*>([\s\S]*?)<\/teiHeader>/i);
  if (!headerMatch) throw new Error("FreeDict TEI header is missing");
  const header = headerMatch[1];

  const title = textOf(header, "title");
  const edition = textOf(header, "edition");
  const extentText = textOf(header, "extent");
  const headwordsMatch = extentText.match(/([0-9][0-9,]*)\s+headwords?\b/i);
  if (!headwordsMatch) throw new Error("FreeDict TEI headword extent is missing");
  const publisher = textOf(header, "publisher");
  const maintainer = matchText(
    header,
    /<respStmt\b[^>]*>[\s\S]*?<resp\b[^>]*>\s*Maintainer\s*<\/resp>[\s\S]*?<name\b[^>]*>([\s\S]*?)<\/name>[\s\S]*?<\/respStmt>/i,
    "maintainer"
  );
  const availabilityMatch = header.match(
    /<availability\b[^>]*>([\s\S]*?)<\/availability>/i
  );
  if (!availabilityMatch) throw new Error("FreeDict TEI availability is missing");
  const licenseRef = availabilityMatch[1].match(
    /<ref\b[^>]*\btarget=["']([^"']+)["'][^>]*>([\s\S]*?)<\/ref>/i
  );
  if (!licenseRef) throw new Error("FreeDict TEI license reference is missing");
  const publicationDate = matchText(
    header,
    /<publicationStmt\b[^>]*>[\s\S]*?<date\b[^>]*>([\s\S]*?)<\/date>[\s\S]*?<\/publicationStmt>/i,
    "publication date"
  );
  const sourceDesc = matchText(
    header,
    /<sourceDesc\b[^>]*>([\s\S]*?)<\/sourceDesc>/i,
    "source description"
  );

  return {
    title,
    edition,
    headwords: Number(headwordsMatch[1].replaceAll(",", "")),
    publisher,
    maintainer,
    publicationDate,
    licenseUrl: decodeXml(licenseRef[1].trim()),
    licenseName: cleanXmlText(licenseRef[2]),
    sourceDescription: cleanXmlText(sourceDesc)
  };
}

export function classifyFreeDictLicense(header, copyingText) {
  const copying = String(copyingText || "");
  const bySa3 =
    header?.licenseUrl === "https://creativecommons.org/licenses/by-sa/3.0/legalcode" &&
    /Creative Commons Attribution-ShareAlike 3\.0 Unported/i.test(header?.licenseName || "") &&
    /License Elements[\s\S]*Attribution, ShareAlike/i.test(copying) &&
    /Creative Commons Corporation/i.test(copying);
  return bySa3 ? "CC-BY-SA-3.0" : "UNVERIFIED";
}

export async function auditFreeDictSource({
  archivePath,
  teiPath,
  copyingPath,
  lockPath
}) {
  const [archiveBytes, teiText, copyingText, lockText] = await Promise.all([
    readFile(requiredPath(archivePath, "archivePath")),
    readFile(requiredPath(teiPath, "teiPath"), "utf8"),
    readFile(requiredPath(copyingPath, "copyingPath"), "utf8"),
    readFile(requiredPath(lockPath, "lockPath"), "utf8")
  ]);
  const lock = JSON.parse(lockText);
  const expectedSha512 = String(
    lock?.source?.archiveSha512 || lock?.source?.sha512 || ""
  ).toLowerCase();
  if (!/^[a-f0-9]{128}$/.test(expectedSha512)) {
    throw new Error("FreeDict source lock SHA-512 is invalid");
  }
  const actualSha512 = digest("sha512", archiveBytes);
  if (actualSha512 !== expectedSha512) {
    throw new Error("FreeDict archive SHA-512 mismatch");
  }
  const expectedArchiveSize = Number(
    lock?.source?.archiveSizeBytes ?? lock?.source?.sizeBytes
  );
  if (archiveBytes.byteLength !== expectedArchiveSize) {
    throw new Error("FreeDict archive size mismatch");
  }

  const header = parseFreeDictTeiHeader(teiText);
  const licenseId = classifyFreeDictLicense(header, copyingText);
  const result = {
    dictionary: lock.dictionary || lock?.source?.dictionary,
    releaseEdition: lock.edition || lock?.source?.edition,
    archive: {
      url: lock.source.url,
      sizeBytes: archiveBytes.byteLength,
      sha512: actualSha512
    },
    tei: {
      ...header,
      sizeBytes: Buffer.byteLength(teiText),
      sha256: digest("sha256", Buffer.from(teiText, "utf8"))
    },
    copying: {
      sizeBytes: Buffer.byteLength(copyingText),
      sha256: digest("sha256", Buffer.from(copyingText, "utf8")),
      licenseId
    },
    provenanceChecks: {
      wikDict: /\bWikDict\b/i.test(header.sourceDescription),
      wiktionary: /\bWiktionary(?:\.org)?\b/i.test(header.sourceDescription),
      dbnary: /\bDBnary\b/i.test(header.sourceDescription)
    }
  };
  if (result.dictionary !== "eng-zho") throw new Error("unexpected FreeDict dictionary lock");
  if (licenseId === "UNVERIFIED") throw new Error("FreeDict exact archive license could not be verified");
  if (!Object.values(result.provenanceChecks).every(Boolean)) {
    throw new Error("FreeDict TEI provenance markers are incomplete");
  }
  if (!Number.isSafeInteger(header.headwords) || header.headwords <= 0) {
    throw new Error("FreeDict TEI headword count is invalid");
  }
  return result;
}

function textOf(source, tag) {
  return matchText(
    source,
    new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i"),
    tag
  );
}

function matchText(source, expression, label) {
  const match = String(source || "").match(expression);
  if (!match) throw new Error("FreeDict TEI " + label + " is missing");
  return cleanXmlText(match[1]);
}

function cleanXmlText(value) {
  return decodeXml(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_all, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function digest(algorithm, bytes) {
  return createHash(algorithm).update(bytes).digest("hex");
}

function requiredPath(value, label) {
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
  const result = await auditFreeDictSource({
    archivePath: args.archive,
    teiPath: args.tei,
    copyingPath: args.copying,
    lockPath: args.lock
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
