(() => {
  const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
  if (!app?.modules.runtime || app.modules.tasks) return;

  const { messages, sendRuntimeMessage } = app.modules.runtime;
  const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
  const tasks = new Map();

  function createTask({
    id = "",
    surface = "page",
    pageUrl = location.href,
    total = 0
  } = {}) {
    pruneTerminalTasks();
    const taskId = String(id || crypto.randomUUID());
    const now = Date.now();
    const task = {
      id: taskId,
      surface,
      state: "queued",
      pageUrl,
      createdAt: now,
      updatedAt: now,
      done: 0,
      total: Math.max(0, Number(total) || 0),
      cacheHits: 0,
      apiTranslated: 0,
      error: "",
      errorCode: ""
    };
    tasks.set(taskId, task);
    return task;
  }

  function transition(taskOrId, state, patch = {}) {
    const task = resolveTask(taskOrId);
    if (!task) return null;
    if (task.state === "cancelled" && state !== "cancelled") {
      throw createCancelledError();
    }

    Object.assign(task, patch, {
      state,
      updatedAt: Date.now()
    });
    return task;
  }

  function updateProgress(taskOrId, patch = {}) {
    const task = resolveTask(taskOrId);
    if (!task) return null;
    if (task.state === "cancelled") throw createCancelledError();
    Object.assign(task, patch, { updatedAt: Date.now() });
    return task;
  }

  function completeTask(taskOrId, patch = {}) {
    return transition(taskOrId, "completed", patch);
  }

  function failTask(taskOrId, error) {
    const task = resolveTask(taskOrId);
    if (!task) return null;
    if (isCancelledError(error) || task.state === "cancelled") {
      return transition(task, "cancelled", {
        error: "翻译已取消。",
        errorCode: "CANCELLED"
      });
    }
    return transition(task, "failed", {
      error: error?.message || String(error || "翻译失败"),
      errorCode: error?.code || ""
    });
  }

  async function cancelTask(taskOrId) {
    const task = resolveTask(taskOrId);
    if (!task || TERMINAL_STATES.has(task.state)) {
      return { cancelled: false, task: serializeTask(task) };
    }

    transition(task, "cancelled", {
      error: "翻译已取消。",
      errorCode: "CANCELLED"
    });

    try {
      await sendRuntimeMessage({
        type: messages.background.CANCEL_TRANSLATION,
        requestId: task.id
      });
    } catch {
      // Local cancellation is authoritative for UI/cache writes even if the
      // background request has already settled or the worker restarted.
    }

    return { cancelled: true, task: serializeTask(task) };
  }

  function assertActive(taskOrId) {
    const task = resolveTask(taskOrId);
    if (!task || task.state === "cancelled") throw createCancelledError();
    return task;
  }

  function getTaskStatus(taskOrId) {
    pruneTerminalTasks();
    return serializeTask(resolveTask(taskOrId));
  }

  function releaseTask(taskOrId) {
    const task = resolveTask(taskOrId);
    if (!task) return false;
    return tasks.delete(task.id);
  }

  function isTerminal(taskOrId) {
    const task = resolveTask(taskOrId);
    return Boolean(task && TERMINAL_STATES.has(task.state));
  }

  function isCancelledError(error) {
    return error?.code === "CANCELLED"
      || error?.name === "AbortError"
      || error?.name === "TaskCancelledError";
  }

  function responseError(response, fallback) {
    const error = new Error(response?.error || fallback || "操作失败");
    error.code = response?.errorCode || "";
    return error;
  }

  function resolveTask(taskOrId) {
    if (!taskOrId) return null;
    if (typeof taskOrId === "object") return taskOrId;
    return tasks.get(String(taskOrId)) || null;
  }

  function serializeTask(task) {
    if (!task) return null;
    return {
      id: task.id,
      surface: task.surface,
      state: task.state,
      pageUrl: task.pageUrl,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      done: task.done,
      total: task.total,
      cacheHits: task.cacheHits,
      apiTranslated: task.apiTranslated,
      error: task.error,
      errorCode: task.errorCode
    };
  }

  function pruneTerminalTasks(now = Date.now()) {
    const cutoff = now - (5 * 60 * 1000);
    for (const [id, task] of tasks) {
      if (TERMINAL_STATES.has(task.state) && task.updatedAt < cutoff) {
        tasks.delete(id);
      }
    }
  }

  function createCancelledError() {
    const error = new Error("翻译已取消。");
    error.name = "TaskCancelledError";
    error.code = "CANCELLED";
    return error;
  }

  app.modules.tasks = {
    createTask,
    transition,
    updateProgress,
    completeTask,
    failTask,
    cancelTask,
    assertActive,
    getTaskStatus,
    releaseTask,
    isTerminal,
    isCancelledError,
    responseError
  };
})();
