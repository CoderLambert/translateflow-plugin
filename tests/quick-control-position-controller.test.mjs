import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/content/quick-control.js", import.meta.url), "utf8");
function fixture(send) {
  let handlers;
  const positions = [], notices = [], requests = [];
  const view = Object.fromEntries(["ensure", "setSuppressed", "setTask", "setAuto", "setContext", "destroy"].map(key => [key, () => {}]));
  view.setPosition = value => positions.push(value);
  const background = Object.fromEntries(["PUBLIC_SETTINGS_GET", "QUICK_CONTROL_POSITION_GET", "QUICK_CONTROL_POSITION_SET", "EFFECTIVE_CONTEXT"].map(key => [key, key]));
  const app = { modules: {
    runtime: { messages: { background }, state: {}, getSiteScope: () => "https://example.test",
      sendRuntimeMessage: async message => {
        requests.push(message);
        if (message.type === "PUBLIC_SETTINGS_GET") return { ok: true, settings: {} };
        if (message.type === "EFFECTIVE_CONTEXT") return { ok: true, context: {} };
        return send(message);
      }, showToast: (...args) => notices.push(args) },
    contentI18n: { start: async () => {}, t: key => key },
    quickControlView: { create: value => { handlers = value; return view; } },
    tasks: {}, processor: {}, auto: {}, appearance: {}
  } };
  vm.runInNewContext(source, { __TRANSLATE_FLOW_CONTENT__: app, location: { href: "https://example.test/article" } });
  return { controller: app.modules.quickControl, handlers, positions, notices, requests };
}

test("position is loaded once and repeated show does not reset a user's placement", async () => {
  const f = fixture(async () => ({ ok: true, position: { x: .2, y: .4 } }));
  await f.controller.showForTab(); await f.controller.showForTab();
  assert.equal(f.requests.filter(message => message.type === "QUICK_CONTROL_POSITION_GET").length, 1);
  assert.deepEqual(f.positions, [{ x: .2, y: .4 }]);
});

test("late position reads cannot overwrite a newer completed move", async () => {
  let release, started;
  const reading = new Promise(resolve => { started = resolve; });
  const f = fixture(message => message.type === "QUICK_CONTROL_POSITION_GET" ? new Promise(resolve => { release = resolve; started(); }) : { ok: true });
  const showing = f.controller.showForTab();
  await reading;
  await f.handlers.onPositionChange({ x: .8, y: .3 });
  release({ ok: true, position: { x: 0, y: 0 } });
  await showing;
  assert.equal(f.positions.length, 0);
  const request = f.requests.find(message => message.type === "QUICK_CONTROL_POSITION_SET");
  assert.equal(request.position.x, .8);
  assert.equal(request.position.y, .3);
});

test("save failures are visible and an obsolete failure does not override a successful reset", async () => {
  let release;
  const f = fixture(message => message.position === null ? { ok: true } : new Promise(resolve => { release = resolve; }));
  const first = f.handlers.onPositionChange({ x: .4, y: .4 });
  await f.handlers.onPositionChange(null);
  release({ ok: false }); await first;
  assert.equal(f.notices.length, 0);
  const next = f.handlers.onPositionChange({ x: .4, y: .4 });
  release({ ok: false }); await next;
  assert.equal(f.notices[0][0], "content.quick.positionSaveFailed");
  assert.equal(f.notices[0][1], "error");
});
