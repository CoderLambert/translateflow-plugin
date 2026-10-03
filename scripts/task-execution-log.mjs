import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export const STAGES = new Set(["baseline", "experiment", "implementation", "validation", "review", "fix", "ci", "sync", "merge", "checkpoint"]);
export const RESULTS = new Set(["pass", "fail", "paused", "blocked"]);
export const HOOK_EVENTS = new Set(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "Stop", "Interrupt"]);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u;
const hash = (value) => typeof value === "string" && value.length ? createHash("sha256").update(value).digest("hex").slice(0, 24) : null;
const name = (value) => typeof value === "string" && ID.test(value) ? value : null;
const UNASSIGNED = "unassigned-hooks";

export function commandKind(command) {
  if (typeof command !== "string") return "other";
  if (/\bnpm\s+run\s+validate\b/u.test(command)) return "validate";
  if (/\b(?:playwright\s+test|npm\s+run\s+test:e2e(?:\s|:|$))/u.test(command)) return "e2e";
  if (/\b(?:node\s+--test|npm\s+test)\b/u.test(command)) return "node-tests";
  if (/\bnpm\s+run\s+test:unit\b/u.test(command)) return "unit";
  if (/\bnpm\s+run\s+typecheck\b/u.test(command)) return "typecheck";
  if (/\bnpm\s+run\s+check\b/u.test(command)) return "check";
  if (/\b(?:npm\s+run\s+build|wxt\s+build)/u.test(command)) return "build";
  if (/\bgh\s+(?:pr\s+checks|run\s+view)\b/u.test(command)) return "ci-check";
  if (/\b(?:gh\s+pr\s+merge|git\s+merge)\b/u.test(command)) return "merge";
  if (/\bgit\s+push\b/u.test(command)) return "push";
  if (/\bgit\s+commit\b/u.test(command)) return "commit";
  return "other";
}

export function gitSnapshot(root) {
  try {
    const opts = { cwd: root, encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] };
    const head = execFileSync("git", ["rev-parse", "--verify", "HEAD"], opts).trim();
    const dirty = Boolean(execFileSync("git", ["status", "--porcelain"], opts).trim());
    return { head: /^[a-f0-9]{40,64}$/u.test(head) ? head : null, dirty };
  } catch { return { head: null, dirty: null }; }
}

function safeRead(file) {
  if (lstatSync(file).isSymbolicLink()) throw new Error("Unsafe log file");
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error("Invalid log file");
    return readFileSync(fd, "utf8");
  } finally { closeSync(fd); }
}

export function createRecorder(root) {
  const directory = join(root, "docs", "task-execution", "local");
  const contextFile = join(directory, "context.json");
  function prepare() {
    let path = root;
    for (const part of ["docs", "task-execution", "local"]) {
      path = join(path, part);
      if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Unsafe log directory");
    }
  }
  function context() {
    prepare();
    if (!existsSync(contextFile)) return null;
    const value = JSON.parse(safeRead(contextFile));
    if (!name(value.task) || !name(value.attempt) || !STAGES.has(value.stage)) throw new Error("Invalid context");
    return value;
  }
  function saveJson(file, value) {
    prepare();
    const temp = join(directory, `.context-${randomUUID()}.tmp`);
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    renameSync(temp, file);
  }
  function emit(ctx, type, details = {}) {
    prepare();
    const event = {
      schema: 1, id: randomUUID(), at: new Date().toISOString(),
      task: ctx.task, attempt: ctx.attempt, stage: ctx.stage, type,
      declaredRole: ctx.role, head: ctx.head, dirty: ctx.dirty, ...details
    };
    const file = join(directory, `${ctx.task}.jsonl`);
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error("Unsafe log file");
    const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      if (!fstatSync(fd).isFile()) throw new Error("Invalid log file");
      // One bounded append per event; concurrent hooks don't rewrite shared state.
      writeFileSync(fd, `${JSON.stringify(event)}\n`);
    } finally { closeSync(fd); }
    return event;
  }
  function start(task, role = "main") {
    if (!name(task) || task === UNASSIGNED || !new Set(["main", "dev_explorer", "dev_implementer", "dev_specialist", "dev_verifier", "dev_reviewer"]).has(role)) throw new Error("Invalid task or role");
    if (context()?.active) throw new Error("Finish the active task before starting another");
    const ctx = { task, attempt: randomUUID(), stage: "baseline", role, active: true, ...gitSnapshot(root) };
    emit(ctx, "task_start");
    saveJson(contextFile, ctx);
    return ctx;
  }
  function active() {
    const ctx = context();
    if (!ctx?.active) throw new Error("No active task: use start first");
    return ctx;
  }
  function stage(next) {
    if (!STAGES.has(next)) throw new Error("Invalid stage");
    const ctx = active();
    if (ctx.stage === next) return;
    const updated = { ...ctx, stage: next, ...gitSnapshot(root) };
    emit(updated, "stage_change", { previousStage: ctx.stage });
    saveJson(contextFile, updated);
  }
  function finish(result) {
    if (!RESULTS.has(result)) throw new Error("Invalid result");
    const ctx = { ...active(), ...gitSnapshot(root) };
    emit(ctx, "task_end", { result });
    saveJson(contextFile, { ...ctx, active: false });
  }
  function hook(input) {
    if (!input || !HOOK_EVENTS.has(input.hook_event_name)) throw new Error("Invalid hook event");
    const current = context();
    const unassigned = { task: UNASSIGNED, attempt: UNASSIGNED, stage: "baseline", role: null, head: null, dirty: null };
    let ctx = current?.active ? current : unassigned;
    const call = hash(input.tool_use_id);
    const binding = call ? join(directory, `pending-${hash(input.session_id) ?? "no-session"}-${call}.json`) : null;
    const isPre = input.hook_event_name === "PreToolUse";
    const isPost = input.hook_event_name === "PostToolUse";
    let hasBinding = false;
    if ((isPre || isPost) && binding && existsSync(binding)) {
      ctx = JSON.parse(safeRead(binding));
      if (!name(ctx.task) || !name(ctx.attempt) || !STAGES.has(ctx.stage)) throw new Error("Invalid call binding");
      hasBinding = true;
    } else if (isPost) {
      ctx = unassigned; // Never borrow a new task's context for an orphan result.
    }
    if (isPre && binding && !hasBinding) saveJson(binding, ctx);
    const tool = name(input.tool_name);
    const response = input.tool_response;
    // Read only numeric status in known object fields. Never inspect output text.
    const exitCode = Number.isInteger(response?.exit_code) ? response.exit_code : null;
    const isError = typeof response?.isError === "boolean" ? response.isError : null;
    emit(ctx, "hook", {
      event: input.hook_event_name, session: hash(input.session_id), turn: hash(input.turn_id),
      toolCall: hash(input.tool_use_id), agent: hash(input.agent_id),
      tool, kind: commandKind(input.tool_input?.command ?? input.tool_input?.cmd),
      observedModel: name(input.model), observedAgentType: name(input.agent_type),
      exitCode, isError
    });
    if (isPost && hasBinding) unlinkSync(binding);
  }
  function read(task) {
    if (!name(task)) throw new Error("Invalid task");
    prepare();
    const file = join(directory, `${task}.jsonl`);
    if (!existsSync(file)) return { events: [], invalidLines: 0 };
    const events = [];
    let invalidLines = 0;
    const seen = new Set();
    for (const line of safeRead(file).split("\n")) {
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event.schema !== 1 || event.task !== task || !name(event.id) || !name(event.attempt) || !STAGES.has(event.stage) || !Number.isFinite(Date.parse(event.at))) throw new Error("Invalid event");
        if (!seen.has(event.id)) { seen.add(event.id); events.push(event); }
      } catch { invalidLines++; }
    }
    return { events, invalidLines };
  }
  return { start, stage, finish, active, hook, emit, read };
}
