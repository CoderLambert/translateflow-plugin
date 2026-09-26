import { test, expect, chromium } from "@playwright/test";
import { webcrypto } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "TF_DESIGN_FREEZE_MARKER";
const MARKER_OFFSET = 256 * 1024;

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
  const monolith = "A".repeat(MARKER_OFFSET) + MARKER + "\n" + "B".repeat(256 * 1024);
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
        persisted: navigator.storage.persisted ? await navigator.storage.persisted() : null
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
    expect(first.rangeContainsMarker).toBe(true);
    expect(first.shardContainsMarker).toBe(true);
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
