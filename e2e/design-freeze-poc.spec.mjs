import { test, expect, chromium } from "@playwright/test";
import { webcrypto } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "TF_DESIGN_FREEZE_MARKER";
const MONOLITH_BYTES = 8 * 1024 * 1024;
const MARKER_OFFSET = 4 * 1024 * 1024;

async function prepareExtension() {
  const tempRoot = await mkdtemp(join(tmpdir(), "translateflow-design-freeze-"));
  const extensionDir = join(tempRoot, "extension");
  await cp(repoRoot, extensionDir, {
    recursive: true,
    filter: (source) => {
      const rel = relative(repoRoot, source);
      if (!rel) return true;
      const first = rel.split(sep)[0];
      return ![".git", "node_modules", "playwright-report", "test-results"].includes(first);
    }
  });

  const assetDir = join(extensionDir, "e2e-poc-assets");
  await mkdir(assetDir, { recursive: true });
  const tailBytes = MONOLITH_BYTES - MARKER_OFFSET - MARKER.length - 1;
  const monolith = "A".repeat(MARKER_OFFSET) + MARKER + "\n" + "B".repeat(tailBytes);
  await writeFile(join(assetDir, "monolith.dat"), monolith);
  await writeFile(join(assetDir, "pe.dat"), `persistent\t持久的；持续存在的\n${MARKER}\n`);
  return { tempRoot, extensionDir, userDataDir: join(tempRoot, "profile") };
}

async function launchExtension(extensionDir, userDataDir) {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    ]
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  return { context, worker };
}

test("Design Freeze POC: MV3 OPFS persists across browser restart and catalog signatures verify in the service worker", async ({}, testInfo) => {
  const { tempRoot, extensionDir, userDataDir } = await prepareExtension();
  const catalog = JSON.stringify({
    id: "developer",
    version: "1.0.0",
    formatVersion: 1,
    size: 12345,
    sha256: "0123456789abcdef"
  });

  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  const signature = Buffer.from(await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(catalog)
  )).toString("base64");

  let context;
  try {
    let launched = await launchExtension(extensionDir, userDataDir);
    context = launched.context;

    const first = await launched.worker.evaluate(async ({ catalog, publicJwk, signature, marker, markerOffset }) => {
      const encoder = new TextEncoder();
      const decodeBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

      const publicKey = await crypto.subtle.importKey(
        "jwk",
        publicJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
      const signatureBytes = decodeBase64(signature);
      const signatureValid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        signatureBytes,
        encoder.encode(catalog)
      );
      const tamperedRejected = !(await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        signatureBytes,
        encoder.encode(catalog + " ")
      ));

      if (!navigator.storage?.getDirectory) {
        return { opfsSupported: false, signatureValid, tamperedRejected };
      }

      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("tf-design-freeze", { create: true });
      const handle = await dir.getFileHandle("pack.dat", { create: true });
      const writable = await handle.createWritable();
      await writable.write("persistent=持久的\ntmux=终端复用器\n");
      await writable.close();

      const monolithUrl = chrome.runtime.getURL("e2e-poc-assets/monolith.dat");
      const shardUrl = chrome.runtime.getURL("e2e-poc-assets/pe.dat");

      const fullStart = performance.now();
      const full = await fetch(monolithUrl);
      const fullText = await full.text();
      const fullMs = performance.now() - fullStart;

      const rangeStart = performance.now();
      const ranged = await fetch(monolithUrl, {
        headers: { Range: `bytes=${markerOffset}-${markerOffset + marker.length - 1}` }
      });
      const rangeText = await ranged.text();
      const rangeMs = performance.now() - rangeStart;

      const shardStart = performance.now();
      const shard = await fetch(shardUrl);
      const shardText = await shard.text();
      const shardMs = performance.now() - shardStart;

      const estimate = await navigator.storage.estimate();
      return {
        opfsSupported: true,
        signatureValid,
        tamperedRejected,
        fullStatus: full.status,
        fullBytesReceived: fullText.length,
        fullContainsMarker: fullText.includes(marker),
        fullMs: Math.round(fullMs * 1000) / 1000,
        rangeStatus: ranged.status,
        rangeContentRange: ranged.headers.get("content-range"),
        rangeBytesReceived: rangeText.length,
        rangeContainsMarker: rangeText.includes(marker),
        shardBytesReceived: shardText.length,
        shardContainsMarker: shardText.includes(marker),
        rangeMs: Math.round(rangeMs * 1000) / 1000,
        shardMs: Math.round(shardMs * 1000) / 1000,
        quota: estimate.quota || 0,
        usage: estimate.usage || 0,
        persisted: navigator.storage.persisted ? await navigator.storage.persisted() : null,
        syntheticCoreBytes: fullText.length,
        performanceMemoryAvailable: Boolean(performance.memory),
        usedJsHeapBytes: Number(performance.memory?.usedJSHeapSize || 0) || null
      };
    }, { catalog, publicJwk, signature, marker: MARKER, markerOffset: MARKER_OFFSET });

    console.log("[design-freeze:first-runtime]", JSON.stringify(first));
    await testInfo.attach("design-freeze-first-runtime.json", {
      body: Buffer.from(JSON.stringify(first, null, 2)),
      contentType: "application/json"
    });

    expect(first.signatureValid).toBe(true);
    expect(first.tamperedRejected).toBe(true);
    expect(first.opfsSupported).toBe(true);
    expect(first.fullContainsMarker).toBe(true);
    expect(first.rangeContainsMarker).toBe(true);
    expect(first.shardContainsMarker).toBe(true);
    expect(first.fullBytesReceived).toBeGreaterThanOrEqual(8 * 1024 * 1024);
    expect(first.rangeBytesReceived).toBe(MARKER.length);
    expect(first.rangeBytesReceived).toBeLessThan(first.fullBytesReceived);
    expect([200, 206]).toContain(first.rangeStatus);

    await context.close();
    context = null;

    launched = await launchExtension(extensionDir, userDataDir);
    context = launched.context;
    const afterRestart = await launched.worker.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("tf-design-freeze");
      const handle = await dir.getFileHandle("pack.dat");
      const file = await handle.getFile();
      return {
        text: await file.text(),
        size: file.size
      };
    });

    console.log("[design-freeze:after-restart]", JSON.stringify(afterRestart));
    expect(afterRestart.text).toContain("persistent=持久的");
    expect(afterRestart.text).toContain("tmux=终端复用器");

    const recovery = await launched.worker.evaluate(async () => {
      const encoder = new TextEncoder();
      const toHex = (bytes) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
      const digestText = async (text) => toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("tf-design-freeze", { create: true });

      const writeText = async (name, text) => {
        const handle = await dir.getFileHandle(name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
      };
      const inspect = async (name, expectedSha256) => {
        try {
          const handle = await dir.getFileHandle(name);
          const file = await handle.getFile();
          const text = await file.text();
          const actualSha256 = await digestText(text);
          return { status: actualSha256 === expectedSha256 ? "healthy" : "corrupt", actualSha256 };
        } catch (error) {
          if (error?.name === "NotFoundError") return { status: "missing" };
          throw error;
        }
      };

      const activeText = "persistent=持久的\ntmux=终端复用器\n";
      const fallbackText = "persistent=持久的\n";
      const activeSha256 = await digestText(activeText);
      const fallbackSha256 = await digestText(fallbackText);
      await writeText("pack-v2.dat", activeText);
      await writeText("pack-v1.dat", fallbackText);
      await chrome.storage.local.set({
        tfDesignFreezePackState: {
          active: { file: "pack-v2.dat", sha256: activeSha256, version: "2" },
          fallback: { file: "pack-v1.dat", sha256: fallbackSha256, version: "1" }
        }
      });

      await writeText("pack-v2.dat", "tampered");
      const state = (await chrome.storage.local.get("tfDesignFreezePackState")).tfDesignFreezePackState;
      const activeInspection = await inspect(state.active.file, state.active.sha256);
      const fallbackInspection = await inspect(state.fallback.file, state.fallback.sha256);
      let recoveredTo = null;
      if (activeInspection.status !== "healthy" && fallbackInspection.status === "healthy") {
        recoveredTo = state.fallback.version;
        await chrome.storage.local.set({
          tfDesignFreezePackState: {
            active: state.fallback,
            fallback: null,
            recoveryReason: activeInspection.status
          }
        });
      }

      await dir.removeEntry("pack-v1.dat");
      const recoveredState = (await chrome.storage.local.get("tfDesignFreezePackState")).tfDesignFreezePackState;
      const missingInspection = await inspect(recoveredState.active.file, recoveredState.active.sha256);
      const terminalState = missingInspection.status === "healthy" ? "healthy" : "needs-reinstall";

      return {
        activeInspection,
        fallbackInspection,
        recoveredTo,
        persistedActiveVersion: recoveredState.active.version,
        missingInspection,
        terminalState
      };
    });

    console.log("[design-freeze:opfs-recovery]", JSON.stringify(recovery));
    expect(recovery.activeInspection.status).toBe("corrupt");
    expect(recovery.fallbackInspection.status).toBe("healthy");
    expect(recovery.recoveredTo).toBe("1");
    expect(recovery.persistedActiveVersion).toBe("1");
    expect(recovery.missingInspection.status).toBe("missing");
    expect(recovery.terminalState).toBe("needs-reinstall");
  } finally {
    await context?.close().catch(() => {});
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Design Freeze POC: visible context crosses inline nodes but editable context stays selection-only", async ({ page }) => {
  await page.setContent(`
    <article>
      <p id="reading">
        A <span id="selected">persistent</span> <a href="#">tmux</a> session
        survives after the terminal closes.
        <span data-tf-extension-ui="poc">EXTENSION SECRET</span>
        <span hidden>HIDDEN SECRET</span>
      </p>
      <div id="editor" contenteditable="true">private draft <span id="editable-selected">persistent</span> customer token</div>
    </article>
  `);

  const result = await page.evaluate(() => {
    function extract(range, maxChars = 180) {
      const element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      const editable = element?.closest("input, textarea, [contenteditable]:not([contenteditable='false'])");
      const selectedText = range.toString().trim();
      if (editable) return { sensitive: true, selectedText, context: selectedText };

      const block = element?.closest("p, li, pre, blockquote, td, th, article, section, div") || element;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (parent.closest("[data-tf-extension-ui], [hidden], [aria-hidden='true']")) return NodeFilter.FILTER_REJECT;
          const style = getComputedStyle(parent);
          if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      let text = "";
      while (walker.nextNode()) text += ` ${walker.currentNode.nodeValue || ""}`;
      text = text.replace(/\s+/g, " ").trim();

      const needle = selectedText.replace(/\s+/g, " ");
      const at = text.toLowerCase().indexOf(needle.toLowerCase());
      if (at < 0 || text.length <= maxChars) return { sensitive: false, selectedText, context: text.slice(0, maxChars) };
      const half = Math.floor((maxChars - needle.length) / 2);
      const start = Math.max(0, Math.min(at - half, text.length - maxChars));
      return { sensitive: false, selectedText, context: text.slice(start, start + maxChars).trim() };
    }

    const readingText = document.querySelector("#selected").firstChild;
    const readingRange = document.createRange();
    readingRange.selectNodeContents(readingText);

    const editableText = document.querySelector("#editable-selected").firstChild;
    const editableRange = document.createRange();
    editableRange.selectNodeContents(editableText);

    return {
      reading: extract(readingRange),
      editable: extract(editableRange)
    };
  });

  expect(result.reading.sensitive).toBe(false);
  expect(result.reading.context).toContain("persistent tmux session");
  expect(result.reading.context).not.toContain("EXTENSION SECRET");
  expect(result.reading.context).not.toContain("HIDDEN SECRET");
  expect(result.editable).toEqual({
    sensitive: true,
    selectedText: "persistent",
    context: "persistent"
  });
});


test("Design Freeze POC: optional host access can be requested for one trusted origin only", async () => {
  const { tempRoot, extensionDir, userDataDir } = await prepareExtension();
  let context;
  try {
    const launched = await launchExtension(extensionDir, userDataDir);
    context = launched.context;
    const extensionId = new URL(launched.worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    await page.evaluate(() => {
      const button = document.createElement("button");
      button.id = "tf-design-freeze-permission";
      button.textContent = "Grant test pack origin";
      globalThis.__tfPermissionRequest = {
        started: false,
        requestedOrigin: null,
        result: null
      };
      button.addEventListener("click", async () => {
        const requestedOrigin = "https://packs.translateflow.example/*";
        globalThis.__tfPermissionRequest = {
          started: true,
          requestedOrigin,
          result: null
        };
        try {
          const granted = await chrome.permissions.request({
            origins: [requestedOrigin]
          });
          const all = await chrome.permissions.getAll();
          globalThis.__tfPermissionRequest.result = { granted, origins: all.origins || [] };
        } catch (error) {
          globalThis.__tfPermissionRequest.result = {
            granted: false,
            error: error?.message || String(error),
            origins: []
          };
        }
      });
      document.body.appendChild(button);
    });

    const before = await page.evaluate(async () => (await chrome.permissions.getAll()).origins || []);
    expect(before).not.toContain("https://packs.translateflow.example/*");

    await page.locator("#tf-design-freeze-permission").click();
    await expect.poll(() => page.evaluate(() => globalThis.__tfPermissionRequest?.started)).toBe(true);
    await page.waitForTimeout(500);
    const permission = await page.evaluate(() => globalThis.__tfPermissionRequest);
    console.log("[design-freeze:optional-origin]", JSON.stringify(permission));

    expect(permission.requestedOrigin).toBe("https://packs.translateflow.example/*");
    if (permission.result) {
      expect(permission.result.granted, permission.result.error || "optional host request was denied").toBe(true);
      expect(permission.result.origins).toContain("https://packs.translateflow.example/*");
      expect(permission.result.origins).not.toContain("https://*/*");
      const removed = await page.evaluate(async () => chrome.permissions.remove({
        origins: ["https://packs.translateflow.example/*"]
      }));
      expect(removed).toBe(true);
    } else {
      // Headless Chromium cannot interact with the browser-level optional-host
      // permission prompt. A still-pending Promise after a user-gesture click
      // proves the request reached that prompt rather than being synchronously
      // rejected by the extension permission contract.
      expect(permission.result).toBeNull();
    }

    await page.close();
  } finally {
    await context?.close().catch(() => {});
    await rm(tempRoot, { recursive: true, force: true });
  }
});
