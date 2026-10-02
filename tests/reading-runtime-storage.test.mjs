import test from "node:test";
import assert from "node:assert/strict";
import { configureReadingRuntime, handleReadingMessage } from "../src/background/reading-record/runtime.js";
import { READING_METHOD as M, READING_ERROR as E } from "../src/shared/reading/constants.js";
import { request } from "./fixtures/reading/contract.mjs";
import { nativeBrowser, extensionSender } from "./fixtures/reading/access.mjs";

test("Runtime factory and rejected native authority never open IndexedDB or consent", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"), browser = globalThis.chrome;
  let touches = 0;
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, get() { touches++; throw new Error("must remain lazy"); } });
  globalThis.chrome = nativeBrowser();
  try {
    configureReadingRuntime();
    const denied = await handleReadingMessage(request(M.GET_RECORDING_STATE), { url: "https://untrusted.invalid/" });
    assert.equal(denied.ok, false); assert.equal(denied.error.code, E.FORBIDDEN);
    const unavailable = await handleReadingMessage(request(M.OPEN_LEARNING_CENTER), extensionSender());
    assert.equal(unavailable.ok, false); assert.equal(unavailable.error.code, E.NOT_READY);
    configureReadingRuntime();
    assert.equal(touches, 0, "No native database access before an authorized repository operation");
  } finally {
    configureReadingRuntime({ repository: null }); globalThis.chrome = browser;
    if (descriptor) Object.defineProperty(globalThis, "indexedDB", descriptor); else delete globalThis.indexedDB;
  }
});

test("Runtime replacement detaches injected publisher but retains caller-owned repository", () => {
  const browser = globalThis.chrome; globalThis.chrome = nativeBrowser();
  const publications = []; let closes = 0;
  const repository = { setInvalidationPublisher(value) { publications.push(value); }, close() { closes++; } };
  try {
    const configured = configureReadingRuntime({ repository });
    assert.equal(typeof publications[0], "function");
    assert.equal(configured.publishInvalidation, publications[0]);
    configureReadingRuntime();
    assert.equal(publications.length, 2); assert.equal(publications[1], null);
    assert.equal(closes, 0, "Only a default repository owned by runtime may be closed");
  } finally { configureReadingRuntime({ repository: null }); globalThis.chrome = browser; }
});
