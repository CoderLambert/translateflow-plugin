import { test, expect } from "./support/extension-fixture.mjs";
import { validateSourceSnapshot } from "../src/shared/reading/source.js";
import { createSourceDigest } from "../src/shared/reading/identity.js";

async function prepare(harness, html) {
  await harness.reset();
  const page = await harness.open("/article");
  await page.evaluate((html) => { document.body.innerHTML = html; }, html);
  await harness.inject(page);
  expect(await probe(harness, page, "loaded")).toEqual([true, true, true, true]);
  await probe(harness, page, "trace-install");
  return page;
}

async function probe(harness, page, command, args = {}) {
  const tabId = await harness.tabId(page);
  return harness.driver.evaluate(async ({ tabId, command, args }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, args: [command, args], func: async (command, args) => {
      const modules = globalThis.__TRANSLATE_FLOW_CONTENT__.modules;
      if (command === "loaded") return ["textProjectionPolicy", "textProjectionBuilder", "textProjection", "selectionSourceSnapshot"].map((name) => Boolean(modules[name]));
      if (command === "trace-install") {
        globalThis.__tf231Trace = [];
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        chrome.runtime.sendMessage = (payload, callback) => original(payload, (response) => {
          globalThis.__tf231Trace.push({ type: payload.type, requestId: payload.requestId, text: payload.text, context: payload.context, response });
          callback?.(response);
        });
        return true;
      }
      if (command === "trace") return globalThis.__tf231Trace;
      if (command === "current") {
        const capture = modules.selectionController.getQuerySource();
        return capture ? { snapshot: await capture.ready, revision: capture.sourceRevision, root: capture.root, capability: capture.capability, context: capture.context } : null;
      }
      if (command === "revision") return modules.textProjection.revision();
      if (command === "pending-mutation") {
        const before = modules.textProjection.revision(), p = document.createElement("p"); p.textContent = "AD_INSERTED"; document.querySelector("main").prepend(p);
        const current = modules.selectionController.getQuerySource(), after = modules.textProjection.revision();
        return { before, after, current };
      }
      if (command === "insert-translation") return modules.dom.insertTranslation(document.querySelector(args.selector), "合成译文 SECRET_TRANSLATION");
      if (command === "clear-translations") { modules.dom.clearTranslations(); return true; }
      if (command === "projection") {
        const value = modules.textProjection.project(document.querySelector(args.selector || "body"));
        if (value.status !== "resolved") return { status: value.status, reason: value.reason, stats: value.stats };
        const roundTrips = value.mapping.map((entry, index) => {
          if (!entry) return true;
          const range = modules.textProjection.rangeForPosition(value, { start: index, end: index + 1 });
          const back = modules.textProjection.positionForRange(value, range);
          return back?.start === index && back?.end === index + 1;
        });
        return { status: value.status, text: value.text, stats: value.stats, roundTrips, mapping: value.mapping };
      }
      if (command === "capture") {
        let node = document.querySelector(args.selector).firstChild;
        if (args.shadow) node = document.querySelector(args.selector).shadowRoot.querySelector("p").firstChild;
        const range = document.createRange();
        const start = args.start ?? node.nodeValue.indexOf(args.text);
        range.setStart(node, start); range.setEnd(node, start + args.text.length);
        const capture = modules.selectionSourceSnapshot.capture({ text: args.text, range, selectionGeneration: 1 });
        return { snapshot: await capture.ready, root: capture.root, context: capture.context, capability: capture.capability };
      }
      if (command === "capture-whole") {
        const range = document.createRange(); range.selectNodeContents(document.querySelector(args.selector));
        const capture = modules.selectionSourceSnapshot.capture({ text: range.toString(), range, selectionGeneration: 1 });
        return { snapshot: await capture.ready, root: capture.root, context: capture.context, capability: capture.capability };
      }
      if (command === "capture-closed-shadow") {
        const host = document.createElement("div"); document.querySelector("main").appendChild(host);
        const root = host.attachShadow({ mode: "closed" }), node = document.createTextNode("CLOSED_SECRET session"); root.appendChild(node);
        const range = document.createRange(); range.setStart(node, 14); range.setEnd(node, 21);
        const capture = modules.selectionSourceSnapshot.capture({ text: "session", range, selectionGeneration: 1 });
        return { snapshot: await capture.ready, context: capture.context };
      }
      if (command === "capture-slice-budget") {
        const node = document.querySelector(args.selector).firstChild, range = document.createRange();
        range.setStart(node, args.start ?? 7); range.setEnd(node, (args.start ?? 7) + 7);
        let elapsedMs = 0, wholeReads = 0, boundedReads = 0, capture, canonical;
        const phases = [], style = globalThis.getComputedStyle;
        const styleDescriptor = Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle");
        const nowDescriptor = Object.getOwnPropertyDescriptor(performance, "now");
        const valueDescriptor = Object.getOwnPropertyDescriptor(node, "nodeValue");
        const substringDescriptor = Object.getOwnPropertyDescriptor(node, "substringData");
        const originalProject = modules.textProjection.project, originalPolicy = modules.textProjectionPolicy.rangePolicy;
        const nativeValue = Object.getOwnPropertyDescriptor(Node.prototype, "nodeValue").get;
        const nativeSubstring = CharacterData.prototype.substringData;
        const restore = (object, name, descriptor) => descriptor ? Object.defineProperty(object, name, descriptor) : delete object[name];
        try {
          Object.defineProperty(performance, "now", { configurable: true, value: () => elapsedMs });
          Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: (element) => { const result = style(element); elapsedMs += .25; return result; } });
          modules.textProjectionPolicy.rangePolicy = (...values) => { const started = elapsedMs, value = originalPolicy(...values); phases.push({ phase: "range", ms: elapsedMs - started }); return value; };
          modules.textProjection.project = (root, ...values) => { const started = elapsedMs, value = originalProject(root, ...values); phases.push({ phase: root === document.body ? "full" : "local", ms: elapsedMs - started, status: value.status, reason: value.reason, stats: value.stats }); return value; };
          if (args.substringMs) {
            Object.defineProperty(node, "nodeValue", { configurable: true, get() { wholeReads++; return nativeValue.call(this); } });
            Object.defineProperty(node, "substringData", { configurable: true, value(from, count) { boundedReads++; const result = nativeSubstring.call(this, from, count); elapsedMs += args.substringMs; return result; } });
          }
          if (args.canonical) canonical = modules.selectionSourceSnapshot.canonicalize(range, "session");
          else capture = modules.selectionSourceSnapshot.capture({ text: "session", range, selectionGeneration: 1 });
        } finally {
          modules.textProjection.project = originalProject; modules.textProjectionPolicy.rangePolicy = originalPolicy;
          restore(globalThis, "getComputedStyle", styleDescriptor); restore(performance, "now", nowDescriptor);
          restore(node, "nodeValue", valueDescriptor); restore(node, "substringData", substringDescriptor);
        }
        return { elapsedMs, limitMs: modules.textProjectionPolicy.limits.sliceMs, phases, wholeReads, boundedReads,
          canonical: canonical ? { unchanged: canonical.range === range, text: canonical.text } : null,
          snapshot: capture ? await capture.ready : null, context: capture?.context, root: capture?.root };
      }
      if (command === "capture-bounded-text") {
        const node = document.querySelector(args.selector).firstChild;
        let wholeReads = 0, boundedReads = 0, largestRead = 0;
        const nativeValue = Object.getOwnPropertyDescriptor(Node.prototype, "nodeValue").get;
        const nativeSubstring = CharacterData.prototype.substringData;
        Object.defineProperty(node, "nodeValue", { configurable: true, get() { wholeReads++; return nativeValue.call(this); } });
        node.substringData = function(from, length) { boundedReads++; largestRead = Math.max(largestRead, length); return nativeSubstring.call(this, from, length); };
        const range = document.createRange(); range.setStart(node, args.start); range.setEnd(node, args.start + 7);
        const capture = modules.selectionSourceSnapshot.capture({ text: "session", range, selectionGeneration: 1 });
        return { snapshot: await capture.ready, context: capture.context, wholeReads, boundedReads, largestRead };
      }
      throw new Error(`Unknown source-position test command: ${command}`);
    } });
    return result.result;
  }, { tabId, command, args });
}

async function select(page, selector, text, occurrence = 0) {
  await page.evaluate(({ selector, text, occurrence }) => {
    const element = document.querySelector(selector), range = document.createRange();
    if (text === null) range.selectNodeContents(element);
    else {
      const node = element.firstChild;
      let start = -1;
      for (let index = 0; index <= occurrence; index++) start = node.nodeValue.indexOf(text, start + 1);
      if (start < 0) throw new Error("synthetic selection text not found");
      range.setStart(node, start); range.setEnd(node, start + text.length);
    }
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const rect = range.getBoundingClientRect(); window.scrollBy(0, rect.top - window.innerHeight / 2);
    document.dispatchEvent(new Event("selectionchange"));
  }, { selector, text, occurrence });
  await page.waitForTimeout(140);
  await expect(page.locator(".tf-selection-chip")).toBeVisible();
}

async function query(harness, page, selector, text, occurrence = 0) {
  await select(page, selector, text, occurrence);
  await page.locator(".tf-selection-chip").click();
  await expect(page.locator(".tf-selection-panel")).toBeVisible();
  await expect.poll(async () => Boolean(await probe(harness, page, "current"))).toBe(true);
  const capture = await probe(harness, page, "current");
  expect(validateSourceSnapshot(capture.snapshot)).toEqual(capture.snapshot);
  expect(capture.snapshot.sourceDigest).toBe(await createSourceDigest(capture.snapshot));
  return capture;
}

test("production modules preserve inline/Unicode offsets and map every real UTF16 unit both ways", async ({ harness }) => {
  const page = await prepare(harness, '<main><p id="inline"><span>per</span><strong>sistent</strong></p><p id="unicode">link <a>text</a>  \t\n 中文\u00a0😀 e\u0301<br>next</p><div style="visibility:hidden"><span style="visibility:visible">SECRET_HIDDEN</span></div><p hidden>SECRET_HIDDEN_TWO</p><script>SECRET_SCRIPT</script></main>');
  const projection = await probe(harness, page, "projection");
  expect(projection.status).toBe("resolved");
  expect(projection.text).toBe("persistent\nlink text 中文\u00a0😀 e\u0301\nnext");
  expect(projection.roundTrips.every(Boolean)).toBe(true);
  expect(projection.mapping[projection.text.indexOf("\n")]).toBeNull();
  const capture = await query(harness, page, "#inline", null);
  expect(capture.snapshot.selectedText).toBe("persistent");
  expect(capture.snapshot.anchor).toMatchObject({ status: "resolved", position: { start: 0, end: 10 }, quote: { exact: "persistent" } });
  expect(harness.server.calls).toHaveLength(0);
});

test("A/B, repeated long-paragraph words and identical paragraphs get distinct locations without repeated-event queries", async ({ harness }) => {
  const long = `FIRST_MARK ${"word ".repeat(220)} session ${"middle ".repeat(250)} SECOND_MARK session LAST_MARK`;
  const page = await prepare(harness, `<main><p id="a">ALPHA session opens the first context.</p><p id="b">BETA session opens a different context.</p><p id="copy-a">Identical session paragraph.</p><p id="copy-b">Identical session paragraph.</p><p id="long">${long}</p></main>`);
  const a = await query(harness, page, "#a", "session");
  expect(a.context.text).toContain("ALPHA");
  await page.evaluate(() => { document.dispatchEvent(new Event("selectionchange")); window.dispatchEvent(new Event("scroll")); });
  await page.waitForTimeout(180);
  expect((await probe(harness, page, "current")).snapshot.sourceSnapshotId).toBe(a.snapshot.sourceSnapshotId);
  await page.evaluate(() => { const range = document.createRange(); const node = document.querySelector("#a").firstChild; range.setStart(node, 6); range.setEnd(node, 13); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange")); });
  await page.waitForTimeout(180);
  expect((await probe(harness, page, "current")).snapshot.sourceSnapshotId).toBe(a.snapshot.sourceSnapshotId);
  const b = await query(harness, page, "#b", "session");
  expect(b.context.text).toContain("BETA"); expect(b.snapshot.selectionGeneration).toBeGreaterThan(a.snapshot.selectionGeneration);
  expect(b.snapshot.anchor.position).not.toEqual(a.snapshot.anchor.position);
  const copyA = await query(harness, page, "#copy-a", "session"), copyB = await query(harness, page, "#copy-b", "session");
  expect(copyA.snapshot.sourceDigest).toBe(copyB.snapshot.sourceDigest);
  expect(copyA.snapshot.anchor.position).not.toEqual(copyB.snapshot.anchor.position);
  expect(copyB.snapshot.selectionGeneration).toBeGreaterThan(copyA.snapshot.selectionGeneration);
  const first = await query(harness, page, "#long", "session", 0), second = await query(harness, page, "#long", "session", 1);
  expect(first.context.text).not.toContain("SECOND_MARK"); expect(second.context.text).toContain("SECOND_MARK");
  expect(first.snapshot.anchor.position).not.toEqual(second.snapshot.anchor.position);
  expect(second.snapshot.selectionGeneration).toBeGreaterThan(first.snapshot.selectionGeneration);
  expect(harness.server.calls).toHaveLength(0);
});

test("real bilingual insertion and clearing keep source projection, revision and captured quote unchanged", async ({ harness }) => {
  const page = await prepare(harness, '<main><p id="source">A persistent connection keeps the synthetic paragraph readable.</p></main>');
  const before = await probe(harness, page, "projection"), capture = await query(harness, page, "#source", "persistent");
  const revision = await probe(harness, page, "revision");
  expect(await probe(harness, page, "insert-translation", { selector: "#source" })).toBe(true);
  await expect(page.locator(".abt-translation")).toContainText("SECRET_TRANSLATION");
  expect((await probe(harness, page, "projection")).text).toBe(before.text);
  expect(await probe(harness, page, "revision")).toBe(revision);
  expect((await probe(harness, page, "current")).snapshot).toEqual(capture.snapshot);
  await probe(harness, page, "clear-translations");
  expect((await probe(harness, page, "projection")).text).toBe(before.text);
  expect(await probe(harness, page, "revision")).toBe(revision);
  expect((await probe(harness, page, "current")).snapshot.anchor.quote).toEqual(capture.snapshot.anchor.quote);
});

test("same-text Range changes, pending insertion, removal and navigation cancel real delayed AI and suppress late writeback", async ({ harness }) => {
  const page = await prepare(harness, '<main><p id="a">ALPHA persistent connection remains.</p><p id="b">BETA persistent connection differs.</p></main>');
  harness.server.setDelay(700);
  for (const mode of ["range", "insert", "remove", "navigate"]) {
    if (mode === "remove") await page.evaluate(() => { const p = document.createElement("p"); p.id = "a"; p.textContent = "ALPHA persistent connection remains."; document.querySelector("main").prepend(p); });
    await query(harness, page, "#a", "persistent");
    await expect(page.getByRole("button", { name: "使用 AI 结合上下文详解" })).toBeVisible();
    const callsBefore = harness.server.calls.length;
    await page.getByRole("button", { name: "使用 AI 结合上下文详解" }).click();
    await expect.poll(() => harness.server.calls.length).toBe(callsBefore + 1);
    const frozen = await probe(harness, page, "current"), revision = await probe(harness, page, "revision");
    if (mode === "range") await select(page, "#b", "persistent");
    else if (mode === "insert") { const pending = await probe(harness, page, "pending-mutation"); expect(pending.after).toBeGreaterThan(pending.before); expect(pending.current).toBeNull(); }
    else await page.evaluate((mode) => {
      if (mode === "remove") document.querySelector("#a").remove();
      if (mode === "navigate") history.pushState({}, "", "/different-source-page");
    }, mode);
    await expect.poll(async () => (await probe(harness, page, "trace")).filter((event) => event.type === "CANCEL_TRANSLATION" && event.response?.cancelled).length).toBeGreaterThan(0);
    if (mode !== "range") await expect.poll(async () => probe(harness, page, "revision")).toBeGreaterThan(revision);
    expect(frozen.snapshot.contextText).toContain("ALPHA");
    await page.waitForTimeout(850);
    await expect(page.locator(".tf-selection-ai-detail[data-state='success']")).toHaveCount(0);
    expect(await probe(harness, page, "current")).toBeNull();
    if (mode === "remove") await page.evaluate(() => { const p = document.createElement("p"); p.id = "a"; p.textContent = "ALPHA persistent connection remains."; document.querySelector("main").prepend(p); });
  }
  const trace = await probe(harness, page, "trace");
  expect(trace.filter((event) => event.type === "CANCEL_TRANSLATION" && event.response?.cancelled)).toHaveLength(4);
  expect(harness.server.calls).toHaveLength(4);
  console.log("[READING_POSITION_AI]", JSON.stringify({ explicitLocalStubCalls: 4, actualCancellationReceipts: 4, paidProviderCalls: 0 }));
});

test("editable, shadow, generated text and over-budget pages fail closed while ordinary queries still work", async ({ harness }) => {
  const long = `${"x".repeat(24000)} LATE_CONTEXT session END_CONTEXT`;
  const page = await prepare(harness, `<main><p id="normal">PUBLIC session context</p><p id="editable" contenteditable="true">SECRET_AROUND session</p><p id="generated" class="abt-translation">GENERATED session</p><input id="input" value="session"><div id="shadow"></div><p id="long">${long}</p></main>`);
  await page.evaluate(() => { const root = document.querySelector("#shadow").attachShadow({ mode: "open" }); root.innerHTML = '<p>SHADOW_SECRET session</p>'; });
  for (const [selector, shadow] of [["#editable", false], ["#generated", false], ["#shadow", true]]) {
    const capture = await probe(harness, page, "capture", { selector, shadow, text: "session" });
    expect(capture.snapshot.anchor.status).toBe("unsupported"); expect(capture.context.text).toBe("");
    expect(validateSourceSnapshot(capture.snapshot)).toEqual(capture.snapshot);
  }
  const closed = await probe(harness, page, "capture-closed-shadow");
  expect(closed.context.sensitive).toBe(true); expect(closed.context.text).toBe(""); expect(closed.snapshot.anchor.status).toBe("unsupported");
  await page.locator("#input").focus(); await page.locator("#input").evaluate((input) => input.setSelectionRange(0, 7));
  const input = await probe(harness, page, "capture", { selector: "#normal", text: "session" });
  expect(input.context.sensitive).toBe(true); expect(input.context.text).toBe("");
  await page.locator("#input").evaluate((input) => input.blur());
  const editable = await query(harness, page, "#editable", "session");
  expect(editable.context.sensitive).toBe(true); expect(editable.context.text).toBe("");
  await expect(page.locator(".tf-selection-result")).toContainText("会话");
  const projection = await probe(harness, page, "projection");
  expect(projection.status).toBe("unsupported"); expect(projection.stats.nodes).toBeLessThanOrEqual(500); expect(projection.stats.chars).toBeLessThanOrEqual(16000);
  const captured = await query(harness, page, "#long", "session");
  expect(captured.capability).toBe("unsupported"); expect(captured.context.text).toContain("LATE_CONTEXT session END_CONTEXT");
  expect(captured.root).toBe("document");
  expect(captured.context.text.length).toBeLessThanOrEqual(900);
  await expect(page.locator(".tf-selection-result")).toContainText("会话");
  expect(harness.server.calls).toHaveLength(0);
  console.log("[READING_POSITION_BUDGET]", JSON.stringify({ ...projection.stats, capability: captured.capability, contextChars: captured.context.text.length }));
});

test("neighboring open/closed sensitive slots never become public selection context, and giant-node reads stay bounded", async ({ harness }) => {
  const page = await prepare(harness, '<main><p id="normal">PUBLIC session</p><div data-tf-sensitive><p id="hidden" hidden>PRIVATE session</p></div></main>');
  const hidden = await probe(harness, page, "capture", { selector: "#hidden", text: "session" });
  expect(hidden.context.sensitive).toBe(true); expect(hidden.context.text).toBe("");
  for (const [tagName, mode] of [["x-private", "open"], ["x-private", "closed"], ["div", "open"], ["div", "closed"], ["span", "closed"]]) {
    await page.evaluate(({ tagName, mode }) => {
      const p = document.querySelector("#normal"); p.textContent = "PUBLIC session ";
      const host = document.createElement(tagName), light = document.createElement("span"); light.textContent = "SECRET_CONTEXT"; host.append(light);
      const root = host.attachShadow({ mode }), sensitive = document.createElement("span"), slot = document.createElement("slot");
      sensitive.setAttribute("data-tf-sensitive", ""); sensitive.append(slot); root.append(sensitive); p.append(host);
    }, { tagName, mode });
    const capture = await probe(harness, page, "capture", { selector: "#normal", text: "session" });
    expect(capture.context.sensitive).toBe(true); expect(capture.context.text).toBe("");
    expect(capture.root).toBe("unsupported");
    expect(capture.snapshot.anchor.status).toBe("unsupported"); expect(capture.snapshot.anchor.position).toBeNull();
    expect(capture.snapshot.anchor.quote).toEqual({ exact: "session", prefix: "", suffix: "" });
    expect(capture.snapshot.anchor.blockDigest).toBeNull();
    const ordinary = await query(harness, page, "#normal", "session");
    expect(ordinary.context.text).toBe(""); await expect(page.locator(".tf-selection-result")).toContainText("会话");
  }
  await page.evaluate(() => { const p = document.createElement("p"); p.id = "giant"; p.textContent = `${"x".repeat(2_000_000)} session END_CONTEXT`; document.querySelector("main").append(p); });
  const giant = await probe(harness, page, "capture-bounded-text", { selector: "#giant", start: 2_000_001 });
  expect(giant.wholeReads).toBe(0); expect(giant.boundedReads).toBe(1); expect(giant.largestRead).toBeLessThanOrEqual(1207);
  expect(giant.snapshot.anchor.status).toBe("unsupported"); expect(giant.context.text).toContain("session END_CONTEXT");
  expect(giant.context.text.length).toBeLessThanOrEqual(900); expect(harness.server.calls).toHaveLength(0);
  console.log("[READING_POSITION_PRIVACY]", JSON.stringify({ sensitiveAdjacentModes: 5, hiddenAncestorSensitive: true, wholeReads: giant.wholeReads, boundedReads: giant.boundedReads, largestRead: giant.largestRead, providerCalls: 0 }));
});

test("whole Ranges crossing interior private nodes or unknown hosts reject evidence without blocking ordinary queries", async ({ harness }) => {
  const page = await prepare(harness, '<main><p id="whole">PUBLIC <span>SECRET</span> tail</p></main>');
  for (const middle of ['<span contenteditable="true">SECRET</span>', '<span data-tf-sensitive>SECRET</span>', '<x-private>SECRET</x-private>']) {
    await page.evaluate((middle) => { document.querySelector("#whole").innerHTML = `PUBLIC ${middle} tail`; }, middle);
    const capture = await probe(harness, page, "capture-whole", { selector: "#whole" });
    expect(capture.snapshot.selectedText).toBe("PUBLIC SECRET tail"); expect(capture.root).toBe("unsupported");
    expect(capture.context.sensitive).toBe(true); expect(capture.context.text).toBe("");
    expect(capture.snapshot.contextMode).toBe("selection-only"); expect(capture.snapshot.anchor.status).toBe("unsupported");
    expect(capture.snapshot.anchor.position).toBeNull(); expect(capture.snapshot.anchor.blockDigest).toBeNull();
    expect(validateSourceSnapshot(capture.snapshot)).toEqual(capture.snapshot);
    const ordinary = await query(harness, page, "#whole", null);
    expect(ordinary.snapshot.selectedText).toBe("PUBLIC SECRET tail"); expect(ordinary.context.sensitive).toBe(true);
    await expect(page.locator(".tf-selection-result")).toContainText("[DEFAULT|PLAIN] PUBLIC SECRET tail");
  }
  await page.evaluate(() => { document.querySelector("#whole").innerHTML = `PUBLIC ${'<span>x</span>'.repeat(600)}tail`; });
  const large = await probe(harness, page, "capture-whole", { selector: "#whole" });
  expect(large.root).toBe("unsupported"); expect(large.context.sensitive).toBe(true); expect(large.context.text).toBe("");
  expect(large.snapshot.anchor.status).toBe("unsupported"); expect(harness.server.calls).toHaveLength(1);
  expect(harness.server.calls[0].segments.map((item) => item.text)).toEqual(["PUBLIC SECRET tail"]);
  console.log("[READING_RANGE_PRIVACY]", JSON.stringify({ privateInteriorModes: 3, nodeBudgetRejected: true, explicitLocalTranslationCalls: 1, cacheReused: true, paidProviderCalls: 0 }));
});


test("real DOM capture, canonicalization and giant fallback share their first synchronous deadline", async ({ harness }) => {
  const leading = '<p>safe</p>'.repeat(100);
  const page = await prepare(harness, `<main>${leading}<p id="selected">PUBLIC session tail</p></main>`);
  const capture = await probe(harness, page, "capture-slice-budget", { selector: "#selected" });
  expect(capture.limitMs).toBe(8); expect(capture.elapsedMs).toBe(8);
  expect(capture.phases.map((value) => value.phase)).toEqual(["range", "local", "full"]);
  expect(capture.phases[2].reason).toBe("time-budget");
  expect(capture.context).toMatchObject({ text: "PUBLIC session tail", sensitive: false }); expect(capture.root).toBe("document");
  expect(capture.snapshot).toMatchObject({ selectedText: "session", anchor: { status: "unsupported", position: null } });
  expect(validateSourceSnapshot(capture.snapshot)).toEqual(capture.snapshot);

  await page.evaluate(() => { document.body.innerHTML = `<main><p>${'<span>safe</span>'.repeat(100)}<span id="selected">PUBLIC session tail</span></p></main>`; });
  const canonical = await probe(harness, page, "capture-slice-budget", { selector: "#selected", canonical: true });
  expect(canonical.limitMs).toBe(8); expect(canonical.elapsedMs).toBe(8);
  expect(canonical.canonical).toEqual({ unchanged: true, text: "session" });
  expect(canonical.phases.map((value) => value.phase)).toEqual(["range", "local"]);
  expect(canonical.phases[1].reason).toBe("time-budget");

  await page.evaluate(() => { document.body.innerHTML = '<main><p id="giant"></p></main>'; document.querySelector("#giant").textContent = `${"x".repeat(2_000_000)} session END_CONTEXT`; });
  const giant = await probe(harness, page, "capture-slice-budget", { selector: "#giant", start: 2_000_001, substringMs: 4 });
  expect(giant.limitMs).toBe(8); expect(giant.elapsedMs).toBe(8);
  expect(giant.wholeReads).toBe(0); expect(giant.boundedReads).toBe(1);
  expect(giant.context).toMatchObject({ text: "", sensitive: false }); expect(giant.root).toBe("document");
  expect(giant.snapshot).toMatchObject({ selectedText: "session", contextMode: "selection-only", anchor: { status: "unsupported", position: null } });
  expect(validateSourceSnapshot(giant.snapshot)).toEqual(giant.snapshot); expect(harness.server.calls).toHaveLength(0);
  console.log("[READING_SHARED_SLICE]", JSON.stringify({ captureMs: capture.elapsedMs, canonicalMs: canonical.elapsedMs, giantMs: giant.elapsedMs, limitMs: giant.limitMs,
    capturePhases: capture.phases, canonicalPhases: canonical.phases, giantWholeReads: giant.wholeReads, giantBoundedReads: giant.boundedReads, paidProviderCalls: 0 }));
});
