// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "../../../src/learning-center/App";
import { ReadingClient } from "../../../src/learning-center/client/reading";
import { Library } from "../../../src/learning-center/views/Library";
import { Detail } from "../../../src/learning-center/views/Detail";
import { createI18n } from "../../../src/i18n/index.js";
import { useLibrary } from "../../../src/learning-center/useLibrary";
import { READING_METHOD as M } from "../../../src/shared/reading/constants.js";
import { response, record, artifact, snapshot, recordListItem, RECORD_ID } from "../../fixtures/reading/contract.mjs";
import { validateRecordDetail } from "../../../src/shared/reading/record.js";
beforeEach(() => {
  history.replaceState(null, "", "/");
  vi.stubGlobal("chrome", { i18n: { getUILanguage: () => "en" }, storage: { local: { get: async () => ({ uiLocale: "en" }) }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const i18n = createI18n({ uiLocale: "en" });
test("StrictMode mount and synthetic events do not grant consent or start exports", async () => {
  const calls: string[] = []; let enabled = false;
  const client = new ReadingClient(async raw => {
    const request = raw as { method: string; expectedConsentGeneration?: number }; calls.push(request.method);
    if (request.method === M.SET_RECORDING) { expect(request.expectedConsentGeneration).toBe(1); enabled = true; }
    if ((request.method === M.GET_RECORDING_STATE || request.method === M.SET_RECORDING)) return response(request.method, "extension", { data: { enabled, consentGeneration: enabled ? 2 : 1, capacityReached: false, dataGeneration: 1, recordCount: 0, totalBytes: 0 } });
    if ((request.method === M.LIST_RECORDS || request.method === M.LIST_RECORDING_EXCLUSIONS)) return response(request.method, "extension", { data: { items: [], nextCursor: null, ...(request.method === M.LIST_RECORDS ? { catalogRevision: 1 } : {}) } });
    throw Error("Unexpected mutation");
  });
  const dispose = vi.fn(), listen = vi.fn(() => dispose);
  render(<StrictMode><App client={client} listen={listen} /></StrictMode>);
  await screen.findByRole("button", { name: "Enable recording" });
  expect(calls).not.toContain(M.SET_RECORDING); expect(calls).not.toContain(M.EXPORT_START);
  expect(dispose).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(calls).not.toContain(M.SET_RECORDING);
  await userEvent.click(screen.getByRole("button", { name: "Enable recording" }));
  expect(calls.filter(method => method === M.SET_RECORDING)).toHaveLength(0);
});
test("literal searches discard a late old response and never request row details", async () => {
  let release: ((value: unknown) => void) | undefined;
  const calls: string[] = [];
  const client = new ReadingClient(raw => {
    const request = raw as { method: string; query: string }; calls.push(request.method);
    if (request.query === "old") return new Promise(resolve => { release = resolve; });
    return Promise.resolve(response(M.LIST_RECORDS, "extension", { data: { items: [], nextCursor: null, catalogRevision: 1 } }));
  });
  function Search({ query }: { query: string }) {
    const library = useLibrary(client, "recent", query, null, 0, true);
    return <Library {...library} i18n={i18n} mode="recent" query={query} disabled={false} onMore={library.next} onRetry={library.retry} onRecord={() => {}} onPage={() => {}} />;
  }
  const view = render(<Search query="old" />); await waitFor(() => expect(release).toBeDefined());
  view.rerender(<Search query="new" />); await screen.findByText("No matching records.");
  await act(async () => { release?.(response(M.LIST_RECORDS)); });
  expect(screen.queryByText("React")).toBeNull(); expect(calls.every(method => method === M.LIST_RECORDS)).toBe(true);
});
test("untrusted stored answer is text and only five large artifact bodies render initially", () => {
  const artifacts = Array.from({ length: 12 }, (_, index) => artifact("translation", { artifactId: `artifact-${index}`, payload: { text: '<img src="https://evil.test/x" onerror="alert(1)">' } }));
  const detail = validateRecordDetail({ record: record(), snapshots: [snapshot()], artifacts });
  const { container } = render(<Detail detail={detail} i18n={i18n} onBack={() => {}} onDelete={() => {}} disabled={false} />);
  expect(container.querySelectorAll(".artifact")).toHaveLength(5); expect(container.querySelector("img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load more" })); expect(container.querySelectorAll(".artifact")).toHaveLength(10);
});
test("history follow-up renders partial text, Stop saves nothing, and complete refreshes only after saved ACK", async () => {
  type Listener = (value: unknown) => void;
  const ports: Array<{ sent: any[]; message?: Listener; disconnect?: () => void }> = [];
  (chrome as any).runtime = { connect: () => {
    const state: { sent: any[]; message?: Listener; disconnect?: () => void } = { sent: [] }; ports.push(state);
    return { postMessage: (value: unknown) => state.sent.push(value), disconnect: vi.fn(),
      onMessage: { addListener: (value: Listener) => { state.message = value; }, removeListener: vi.fn() },
      onDisconnect: { addListener: (value: () => void) => { state.disconnect = value; }, removeListener: vi.fn() } };
  } };
  const onSaved = vi.fn();
  const detail = validateRecordDetail({ record: record({ revision: 2 }), snapshots: [snapshot()], artifacts: [artifact(), artifact("assistant")] });
  render(<Detail detail={detail} i18n={i18n} onBack={() => {}} onDelete={() => {}} onAssistantSaved={onSaved} disabled={false} />);
  expect(screen.getByText("This synthetic passage refers to a UI library.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Ask a follow-up" }));
  await userEvent.type(screen.getByPlaceholderText("Ask about this saved answer"), "Why here?");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  const first = ports[0]!, start = first.sent[0];
  expect(start).toMatchObject({ recordId: RECORD_ID, recordRevision: 2, sourceSnapshotId: "source-1",
    targetTurnId: "turn-1", historyAction: "follow-up", question: "Why here?" });
  expect(start).not.toHaveProperty("text"); expect(start).not.toHaveProperty("history");
  act(() => { first.message?.({ protocolVersion: 1, requestId: start.requestId, type: "started", mode: "stream" });
    first.message?.({ protocolVersion: 1, requestId: start.requestId, type: "delta", sequence: 0, text: "Partial" }); });
  expect(screen.getByText("Partial")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(first.sent.at(-1)).toEqual({ type: "cancel", requestId: start.requestId });
  act(() => first.message?.({ protocolVersion: 1, requestId: start.requestId, type: "interrupted", code: "CANCELLED", partialChars: 7 }));
  expect(screen.getByText("Stopped. No partial answer was saved.")).toBeTruthy();
  expect(screen.getByText("This synthetic passage refers to a UI library.")).toBeTruthy(); expect(onSaved).not.toHaveBeenCalled();
  await userEvent.click(screen.getAllByRole("button", { name: "Retry" }).at(-1)!);
  const second = ports[1]!, retry = second.sent[0];
  act(() => { second.message?.({ protocolVersion: 1, requestId: retry.requestId, type: "started", mode: "stream" });
    second.message?.({ protocolVersion: 1, requestId: retry.requestId, type: "delta", sequence: 0, text: "Complete" });
    second.message?.({ protocolVersion: 1, requestId: retry.requestId, type: "complete", text: "Complete",
      turn: { completionStatus: "completed" }, saved: { state: "saved", recordId: RECORD_ID, revision: 3, artifactId: "artifact-next", duplicate: false } }); });
  expect(onSaved).toHaveBeenCalledTimes(1);
});
test("React learning center presents a quota terminal as a failure even when Stop raced it", async () => {
  type Listener = (value: unknown) => void;
  const ports: Array<{ sent: any[]; message?: Listener }> = [];
  (chrome as any).runtime = { connect: () => {
    const state: { sent: any[]; message?: Listener } = { sent: [] }; ports.push(state);
    return { postMessage: (value: unknown) => state.sent.push(value), disconnect: vi.fn(),
      onMessage: { addListener: (value: Listener) => { state.message = value; }, removeListener: vi.fn() },
      onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() } };
  } };
  const detail = validateRecordDetail({ record: record({ revision: 2 }), snapshots: [snapshot()], artifacts: [artifact("assistant")] });
  render(<Detail detail={detail} i18n={i18n} onBack={() => {}} onDelete={() => {}} disabled={false} />);
  await userEvent.click(screen.getByRole("button", { name: "Ask a follow-up" }));
  await userEvent.type(screen.getByPlaceholderText("Ask about this saved answer"), "Why here?");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  const session = ports[0]!, start = session.sent[0]!;
  act(() => { session.message?.({ protocolVersion: 1, requestId: start.requestId, type: "started", mode: "stream" });
    session.message?.({ protocolVersion: 1, requestId: start.requestId, type: "delta", sequence: 0, text: "Partial" }); });
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  act(() => session.message?.({ protocolVersion: 1, requestId: start.requestId, type: "interrupted", code: "READING_QUOTA", partialChars: 7 }));
  expect(screen.getByText("The answer was interrupted and was not saved. Your existing history is unchanged.")).toBeTruthy();
  expect(screen.queryByText("Stopped. No partial answer was saved.")).toBeNull();
  expect(screen.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThan(0);
});
test("delete invalidation discards a delayed detail and disconnect removes unconfirmed content", async () => {
  let release: ((value: unknown) => void) | undefined, invalidate: (() => void) | undefined, disconnected: (() => void) | undefined, deleted = false;
  const client = new ReadingClient(raw => {
    const { method } = raw as { method: string };
    if (method === M.GET_RECORD && !deleted) return new Promise(resolve => { release = resolve; });
    if (method === M.GET_RECORD) return Promise.resolve({ protocolVersion: 2, ok: false, error: { code: "READING_NOT_FOUND" } });
    return Promise.resolve(response(method));
  });
  const listen = (change: () => void, disconnect: () => void) => { invalidate = change; disconnected = disconnect; return () => {}; };
  const view = render(<App client={client} listen={listen} />);
  await screen.findByText("React"); await userEvent.click(screen.getByText("React"));
  await waitFor(() => expect(release).toBeDefined());
  await act(async () => { deleted = true; invalidate?.(); release?.(response(M.GET_RECORD)); });
  await screen.findByText("This record is unavailable or was deleted. Return to records.");
  expect(screen.queryByText("合成测试摘要")).toBeNull();
  await act(async () => disconnected?.());
  await screen.findByText("Connection interrupted. Saved content cannot be confirmed. Retry to reconnect.");
  view.unmount();
});


test("record site identity failure stays visible and a single retry restores marker settings without a safe return URL", async () => {
  history.replaceState(null, "", `/#record=${RECORD_ID}`);
  const calls: string[] = []; let siteKeyAttempts = 0;
  const detail = response(M.GET_RECORD).data;
  detail.record.safeReturnUrl = null;
  const client = new ReadingClient(async raw => {
    const request = raw as { method: string };
    calls.push(request.method);
    if (request.method === M.GET_RECORD) return response(M.GET_RECORD, "extension", { data: detail });
    if (request.method === M.GET_RECORD_SITE_KEY) {
      siteKeyAttempts++;
      if (siteKeyAttempts === 1) throw new Error("synthetic one-request failure");
      return response(M.GET_RECORD_SITE_KEY);
    }
    if (request.method === M.GET_SITE_MARKERS) return response(M.GET_SITE_MARKERS);
    if (request.method === M.LIST_RECORDING_EXCLUSIONS) return response(M.LIST_RECORDING_EXCLUSIONS,
      "extension", { data: { items: [], nextCursor: null } });
    return response(request.method);
  });
  const listen = vi.fn(() => vi.fn());
  render(<App client={client} listen={listen} />);
  await screen.findByRole("heading", { name: "Reading history on this site" });
  await screen.findByText("Could not load this record’s site identity. Retry to manage its site markers.");
  expect(calls).not.toContain(M.GET_SITE_MARKERS);
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Enable site markers" });
  expect(siteKeyAttempts).toBe(2);
  expect(calls.filter(method => method === M.GET_SITE_MARKERS)).toHaveLength(1);
});
