import test from "node:test";
import assert from "node:assert/strict";
import { validateTechLock } from "../scripts/audit-wikidata-tech-lock.mjs";

const base = {
  version: 1,
  license: "CC0-1.0",
  entities: [
    {
      qid: "Q1935361",
      revision: 2532735398,
      label: "tmux",
      description: "terminal multiplexer",
      aliases: [],
      types: ["terminal multiplexer", "free software"],
      permanentUrl: "https://www.wikidata.org/w/index.php?title=Q1935361&oldid=2532735398"
    },
    {
      qid: "Q19399674",
      revision: 2531086275,
      label: "React",
      description: "JavaScript library for building user interfaces",
      aliases: ["React.js"],
      types: ["JavaScript library"],
      permanentUrl: "https://www.wikidata.org/w/index.php?title=Q19399674&oldid=2531086275"
    }
  ]
};

test("Wikidata tech lock requires revision-pinned attributable structured entities", () => {
  assert.deepEqual(validateTechLock(base), {
    entityCount: 2,
    qids: ["Q1935361", "Q19399674"],
    ambiguousAliases: []
  });
});

test("Wikidata tech lock rejects non-structured/executable media fields", () => {
  const bad = structuredClone(base);
  bad.entities[0].logo = "Tmux logo.svg";
  assert.throws(() => validateTechLock(bad), /Unexpected field logo/);
});

test("Wikidata tech lock rejects a permanent URL that does not bind the exact revision", () => {
  const bad = structuredClone(base);
  bad.entities[0].permanentUrl = "https://www.wikidata.org/wiki/Q1935361";
  assert.throws(() => validateTechLock(bad), /Permanent URL does not strictly bind Wikidata QID [+] revision/);
});


test("Wikidata tech lock rejects a lookalike non-Wikidata permanent URL", () => {
  const bad = structuredClone(base);
  bad.entities[0].permanentUrl = "https://example.invalid/w/index.php?title=Q1935361&oldid=2532735398";
  assert.throws(() => validateTechLock(bad), /strictly bind Wikidata QID \+ revision/);
});

test("Wikidata tech lock validates optional Chinese structured labels without opening arbitrary fields", () => {
  const enriched = structuredClone(base);
  enriched.entities[0].zhLabel = "tmux";
  enriched.entities[0].zhAliases = ["终端复用器"];
  enriched.entities[0].zhTypes = ["自由软件"];
  assert.equal(validateTechLock(enriched).entityCount, 2);
});
