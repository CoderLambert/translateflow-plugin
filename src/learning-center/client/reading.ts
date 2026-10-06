import { READING_METHOD as M, READING_PROTOCOL_VERSION as V, READING_INVALIDATION_PORT } from "../../shared/reading/constants.js";
import { validateReadingRequest } from "../../shared/reading/dto.js";
import { validateReadingResponse } from "../../shared/reading/response.js";
import { validateReadingInvalidation, validateReadingSiteMarkersInvalidation } from "../../shared/reading/invalidations.js";
import { READING_SITE_MARKERS_INVALIDATION } from "../../shared/reading/constants.js";
import type { validateRecordListItem, validatePageListItem, validateExclusionItem } from "../../shared/reading/list.js";
import type { validateReadingRecord } from "../../shared/reading/record.js";
import type { validateSourceSnapshot } from "../../shared/reading/source.js";
import type { validateResultArtifact } from "../../shared/reading/artifact.js";
import type { validateHandoff } from "../../shared/reading/lifecycle.js";

export type RecordItem = ReturnType<typeof validateRecordListItem>;
export type PageItem = ReturnType<typeof validatePageListItem>;
export type Exclusion = ReturnType<typeof validateExclusionItem>;
export interface Detail { record: ReturnType<typeof validateReadingRecord>; snapshots: ReturnType<typeof validateSourceSnapshot>[]; artifacts: ReturnType<typeof validateResultArtifact>[] }
export interface RecordingState { enabled: boolean; consentGeneration: number; dataGeneration: number; capacityReached: boolean; recordCount: number; totalBytes: number }
export interface Page<T> { items: T[]; nextCursor: string | null; catalogRevision?: number }
export interface ExportStart { exportId: string; exportRevision: number; nextCursor: string; expiresAt: number }
export interface ExportChunk { sequence: number; jsonChunk: string; nextCursor: string | null; done: boolean; exportRevision: number }
export interface ExportFinish { exportId: string; sequence: number; exportRevision: number; state: "finished" }
export interface SiteMarkers { state: "ready" | "permission-required"; enabled: boolean; permissionGranted: boolean }
export type ReturnHandoff = { state: "ready"; handoff: ReturnType<typeof validateHandoff> } | { state: "permission-required" | "unsupported" };
export type Send = (request: unknown) => Promise<unknown>;
export class ReadingError extends Error {
  constructor(readonly code: string) { super(code); }
}
// Types describe validated DTOs; runtime syntax is owned exclusively by shared/reading.
export class ReadingClient {
  constructor(private readonly send: Send = request => chrome.runtime.sendMessage(request)) {}
  async request<T>(method: string, fields: Record<string, unknown> = {}): Promise<T> {
    const request = validateReadingRequest({ protocolVersion: V, method, ...fields });
    let raw: unknown;
    try { raw = await this.send(request); } catch { throw new ReadingError("READING_DISCONNECTED"); }
    const response = validateReadingResponse(method, raw, "extension");
    if (!response.ok) throw new ReadingError(response.error?.code ?? "READING_BAD_DTO");
    return response.data as T;
  }
  state() { return this.request<RecordingState>(M.GET_RECORDING_STATE); }
  recording(enabled: boolean, expectedConsentGeneration: number) { return this.request<RecordingState>(M.SET_RECORDING, { enabled, expectedConsentGeneration }); }
  records(query: string, pageKey: string | null, cursor: string | null = null) {
    return this.request<Page<RecordItem>>(M.LIST_RECORDS, { query, pageKey, cursor, limit: 30 });
  }
  pages(query: string, cursor: string | null = null) { return this.request<Page<PageItem>>(M.LIST_PAGES, { query, cursor, limit: 30 }); }
  getRecord(recordId: string) { return this.request<Detail>(M.GET_RECORD, { recordId }); }
  recordSiteKey(recordId: string) { return this.request<{ siteKey: string }>(M.GET_RECORD_SITE_KEY, { recordId }); }
  exclusions(cursor: string | null = null) { return this.request<Page<Exclusion>>(M.LIST_RECORDING_EXCLUSIONS, { cursor, limit: 30 }); }
  site(siteKey: string) { return this.request<{ excluded: boolean; sitePolicyRevision: number }>(M.GET_SITE_RECORDING, { siteKey }); }
  setSite(siteKey: string, excluded: boolean, expectedSitePolicyRevision: number) {
    return this.request<{ excluded: boolean; sitePolicyRevision: number }>(M.SET_SITE_RECORDING, { siteKey, excluded, expectedSitePolicyRevision });
  }
  markers(siteKey: string) { return this.request<SiteMarkers>(M.GET_SITE_MARKERS, { siteKey }); }
  setMarkers(siteKey: string, enabled: boolean) { return this.request<SiteMarkers>(M.SET_SITE_MARKERS, { siteKey, enabled }); }
  createHandoff(recordId: string, expectedRevision: number) { return this.request<ReturnHandoff>(M.CREATE_HANDOFF, { recordId, expectedRevision }); }
  previewClaim(previewId: string) { return this.request<{ claimId: string }>(M.PREVIEW_CLAIM, { previewId }); }
  previewRead(previewId: string) { return this.request<Detail>(M.PREVIEW_READ, { previewId }); }
  previewClose(previewId: string) { return this.request<{ closed: true }>(M.PREVIEW_CLOSE, { previewId }); }
  // Called directly by a trusted click, before any asynchronous work.
  requestSitePermission(siteKey: string) { return chrome.permissions.request({ origins: [`${new URL(siteKey).origin}/*`] }); }
}
export const readingClient = new ReadingClient();
export function subscribe(onChange: () => void, onDisconnect: () => void): () => void {
  const port = chrome.runtime.connect({ name: READING_INVALIDATION_PORT });
  let closed = false, previous = "";
  const message = (value: unknown) => {
    try {
      if ((value as { type?: unknown } | null)?.type === READING_SITE_MARKERS_INVALIDATION) {
        validateReadingSiteMarkersInvalidation(value);
        if (!closed) onChange();
        return;
      }
      const current = JSON.stringify(validateReadingInvalidation(value, "extension"));
      if (!closed && previous !== current) { previous = current; onChange(); }
    }
    catch { if (!closed) onDisconnect(); }
  };
  const disconnect = () => { if (!closed) onDisconnect(); };
  port.onMessage.addListener(message); port.onDisconnect.addListener(disconnect);
  return () => { closed = true; port.onMessage.removeListener(message); port.onDisconnect.removeListener(disconnect); port.disconnect(); };
}
