#!/usr/bin/env node
// Local-only task evidence. No network, model calls, or automatic Git mutations.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u;
const SHA = /^[a-f0-9]{40}$/u;
const hash = (data) => createHash("sha256").update(data).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };

// Refuse traversal and symlinked task/evidence parents; never remove output trees.
function safePath(root, path) {
  const full = resolve(root, path), rel = relative(root, full);
  requireValue(rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep), "Path outside workspace");
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (existsSync(current)) requireValue(!lstatSync(current).isSymbolicLink(), "Symlinked evidence path");
  }
  return full;
}
function save(root, path, value) {
  const full = safePath(root, path), temp = `${full}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temp, full);
}
function paths(root, task) {
  requireValue(ID.test(task), "Invalid task id");
  const dir = `docs/tasks/${task}`;
  return { dir, state: safePath(root, `${dir}/state.json`), acceptance: safePath(root, `${dir}/acceptance.json`), review: safePath(root, `${dir}/review.md`) };
}
function load(root, task) {
  const p = paths(root, task), state = json(p.state);
  requireValue(state.task === task && state.schema === 1, "Invalid task state");
  requireValue(Array.isArray(state.validationCommands) && state.validationCommands.every((c) => Array.isArray(c) && c.length && c.every((s) => typeof s === "string" && s.length)), "Invalid validation commands");
  requireValue(state.validationCommands.some((c) => same(c, ["npm", "run", "validate"])), "Full local validate is mandatory");
  requireValue(Array.isArray(state.dependencies), "Invalid dependencies");
  return { p, state };
}
function archiveFiles(task) {
  return new Set([`docs/tasks/${task}/state.json`, `docs/tasks/${task}/acceptance.json`, `docs/tasks/${task}/review.md`, "docs/tasks/index.json"]);
}
export function inputTree(root, task, head) {
  const excluded = archiveFiles(task);
  const files = execFileSync("git", ["ls-tree", "-r", "-z", head], { cwd: root }).toString().split("\0").filter(Boolean);
  return hash(files.filter((line) => !excluded.has(line.slice(line.indexOf("\t") + 1))).join("\0"));
}
function contract(root, task, head) {
  const prefix = `docs/tasks/${task}`;
  const state = JSON.parse(git(root, "show", `${head}:${prefix}/state.json`));
  return { validationCommands: state.validationCommands, dependencies: state.dependencies, artifactRequired: state.artifactRequired === true };
}
function ensureCandidate(root, task, acceptance, state) {
  requireValue(acceptance.task === task && SHA.test(acceptance.candidateHead), "Candidate not frozen");
  const head = git(root, "rev-parse", "HEAD");
  git(root, "merge-base", "--is-ancestor", "origin/main", head);
  git(root, "merge-base", "--is-ancestor", acceptance.candidateHead, head);
  requireValue(acceptance.tree === git(root, "rev-parse", `${acceptance.candidateHead}^{tree}`), "Candidate tree mismatch");
  requireValue(acceptance.inputTree === inputTree(root, task, acceptance.candidateHead) && acceptance.inputTree === inputTree(root, task, head), "Code or task contract changed; freeze and verify again");
  const expected = contract(root, task, acceptance.candidateHead);
  requireValue(same(expected, { validationCommands: state.validationCommands, dependencies: state.dependencies, artifactRequired: state.artifactRequired === true }), "Acceptance requirements changed after freezing");
  const changed = execFileSync("git", ["diff", "HEAD", "--name-only", "-z"], { cwd: root }).toString().split("\0").filter(Boolean);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root }).toString().split("\0").filter(Boolean);
  requireValue([...changed, ...untracked].every((f) => archiveFiles(task).has(f)), "Uncommitted code/test/build input; freeze again");
  return head;
}
function evidence(root, task) {
  const base = "docs/task-execution/local";
  for (const dir of [base, `${base}/${task}`]) {
    const full = safePath(root, dir);
    if (!existsSync(full)) mkdirSync(full, { mode: 0o700 });
    requireValue(lstatSync(full).isDirectory(), "Evidence directory unavailable");
  }
  return `${base}/${task}`;
}
function event(root, task, type, details = {}) {
  const log = safePath(root, `${evidence(root, task)}/events.jsonl`);
  // Explicit lifecycle events only; raw payloads never enter this record.
  writeFileSync(log, `${JSON.stringify({ schema: 1, task, role: "main", type, at: new Date().toISOString(), branch: git(root, "branch", "--show-current"), head: git(root, "rev-parse", "HEAD"), ...details })}\n`, { flag: "a", mode: 0o600 });
}
export function buildIndex(root) {
  const tasks = readdirSync(join(root, "docs/tasks"), { withFileTypes: true }).filter((d) => d.isDirectory() && ID.test(d.name)).map((d) => {
    const s = json(safePath(root, `docs/tasks/${d.name}/state.json`));
    requireValue(s.task === d.name, "Task directory mismatch");
    return { task: s.task, status: s.status, dependencies: s.dependencies, branch: s.branch ?? null, candidateHead: s.candidateHead ?? null };
  }).sort((a, b) => a.task.localeCompare(b.task, "en", { numeric: true }));
  return { schema: 1, source: "*/state.json", tasks };
}
export function freeze(root, task) {
  const { p, state } = load(root, task);
  requireValue(!git(root, "status", "--porcelain"), "Commit the candidate before freezing");
  const head = git(root, "rev-parse", "HEAD");
  git(root, "merge-base", "--is-ancestor", "origin/main", head);
  const acceptance = { schema: 1, task, candidateHead: head, tree: git(root, "rev-parse", `${head}^{tree}`), inputTree: inputTree(root, task, head), frozenAt: new Date().toISOString(), environment: { node: process.version, npm: execFileSync("npm", ["--version"], { cwd: root, encoding: "utf8" }).trim(), browser: "NOT RUN" }, checks: [], artifact: null, limitations: [] };
  save(root, relative(root, p.acceptance), acceptance);
  event(root, task, "candidate_frozen", { candidateHead: head });
  return acceptance;
}
export async function runCheck(root, task, argv) {
  const { p, state } = load(root, task), acceptance = json(p.acceptance);
  ensureCandidate(root, task, acceptance, state);
  requireValue(state.validationCommands.some((c) => same(c, argv)), "Command is not in task acceptance requirements");
  const id = randomUUID(), path = `${evidence(root, task)}/${id}.log`;
  const full = safePath(root, path);
  writeFileSync(full, "", { flag: "wx", mode: 0o600 });
  const start = process.hrtime.bigint(), at = new Date().toISOString();
  event(root, task, "command_start", { span: id, evidence: path });
  const child = spawn(argv[0], argv.slice(1), { cwd: root, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  let bytes = 0, completeLog = true;
  const record = (chunk, output) => {
    output.write(chunk); bytes += chunk.length;
    if (bytes > 64 * 1024 * 1024) { completeLog = false; return; }
    try { writeFileSync(full, chunk, { flag: "a" }); } catch { completeLog = false; }
  };
  child.stdout.on("data", (chunk) => record(chunk, process.stdout));
  child.stderr.on("data", (chunk) => record(chunk, process.stderr));
  const handlers = ["SIGINT", "SIGTERM"].map((signal) => {
    const handler = () => { if (child.pid) { try { if (process.platform === "win32") child.kill(signal); else process.kill(-child.pid, signal); } catch (e) { if (e.code !== "ESRCH") completeLog = false; } } };
    process.on(signal, handler); return [signal, handler];
  });
  const result = await new Promise((done) => { child.once("error", () => done({ exitCode: 127, signal: null })); child.once("close", (exitCode, signal) => done({ exitCode, signal })); });
  for (const [signal, handler] of handlers) process.off(signal, handler);
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
  // A concurrent edit cannot become a passing record for the old candidate.
  let unchanged = true;
  try { ensureCandidate(root, task, acceptance, state); } catch { unchanged = false; }
  const check = { command: argv, candidateHead: acceptance.candidateHead, result: result.exitCode === 0 && !result.signal && completeLog && unchanged ? "PASS" : "FAIL", ...result, durationMs, startedAt: at, log: path, logSha256: hash(readFileSync(full)) };
  acceptance.checks.push(check);
  save(root, relative(root, p.acceptance), acceptance);
  event(root, task, "command_end", { span: id, durationMs, exitCode: result.exitCode, result: check.result, evidence: path });
  return check;
}
export function fingerprint(root, path) {
  requireValue(path === "dist/extension" || path === ".output/chrome-mv3", "Only actual extension package roots are accepted");
  const base = safePath(root, path), items = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      const full = safePath(root, relative(root, join(dir, name))), stat = lstatSync(full);
      if (stat.isDirectory()) walk(full);
      else { requireValue(stat.isFile(), "Invalid artifact file"); items.push(`${relative(base, full).split(sep).join("/")}\0${hash(readFileSync(full))}`); }
    }
  }
  walk(base); requireValue(items.length > 0 && existsSync(join(base, "manifest.json")), "Missing extension artifact");
  return hash(items.join("\n"));
}
export function gate(root, task) {
  const { p, state } = load(root, task), acceptance = json(p.acceptance);
  const syncHead = ensureCandidate(root, task, acceptance, state);
  requireValue(same(json(join(root, "docs/tasks/index.json")), buildIndex(root)), "Task index is stale; regenerate it");
  for (const dep of state.dependencies) {
    requireValue(ID.test(dep), "Invalid dependency id");
    const dependency = json(safePath(root, `docs/tasks/${dep}/state.json`));
    requireValue(dependency.status === "completed" && SHA.test(dependency.mergeHead ?? ""), `Dependency ${dep} is not merged`);
    git(root, "merge-base", "--is-ancestor", dependency.mergeHead, "origin/main");
  }
  for (const command of state.validationCommands) {
    const check = acceptance.checks.findLast((c) => same(c.command, command));
    requireValue(check?.result === "PASS" && check.candidateHead === acceptance.candidateHead && check.exitCode === 0 && !check.signal && Number.isFinite(check.durationMs) && check.durationMs >= 0, `Missing passing check: ${command.join(" ")}`);
    requireValue(typeof check.log === "string" && check.log.startsWith(`docs/task-execution/local/${task}/`), "Invalid evidence log");
    requireValue(hash(readFileSync(safePath(root, check.log))) === check.logSha256, "Evidence log changed or missing");
  }
  if (state.artifactRequired) requireValue(acceptance.artifact, "Actual package evidence is required");
  if (acceptance.artifact) requireValue(fingerprint(root, acceptance.artifact.path) === acceptance.artifact.treeSha256, "Artifact changed or missing");
  const review = readFileSync(p.review, "utf8").match(/^<!-- local-review (.+) -->$/mu);
  requireValue(review, "Independent review is missing");
  const binding = JSON.parse(review[1]);
  requireValue(binding.task === task && binding.candidateHead === acceptance.candidateHead && binding.result === "PASS" && binding.role === "dev_reviewer" && binding.independent === true, "Independent review is stale or not passing");
  requireValue(state.status === "ready_to_sync", "Task is not ready to sync");
  return { result: "PASS", task, candidateHead: acceptance.candidateHead, syncHead, inputTree: acceptance.inputTree, note: "Local evidence only; coordinator must honor remote protection and exact remote head." };
}

async function main() {
  const [action, task, ...args] = process.argv.slice(2);
  if (action === "index" && !task) { save(ROOT, "docs/tasks/index.json", buildIndex(ROOT)); return; }
  const { p, state } = load(ROOT, task);
  if (action === "freeze" && !args.length) console.log(JSON.stringify(freeze(ROOT, task), null, 2));
  else if (action === "run" && args[0] === "--" && args.length > 1) { const result = await runCheck(ROOT, task, args.slice(1)); process.exitCode = result.result === "PASS" ? 0 : 1; }
  else if (action === "artifact" && args.length === 1) {
    const acceptance = json(p.acceptance); ensureCandidate(ROOT, task, acceptance, state);
    acceptance.artifact = { path: args[0], treeSha256: fingerprint(ROOT, args[0]) }; save(ROOT, relative(ROOT, p.acceptance), acceptance);
  } else if (action === "gate" && !args.length) console.log(JSON.stringify(gate(ROOT, task), null, 2));
  else if (action === "mark" && args.length === 1 && ["review_start", "review_end", "code_sync", "task_complete", "task_paused", "task_blocked"].includes(args[0])) event(ROOT, task, args[0]);
  else if (action === "report" && !args.length) {
    const acceptance = json(p.acceptance);
    console.log(JSON.stringify({ task, candidateHead: acceptance.candidateHead, runs: acceptance.checks.length, failures: acceptance.checks.filter((c) => c.result === "FAIL").length, commandDurationMs: acceptance.checks.map((c) => ({ command: c.command, result: c.result, durationMs: c.durationMs ?? null })), modelRequests: "UNKNOWN", tokens: "UNKNOWN", note: "Command spans only; do not add native tool or wall-clock spans." }, null, 2));
  } else throw new Error("Usage: local-task.mjs index | freeze <task> | run <task> -- <approved command> | artifact <task> <package path> | gate <task> | mark <task> <event> | report <task>");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`local-task: ${error.message}`); process.exitCode = 1; });
}
