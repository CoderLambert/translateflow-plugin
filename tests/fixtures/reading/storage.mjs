// Direct-source native-IDB probe helpers. Authority here is SYNTHETIC; compiled message tests use native #232 access.
import { request, snapshot, artifact, record, PAGE_KEY } from './contract.mjs';
import { READING_METHOD as M, READING_LIMITS as L } from '../../../src/shared/reading/constants.js';
import { createSourceDigest } from '../../../src/shared/reading/identity.js';
import { sha256 } from '../../../src/shared/hash.js';
import { applicationBytes } from '../../../src/shared/reading/lifecycle.js';
import { projectRecordListItem } from '../../../src/shared/reading/previews.js';
export { M, L, request, snapshot, artifact };
export function access(scope = 'extension', extra = {}) {
  return { scope, ownerKey: 'synthetic-owner', senderVerified: true, allowlisted: true, incognito: false, sensitive: false,
    editable: false, accountPage: false, siteExcluded: false, authorityGeneration: 1, navigationGeneration: 1,
    documentGeneration: 'doc-1', selectionGeneration: 1, pageKey: PAGE_KEY, siteKey: 'https://example.test',
    safeReturnUrl: record().safeReturnUrl, pageTitle: 'Synthetic article', ...extra };
}
export const ctx = (method, extra = {}, scope = 'extension') => ({ request: request(method, extra), access: access(scope), assertCurrent() {} });
export async function source(extra = {}) { const value = snapshot(extra); value.sourceDigest = await createSourceDigest(value); return value; }
export async function begin(repo, extra = {}) {
  const snap = extra.sourceSnapshot || await source(), owner = extra.access || access('content');
  const input = { ...ctx(M.BEGIN_QUERY, { operationId: crypto.randomUUID(), ...extra, sourceSnapshot: snap }, 'content'), access: owner,
    sourceSnapshot: snap, previous: null, issuedAt: 1000, expiresAt: 601000 };
  const prepared = await repo.prepareOperation(input);
  return { access: owner, token: prepared.token, sourceSnapshot: snap, sourceLanguage: input.request.sourceLanguage, revoked: false };
}
export async function save(repo, op, kind = 'dictionary', extra = {}, options = {}) {
  const value = artifact(kind, { recordId: op.token.recordId, operationId: op.token.operationId, sourceSnapshotId: op.sourceSnapshot.sourceSnapshotId,
    artifactId: crypto.randomUUID(), ...extra });
  return repo.mutate({ request: request(kind === 'assistant' ? M.APPEND_ASSISTANT : M.SAVE_QUERY_RESULT, { token: op.token, artifact: value }),
    access: op.access, registeredOperation: op, artifactDigest: await sha256(JSON.stringify(value)), assertCurrent() {}, ...options });
}
export const enable = (repo) => repo.mutate(ctx(M.SET_RECORDING));
export async function rawDatabase() {
  return new Promise((resolve, reject) => { const request = indexedDB.open('translateflow-reading-records', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
export async function seedRecords(count, { answerChars = 0, artifacts = 1 } = {}) {
  // Real canonical rows, exact application billing and list/page projections; no fake capacity counters.
  const db = await rawDatabase();
  let totalBytes = 0;
  const rows = [];
  const snap = await source();
  for (let n = 0; n < count; n++) {
    const id = `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`;
    const rec = record({ recordId: id, lastLookupAt: 1000 + n });
    const values = Array.from({ length: artifacts }, (_, a) => artifact(answerChars ? 'assistant' : 'dictionary', { recordId: id,
      artifactId: `artifact-${String(a).padStart(4, '0')}`, ...(answerChars ? { payload: { ...artifact('assistant').payload, turnId: `turn-${a}`, threadId: `thread-${a}`, assistantAnswer: '😀中'.repeat(Math.floor(answerChars / 3)) } } : {}) }));
    const bytes = applicationBytes([rec, snap, ...values]); totalBytes += bytes;
    rows.push({ record: rec, bytes, siteKey: 'https://example.test', documentGeneration: snap.documentGeneration, sortTime: -rec.lastLookupAt,
      listItem: projectRecordListItem({ record: rec, snapshots: [snap], artifacts: values }, 'https://example.test'), values });
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['records', 'snapshots', 'artifacts', 'pages', 'meta', 'receipts'], 'readwrite');
    for (const name of ['records', 'snapshots', 'artifacts', 'pages', 'receipts']) tx.objectStore(name).clear();
    for (const { values, ...row } of rows) {
      tx.objectStore('records').put(row); tx.objectStore('snapshots').put({ recordId: row.record.recordId, value: snap });
      for (const value of values) tx.objectStore('artifacts').put({ recordId: row.record.recordId, value });
    }
    tx.objectStore('meta').put({ enabled: true, consentGeneration: 2, dataGeneration: 1, catalogRevision: 1, exportRevision: 1, siteRevision: 1,
      sites: [], recordCount: count, totalBytes }, 'state');
    tx.objectStore('pages').put({ pageKey: PAGE_KEY, pageGeneration: 1, pageRevision: 1, recordCount: count, lastLookupAt: 999 + count,
      sortTime: -(999 + count), siteKey: 'https://example.test', pageTitle: 'Synthetic article', safeReturnUrl: record().safeReturnUrl });
    tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
  }); db.close(); return { count, totalBytes, recordId: rows[0]?.record.recordId };
}
export async function counts() {
  const db = await rawDatabase();
  const result = await new Promise((resolve, reject) => { const tx = db.transaction(['records', 'snapshots', 'artifacts', 'receipts', 'meta'], 'readonly'), out = {};
    for (const name of ['records', 'snapshots', 'artifacts', 'receipts']) { const request = tx.objectStore(name).count(); request.onsuccess = () => { out[name] = request.result; }; }
    const request = tx.objectStore('meta').get('state'); request.onsuccess = () => { out.meta = request.result; };
    tx.oncomplete = () => resolve(out); tx.onabort = () => reject(tx.error);
  }); db.close(); return result;
}
