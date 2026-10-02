import { performance } from "node:perf_hooks";
import { READING_LIMITS as L } from "../src/shared/reading/constants.js";
import { createReadingItemKey, createSourceDigest } from "../src/shared/reading/identity.js";
import { applicationBytes, checkWriteEligibility, checkHandoff } from "../src/shared/reading/lifecycle.js";
import { validateRecordDetail } from "../src/shared/reading/record.js";
import { projectSourceSegments } from "../src/shared/reading/source.js";
import { validatePageSummaryItem } from "../src/shared/reading/response.js";
import { artifact, handoff, PAGE_KEY, record, snapshot, token } from "../tests/fixtures/reading/contract.mjs";

const repeat = (value, length) => value.repeat(Math.ceil(length / value.length)).slice(0, length);
function detail(index) {
  const recordId = `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
  const selectedText = `Synthetic selected phrase ${index}`;
  const anchor = { ...snapshot().anchor, quote: { exact: selectedText, prefix: "Synthetic prefix. ", suffix: " Synthetic suffix." },
    position: { start: index * 30, end: index * 30 + selectedText.length } };
  const source = snapshot({ sourceSnapshotId: `source-${index}`, selectedText,
    contextText: repeat("Synthetic visible context 合成上下文. ", 900), anchor });
  const summary = record({ recordId, itemText: selectedText, itemKey: createReadingItemKey(selectedText, "en"), anchor });
  const common = { recordId, sourceSnapshotId: source.sourceSnapshotId, operationId: `op-${index}` };
  const dictionary = artifact("dictionary", { ...common, artifactId: `dictionary-${index}`,
    payload: { ...artifact().payload, headword: selectedText,
      definitions: Array.from({ length: 6 }, () => repeat("Synthetic definition 合成释义. ", 120)) } });
  const translation = artifact("translation", { ...common, artifactId: `translation-${index}`,
    payload: { text: repeat("Synthetic translation 合成译文. ", 300) } });
  const assistant = artifact("assistant", { ...common, artifactId: `assistant-${index}`,
    payload: { ...artifact("assistant").payload, assistantAnswer: repeat("Synthetic explanation 合成说明. ", 700),
      threadId: `thread-${index}`, turnId: `turn-${index}`, branchId: `branch-${index}` } });
  return { record: summary, snapshots: [source], artifacts: [dictionary, translation, assistant] };
}
function timed(fn, repeats = 5) {
  const values = [];
  let result;
  for (let index = 0; index < repeats; index++) {
    const start = performance.now(); result = fn(); values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  return { result, medianMs: Number(values[Math.floor(values.length / 2)].toFixed(3)), maxMs: Number(values.at(-1).toFixed(3)) };
}
const markerDTO = (value) => validatePageSummaryItem({ recordId: value.record.recordId,
  revision: value.record.revision, anchor: value.record.anchor });
if (process.argv.includes("--markers-only")) {
  const sample = Array.from({ length: L.pageMarkers }, (_, index) => detail(index + 1));
  const measured = timed(() => sample.map(markerDTO));
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    fixture: "v1 minimal page-summary items: recordId, revision, saved anchor evidence",
    markers: { count: measured.result.length, dtoBytes: applicationBytes(measured.result), medianMs: measured.medianMs, maxMs: measured.maxMs },
    limitations: ["Only affected marker DTO construction/bytes remeasured; original full projection evidence is retained.",
      "Saved anchor status is capture evidence, not current DOM resolution; no DOM/layout/IDB/E2E measured."]
  }, null, 2));
  process.exit(0);
}
const samples = Array.from({ length: L.records }, (_, index) => detail(index + 1));
await Promise.all(samples.map(async (value) => { value.snapshots[0].sourceDigest = await createSourceDigest(value.snapshots[0]); }));
const rows = samples.flatMap((value) => [value.record, ...value.snapshots, ...value.artifacts]);
const accounting = timed(() => applicationBytes(rows), 3);
const totalBytes = accounting.result;
const validation = timed(() => { for (const value of samples) validateRecordDetail(value); }, 3);
const slice = Array.from({ length: 500 }, (_, index) => ({ text: repeat("Inline synthetic text. ", 31), nodeKey: `node-${index}`, blockStart: index % 10 === 0, excluded: false }));
const sliceProjection = timed(() => projectSourceSegments(slice));
const totalProjection = timed(() => projectSourceSegments(Array.from({ length: 25000 }, (_, index) =>
  ({ text: repeat("Synthetic text. ", 39), nodeKey: `node-${index}`, blockStart: index % 10 === 0, excluded: false }))), 3);
const markers = timed(() => samples.slice(0, L.pageMarkers).map(markerDTO));
const gate = timed(() => { for (let index = 0; index < 10000; index++) checkWriteEligibility(token(), { ...token(), enabled: true, deleted: false }, 1001); });
const handoffGate = timed(() => { for (let index = 0; index < 10000; index++) checkHandoff(handoff(), { ...handoff(), deleted: false, incognito: false, permissionGranted: true }, 1001); });
const first = samples[0].snapshots[0];
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch,
  fixture: { records: samples.length, snapshotsPerRecord: 1, artifactsPerRecord: 3, contextUtf16: 900,
    definitions: "6 x 120 UTF-16 mixed-language", translationUtf16: 300, answerUtf16: 700 },
  storage: { totalBytes, averageRecordAggregateBytes: Number((totalBytes / samples.length).toFixed(1)),
    largestArtifactBytes: Math.max(...samples[0].artifacts.map((value) => applicationBytes([value]))),
    capacityUtilization: Number((totalBytes / L.totalBytes).toFixed(4)),
    countAtByteLimitForThisShape: Math.floor(L.totalBytes / (totalBytes / samples.length)),
    accountingMedianMs: accounting.medianMs, validationMedianMs: validation.medianMs },
  projection: { sliceNodes: slice.length, sliceUtf16: sliceProjection.result.text.length,
    sliceMedianMs: sliceProjection.medianMs, sliceMaxMs: sliceProjection.maxMs,
    totalNodes: 25000, totalUtf16: totalProjection.result.text.length, totalMedianMs: totalProjection.medianMs,
    timeBudgetMayStopBeforeCharLimit: totalProjection.medianMs > L.scanTotalMs },
  markers: { count: markers.result.length, dtoBytes: applicationBytes(markers.result), medianMs: markers.medianMs },
  validityChecks: { iterations: 10000, operationMedianMs: gate.medianMs, handoffMedianMs: handoffGate.medianMs,
    operationTtlMs: L.operationTtlMs, handoffTtlMs: L.handoffTtlMs },
  digestCheck: { length: (await createSourceDigest(first)).length, pageKeyExampleFormat: PAGE_KEY.split(":")[0] },
  limitations: ["Synthetic Node experiment; no DOM layout, browser timing, IDB transaction, browser quota or provider calls measured.",
    "Time budget is a yield/stop rule, not a guarantee to finish the character/node ceiling.",
    "TTL values are conservative policy windows; boundary rejection is executable, not browser lifetime evidence."]
}, null, 2));
