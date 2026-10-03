#!/usr/bin/env node
import { readSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";
import { createRecorder, commandKind, gitSnapshot } from "./task-execution-log.mjs";
import { markdown, summarize } from "./task-execution-report.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const recorder = createRecorder(root);
const [action, ...args] = process.argv.slice(2);
const usage = "Usage: task-execution.mjs start <task> [role] | stage <stage> | finish <pass|fail|paused|blocked> | run -- <command> [args...] | report <task> [--json] | hook";

function readHook() {
  const chunks = [];
  const buffer = Buffer.alloc(64 * 1024);
  let total = 0, count;
  while ((count = readSync(0, buffer, 0, buffer.length, null)) > 0) {
    total += count;
    if (total > 16 * 1024 * 1024) throw new Error("Hook input too large");
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function run(argv) {
  if (argv[0] !== "--" || !argv[1]) throw new Error(usage);
  const [executable, ...commandArgs] = argv.slice(1);
  const ctx = { ...recorder.active(), ...gitSnapshot(root) };
  const span = randomUUID();
  recorder.emit(ctx, "command_start", { span, kind: commandKind([executable, ...commandArgs].join(" ")) });
  const started = process.hrtime.bigint();
  const child = spawn(executable, commandArgs, { stdio: "inherit", shell: false });
  const handlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  const result = await new Promise((resolve) => {
    child.once("error", () => resolve({ exitCode: 127, signal: null }));
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  for (const [signal, handler] of handlers) process.off(signal, handler);
  let recordingFailed = false;
  try {
    recorder.emit(ctx, "command_end", { span, ...result, durationMs: Number(process.hrtime.bigint() - started) / 1e6 });
  } catch {
    recordingFailed = true;
    console.error("task-execution: result recording failed; command result must be checked separately");
  }
  process.exitCode = result.exitCode ?? (128 + (constants.signals[result.signal] ?? 1));
  if (recordingFailed && process.exitCode === 0) process.exitCode = 1;
}

try {
  if (action === "hook") {
    // Observation only: no context injection, blocking, retries or model calls.
    try { recorder.hook(readHook()); }
    catch { console.error("task-execution: hook recording unavailable"); }
    process.stdout.write("{}");
  } else if (action === "start" && args.length >= 1 && args.length <= 2) {
    recorder.start(...args);
    console.log("task-execution: started");
  } else if (action === "stage" && args.length === 1) {
    recorder.stage(args[0]);
  } else if (action === "finish" && args.length === 1) {
    recorder.finish(args[0]);
  } else if (action === "run") {
    await run(args);
  } else if (action === "report" && (args.length === 1 || (args.length === 2 && args[1] === "--json"))) {
    const report = summarize(recorder.read(args[0]));
    process.stdout.write(args[1] === "--json" ? `${JSON.stringify(report, null, 2)}\n` : markdown(report));
  } else { throw new Error(usage); }
} catch (error) {
  console.error(error.message === usage ? usage : "task-execution: operation failed; check task, stage, active context and filesystem access");
  process.exitCode = 1;
}
