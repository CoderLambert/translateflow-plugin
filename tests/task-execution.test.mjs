import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRecorder, commandKind } from "../scripts/task-execution-log.mjs";
import { markdown, summarize } from "../scripts/task-execution-report.mjs";

function fixture(t, cli = false) {
  const root = mkdtempSync(join(tmpdir(), "tf-task-execution-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (cli) {
    mkdirSync(join(root, "scripts"));
    for (const name of ["task-execution.mjs", "task-execution-log.mjs", "task-execution-report.mjs"]) {
      cpSync(fileURLToPath(new URL(`../scripts/${name}`, import.meta.url)), join(root, "scripts", name));
    }
  }
  return { root, recorder: createRecorder(root), cli: join(root, "scripts", "task-execution.mjs") };
}

test("task phases and pause/resume create separate attempts without overwriting active task", (t) => {
  const { recorder } = fixture(t);
  recorder.start("issue-234", "dev_specialist");
  assert.throws(() => recorder.start("issue-235"));
  assert.throws(() => recorder.stage("invented-stage"));
  recorder.stage("implementation");
  recorder.stage("implementation");
  recorder.finish("paused");
  recorder.start("issue-234");
  recorder.finish("pass");
  const report = summarize(recorder.read("issue-234"));
  assert.deepEqual(report.attempts.map((a) => a.result), ["paused", "pass"]);
  assert.equal(report.eventCount, 5);
  assert.notEqual(report.attempts[0].attempt, report.attempts[1].attempt);
  assert.equal(report.modelRequests, null);
  assert.equal(report.tokens, null);
});

test("hooks allowlist metadata and never persist prompts, commands, responses or transcript paths", (t) => {
  const { root, recorder } = fixture(t);
  recorder.start("privacy");
  const secret = "SYNTHETIC_PRIVATE_SENTINEL_DO_NOT_PERSIST";
  recorder.hook({ hook_event_name: "PreToolUse", session_id: "native-session", turn_id: "turn", tool_use_id: "tool", tool_name: "Bash", model: "gpt-test", tool_input: { command: `npm run validate -- ${secret}` }, transcript_path: `/private/${secret}`, prompt: secret });
  recorder.hook({ hook_event_name: "PostToolUse", session_id: "native-session", turn_id: "turn", tool_use_id: "tool", tool_name: "Bash", tool_response: { exit_code: 7, output: secret } });
  const raw = readFileSync(join(root, "docs/task-execution/local/privacy.jsonl"), "utf8");
  assert.ok(!raw.includes(secret));
  assert.ok(!raw.includes("native-session"));
  assert.ok(!raw.includes("npm run validate"));
  const report = summarize(recorder.read("privacy"));
  assert.equal(report.tools.Bash.count, 1);
  assert.equal(report.tools.Bash.knownFailures, 1);
  assert.deepEqual(report.observedModels, ["gpt-test"]);
});

test("unassigned hooks do not guess a task; unknown results stay unknown; interrupted spans remain unmatched", (t) => {
  const { recorder } = fixture(t);
  recorder.hook({ hook_event_name: "SessionStart", prompt: "issue-999" });
  assert.deepEqual(recorder.read("issue-999").events, []);
  recorder.start("interrupt");
  recorder.hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "unfinished" });
  recorder.hook({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_use_id: "edit" });
  recorder.hook({ hook_event_name: "PostToolUse", tool_name: "apply_patch", tool_use_id: "edit", tool_response: { output: "done" } });
  recorder.hook({ hook_event_name: "Interrupt" });
  recorder.finish("paused");
  const report = summarize(recorder.read("interrupt"));
  assert.equal(report.unmatchedSpans, 1);
  assert.equal(report.tools.apply_patch.unknownResults, 1);
  assert.equal(report.tools.apply_patch.knownFailures, 0);
});

test("clock rollback, corrupt lines and open stages are reported without fabricated durations", (t) => {
  const { root, recorder } = fixture(t);
  const ctx = recorder.start("clock");
  const log = join(root, "docs/task-execution/local/clock.jsonl");
  const start = recorder.read("clock").events[0];
  const end = { ...start, id: "different-event", type: "task_end", result: "pass", at: new Date(Date.parse(start.at) - 1000).toISOString() };
  writeFileSync(log, `${JSON.stringify(start)}\nBROKEN\n${JSON.stringify(end)}\n${JSON.stringify(end)}\n`);
  const report = summarize(recorder.read("clock"));
  assert.equal(report.invalidLines, 1);
  assert.equal(report.eventCount, 2);
  assert.equal(report.clockAnomalies, 2);
  assert.equal(report.attempts[0].wallMs, null);
  assert.deepEqual(report.stageWallMs, {});
  assert.ok(markdown(report).includes("UNKNOWN"));
  assert.equal(ctx.task, "clock");
});

test("unsafe task ids and symlinked storage are rejected", (t) => {
  const { root, recorder } = fixture(t);
  assert.throws(() => recorder.start("../../outside"));
  assert.throws(() => recorder.read("/private/file"));
  mkdirSync(join(root, "docs"));
  const outside = mkdtempSync(join(tmpdir(), "tf-task-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(root, "docs/task-execution"));
  assert.throws(() => recorder.start("safe"));
});

test("CLI wrapper records real nonzero exit and excludes argv/output from JSONL", (t) => {
  const { root, recorder, cli } = fixture(t, true);
  const secret = "SYNTHETIC_ARG_OUTPUT_SENTINEL";
  assert.equal(spawnSync(process.execPath, [cli, "start", "cli-run"]).status, 0);
  const result = spawnSync(process.execPath, [cli, "run", "--", process.execPath, "-e", `console.log('${secret}'); process.exit(9)`], { encoding: "utf8" });
  assert.equal(result.status, 9);
  assert.ok(result.stdout.includes(secret));
  const raw = readFileSync(join(root, "docs/task-execution/local/cli-run.jsonl"), "utf8");
  assert.ok(!raw.includes(secret));
  const report = summarize(recorder.read("cli-run"));
  assert.equal(report.commandRuns[0].result, "fail");
  assert.equal(report.commandRuns[0].exitCode, 9);
  assert.ok(report.commandRuns[0].durationMs >= 0);
});

test("CLI wrapper handles missing executable and child termination without reporting PASS", (t) => {
  const { recorder, cli } = fixture(t, true);
  spawnSync(process.execPath, [cli, "start", "failure"]);
  assert.equal(spawnSync(process.execPath, [cli, "run", "--", "tf-nonexistent-command-fixture"]).status, 127);
  const killed = spawnSync(process.execPath, [cli, "run", "--", process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"]);
  assert.equal(killed.status, 143);
  const report = summarize(recorder.read("failure"));
  assert.equal(report.commandRuns.length, 2);
  assert.ok(report.commandRuns.every((r) => r.result === "fail"));
  assert.equal(report.commandRuns[1].signal, "SIGTERM");
});

test("concurrent hook processes append complete independent records without context races", async (t) => {
  const { recorder, cli } = fixture(t, true);
  recorder.start("concurrent");
  await Promise.all(Array.from({ length: 16 }, (_, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "hook"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", reject);
    child.on("close", (code) => { try { assert.equal(code, 0); assert.equal(stdout, "{}"); resolve(); } catch (error) { reject(error); } });
    child.stdin.end(JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "session", turn_id: `turn-${index}`, prompt: "ignored" }));
  })));
  const report = summarize(recorder.read("concurrent"));
  assert.equal(report.eventCount, 17);
  assert.equal(report.invalidLines, 0);
  assert.equal(report.observedTurns, 16);
});

test("invalid hook input never blocks a tool, injects context, exposes the input or claims a result", (t) => {
  const { cli } = fixture(t, true);
  const result = spawnSync(process.execPath, [cli, "hook"], { input: "SYNTHETIC_SECRET_BAD_JSON", encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "{}");
  assert.ok(!result.stderr.includes("SYNTHETIC_SECRET"));
});

test("command classification returns bounded labels instead of retaining arbitrary command text", () => {
  assert.equal(commandKind("npm run validate"), "validate");
  assert.equal(commandKind("npm run test:e2e -- anything"), "e2e");
  assert.equal(commandKind("node --test tests/private.test.mjs"), "node-tests");
  assert.equal(commandKind("gh pr checks 266"), "ci-check");
  assert.equal(commandKind("arbitrary private request"), "other");
});

test("overlapping tool spans are not treated as task time or model call counts", (t) => {
  const { recorder } = fixture(t);
  recorder.start("overlap");
  const start = recorder.read("overlap").events[0];
  const event = (id, at, extra) => ({ ...start, id, at: new Date(Date.parse(start.at) + at).toISOString(), type: "hook", ...extra });
  const events = [start,
    event("p1", 10, { event: "PreToolUse", tool: "Bash", toolCall: "one", session: "session" }),
    event("p2", 20, { event: "PreToolUse", tool: "Bash", toolCall: "two", session: "session" }),
    event("e1", 110, { event: "PostToolUse", toolCall: "one", session: "session", exitCode: 0, isError: null }),
    event("e2", 120, { event: "PostToolUse", toolCall: "two", session: "session", exitCode: 0, isError: null }),
    event("end", 130, { type: "task_end", result: "pass" })];
  const report = summarize({ events, invalidLines: 0 });
  assert.equal(report.tools.Bash.wallMs, 200);
  assert.equal(report.attempts[0].wallMs, 130);
  assert.equal(report.modelRequests, null);
  assert.ok(markdown(report).includes("overlap"));
});

test("late Post retains original task and attempt across pause, switch, restart and finish", (t) => {
  const { recorder } = fixture(t);
  const pre = (id) => ({ hook_event_name: "PreToolUse", session_id: "session", tool_use_id: id, tool_name: "Bash" });
  const post = (id) => ({ ...pre(id), hook_event_name: "PostToolUse", tool_response: { exit_code: 0 } });
  const original = recorder.start("task-a");
  recorder.hook(pre("old-call"));
  recorder.finish("paused");
  recorder.start("task-b");
  recorder.hook(post("old-call"));
  assert.equal(summarize(recorder.read("task-a")).tools.Bash.count, 1);
  assert.equal(summarize(recorder.read("task-a")).unmatchedSpans, 0);
  assert.equal(recorder.read("task-b").events.length, 1);
  assert.equal(recorder.read("task-a").events.at(-1).attempt, original.attempt);
  recorder.finish("pass");
  const second = recorder.start("task-a");
  recorder.hook(pre("later-call"));
  recorder.finish("paused");
  recorder.start("task-a");
  recorder.hook(post("later-call"));
  recorder.hook(pre("after-finish"));
  recorder.finish("pass");
  recorder.hook(post("after-finish"));
  const report = summarize(recorder.read("task-a"));
  assert.equal(report.tools.Bash.count, 3);
  assert.equal(report.unmatchedSpans, 0);
  assert.equal(recorder.read("task-a").events.find((e) => e.event === "PostToolUse" && e.attempt === second.attempt).attempt, second.attempt);
});

test("orphan Post is explicitly unassigned instead of borrowing active task context", (t) => {
  const { recorder } = fixture(t);
  recorder.start("task-b");
  recorder.hook({ hook_event_name: "PostToolUse", session_id: "session", tool_use_id: "missing-pre", tool_name: "Bash", tool_response: { exit_code: 1 } });
  assert.equal(recorder.read("task-b").events.length, 1);
  const unknown = recorder.read("unassigned-hooks");
  assert.equal(unknown.events.length, 1);
  assert.equal(unknown.events[0].head, null);
  assert.equal(unknown.events[0].declaredRole, null);
  assert.equal(summarize(unknown).unmatchedSpans, 1);
  assert.throws(() => recorder.start("unassigned-hooks"));
});

test("SIGTERM to wrapper stops its own POSIX process group including a live descendant", { skip: process.platform !== "linux" }, async (t) => {
  const { root, recorder, cli } = fixture(t, true);
  recorder.start("process-tree");
  const childFile = join(root, "descendant.mjs");
  const driverFile = join(root, "driver.mjs");
  writeFileSync(childFile, "console.log('READY:' + process.pid); setInterval(() => {}, 1000);\n");
  writeFileSync(driverFile, "import { spawn } from 'node:child_process'; spawn(process.execPath, [process.argv[2]], { stdio: 'inherit' }); setInterval(() => {}, 1000);\n");
  const wrapper = spawn(process.execPath, [cli, "run", "--", process.execPath, driverFile, childFile], { stdio: ["ignore", "pipe", "pipe"] });
  let descendant = null;
  t.after(() => {
    if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill("SIGTERM");
    if (descendant) { try { process.kill(descendant, "SIGKILL"); } catch {} }
  });
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Wrapper did not stop")), 5000);
    wrapper.once("error", reject);
    wrapper.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  let output = "";
  wrapper.stdout.on("data", (chunk) => {
    output += chunk;
    const match = output.match(/READY:(\d+)/u);
    if (match && !descendant) {
      descendant = Number(match[1]);
      wrapper.kill("SIGTERM");
    }
  });
  const ended = await result;
  assert.ok(descendant, "Descendant was observably alive before interruption");
  assert.equal(ended.code, 143);
  const procStat = join("/proc", String(descendant), "stat");
  try {
    const stat = readFileSync(procStat, "utf8");
    assert.ok(/\) Z /u.test(stat), "Descendant must have exited, not keep running");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const report = summarize(recorder.read("process-tree"));
  assert.equal(report.commandRuns[0].result, "fail");
  assert.equal(report.commandRuns[0].signal, "SIGTERM");
});
