import test from "node:test";
import assert from "node:assert/strict";
import {
  measureStarDictImportCost,
  parseEntryCounts
} from "../scripts/measure-stardict-import-cost.mjs";

test("StarDict import cost measurement exercises shared parser and TFLex builder", async () => {
  const report = await measureStarDictImportCost({
    entryCount: 8
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.entryCount, 8);
  assert.equal(report.sourceEntryCount, 8);
  assert.equal(report.outputRecordCount, 8);
  assert.equal(report.sourceAliasCount, 0);
  assert.ok(report.sourceBytes.total > 0);
  assert.ok(report.outputBytes.entries > 0);
  assert.ok(report.outputBytes.index > 0);
  assert.ok(
    report.outputBytes.total >
      report.outputBytes.entries
  );
  assert.ok(report.expansionRatio > 0);
  assert.ok(
    report.timingsMs.parserProjection >= 0
  );
  assert.ok(
    report.timingsMs.converterTflex >= 0
  );
  assert.ok(
    report.timingsMs.total >=
      report.timingsMs.parserProjection
  );
  assert.ok(
    report.memory.approximatePeakRssBytes > 0
  );
});

test("StarDict import cost entry-count parser is deterministic and positive-only", () => {
  assert.deepEqual(
    parseEntryCounts("5000,1000,5000"),
    [1000, 5000]
  );
  assert.deepEqual(
    parseEntryCounts(""),
    [1000, 5000, 10000]
  );
  assert.throws(
    () => parseEntryCounts("0,1000"),
    /positive safe integer/
  );
  assert.throws(
    () => parseEntryCounts("1000,nope"),
    /positive safe integer/
  );
});
