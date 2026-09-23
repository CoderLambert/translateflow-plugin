import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadTasksModule() {
  const sent = [];
  const context = vm.createContext({
    console,
    location: { href: "https://example.com/article" },
    crypto: { randomUUID: () => "generated-task-id" },
    setTimeout,
    clearTimeout,
    __TRANSLATE_FLOW_CONTENT__: {
      modules: {
        runtime: {
          messages: {
            background: {
              CANCEL_TRANSLATION: "CANCEL_TRANSLATION"
            }
          },
          async sendRuntimeMessage(message) {
            sent.push(message);
            return { ok: true, cancelled: true };
          }
        }
      }
    }
  });

  const code = readFileSync(new URL("../src/content/tasks.js", import.meta.url), "utf8");
  vm.runInContext(code, context);
  return {
    tasks: context.__TRANSLATE_FLOW_CONTENT__.modules.tasks,
    sent
  };
}

test("content task exposes deterministic lifecycle and progress", () => {
  const { tasks } = loadTasksModule();
  const task = tasks.createTask({
    id: "page-1",
    surface: "page",
    total: 4
  });

  tasks.transition(task, "cache_lookup");
  tasks.updateProgress(task, { done: 2, cacheHits: 2 });
  tasks.transition(task, "translating");
  tasks.transition(task, "storing");
  tasks.completeTask(task, { done: 4, apiTranslated: 2 });

  assert.deepEqual(
    JSON.parse(JSON.stringify(tasks.getTaskStatus(task))),
    {
      id: "page-1",
      surface: "page",
      state: "completed",
      pageUrl: "https://example.com/article",
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      done: 4,
      total: 4,
      cacheHits: 2,
      apiTranslated: 2,
      error: "",
      errorCode: ""
    }
  );
});

test("content task cancellation is immediate and forwards background cancellation", async () => {
  const { tasks, sent } = loadTasksModule();
  const task = tasks.createTask({ id: "cancel-1", surface: "selection", total: 1 });
  tasks.transition(task, "translating");

  const result = await tasks.cancelTask(task);

  assert.equal(result.cancelled, true);
  assert.equal(tasks.getTaskStatus(task).state, "cancelled");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "CANCEL_TRANSLATION");
  assert.equal(sent[0].requestId, "cancel-1");
  assert.throws(() => tasks.assertActive(task), (error) => error?.code === "CANCELLED");
});


test("task subscribers receive the same page lifecycle used by external controls", () => {
  const { tasks } = loadTasksModule();
  const events = [];
  const unsubscribe = tasks.subscribe((task, event) => {
    events.push({ state: task?.state, surface: task?.surface, event });
  });

  const task = tasks.createTask({ id: "shared-page", surface: "page", total: 2 });
  tasks.transition(task, "cache_lookup");
  tasks.updateProgress(task, { done: 1 });
  tasks.completeTask(task, { done: 2 });

  assert.deepEqual(events.map((item) => item.state), [
    "queued",
    "cache_lookup",
    "cache_lookup",
    "completed"
  ]);
  assert.equal(tasks.getLatestTask("page").id, "shared-page");
  assert.equal(tasks.getLatestTask("page").state, "completed");

  unsubscribe();
  tasks.transition(task, "completed", { done: 2 });
  assert.equal(events.length, 4);
});
