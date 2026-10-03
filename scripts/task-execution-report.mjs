const elapsed = (start, end) => {
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export function summarize({ events, invalidLines }) {
  const result = {
    schema: 1, task: events[0]?.task ?? null, eventCount: events.length, invalidLines,
    attempts: [], stageWallMs: {}, commandRuns: [], tools: Object.create(null),
    observedTurns: 0, subagentStarts: 0, compactions: 0, permissionRequests: 0,
    observedModels: [], observedAgentTypes: [], declaredRoles: [],
    unmatchedSpans: 0, clockAnomalies: 0, repeatedCleanHeadCandidates: [],
    modelRequests: null, tokens: null
  };
  const attempts = new Map();
  const pending = new Map();
  const models = new Set(), roles = new Set(), declared = new Set(), turns = new Set();
  const candidates = new Map();
  function addStage(attempt, until) {
    const ms = elapsed(attempt.stageAt, until);
    if (ms === null) result.clockAnomalies++;
    else result.stageWallMs[attempt.stage] = (result.stageWallMs[attempt.stage] ?? 0) + ms;
  }
  function spanKey(event) {
    return event.type.startsWith("command_") ? `command:${event.attempt}:${event.span}` : `tool:${event.attempt}:${event.session}:${event.toolCall}`;
  }
  for (const event of events) {
    if (event.declaredRole) declared.add(event.declaredRole);
    if (event.type === "task_start") {
      attempts.set(event.attempt, { attempt: event.attempt, startedAt: event.at, endedAt: null, result: "open", stage: event.stage, stageAt: event.at, wallMs: null });
    } else if (event.type === "stage_change") {
      const attempt = attempts.get(event.attempt);
      if (attempt?.result === "open") {
        addStage(attempt, event.at);
        attempt.stage = event.stage;
        attempt.stageAt = event.at;
      }
    } else if (event.type === "task_end") {
      const attempt = attempts.get(event.attempt);
      if (attempt?.result === "open") {
        addStage(attempt, event.at);
        attempt.endedAt = event.at;
        attempt.result = event.result;
        attempt.wallMs = elapsed(attempt.startedAt, event.at);
        if (attempt.wallMs === null) result.clockAnomalies++;
      }
    }
    if (event.observedModel) models.add(event.observedModel);
    if (event.observedAgentType) roles.add(event.observedAgentType);
    if (event.event === "UserPromptSubmit" && event.turn) turns.add(`${event.session}:${event.turn}`);
    if (event.event === "SubagentStart") result.subagentStarts++;
    if (event.event === "PreCompact") result.compactions++;
    if (event.event === "PermissionRequest") result.permissionRequests++;
    const isStart = event.type === "command_start" || (event.event === "PreToolUse" && event.toolCall);
    const isEnd = event.type === "command_end" || (event.event === "PostToolUse" && event.toolCall);
    if (isStart) {
      const key = spanKey(event);
      if (pending.has(key)) result.unmatchedSpans++;
      pending.set(key, event);
    }
    if (isEnd) {
      const key = spanKey(event), start = pending.get(key);
      if (!start) { result.unmatchedSpans++; continue; }
      pending.delete(key);
      const ms = event.type === "command_end" ? event.durationMs : elapsed(start.at, event.at);
      if (!Number.isFinite(ms) || ms < 0) { result.clockAnomalies++; continue; }
      if (event.type === "command_end") {
        const run = { kind: start.kind, stage: start.stage, head: start.head, dirty: start.dirty, durationMs: ms, exitCode: event.exitCode, signal: event.signal, result: event.exitCode === 0 && !event.signal ? "pass" : "fail" };
        result.commandRuns.push(run);
        if (start.head && start.dirty === false && ["validate", "e2e", "node-tests", "unit", "check", "build", "typecheck"].includes(start.kind)) {
          const candidate = `${start.kind}:${start.head}`;
          candidates.set(candidate, (candidates.get(candidate) ?? 0) + 1);
        }
      } else {
        const tool = start.tool ?? "unknown";
        const metric = result.tools[tool] ??= { count: 0, wallMs: 0, knownFailures: 0, unknownResults: 0 };
        metric.count++;
        metric.wallMs += ms;
        if (event.isError === true || (event.exitCode !== null && event.exitCode !== 0)) metric.knownFailures++;
        else if (event.isError !== false && event.exitCode === null) metric.unknownResults++;
      }
    }
  }
  result.unmatchedSpans += pending.size;
  result.attempts = [...attempts.values()].map(({ stageAt, ...attempt }) => attempt);
  result.observedTurns = turns.size;
  result.observedModels = [...models].sort();
  result.observedAgentTypes = [...roles].sort();
  result.declaredRoles = [...declared].sort();
  result.repeatedCleanHeadCandidates = [...candidates].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
  return result;
}

export function markdown(report) {
  const seconds = (ms) => ms === null ? "UNKNOWN" : (ms / 1000).toFixed(3);
  return [
    `# Task execution: ${report.task ?? "no events"}`, "",
    `Events: ${report.eventCount}; invalid lines: ${report.invalidLines}; unmatched spans: ${report.unmatchedSpans}; clock anomalies: ${report.clockAnomalies}.`, "",
    "Stage times are closed wall-clock intervals, including waiting. Open stages are not guessed. Parallel tool spans overlap; do not sum them as task/CPU time.", "",
    "| Attempt | Declared result | Wall seconds |", "| --- | --- | --- |",
    ...report.attempts.map((a) => `| ${a.attempt} | ${a.result} | ${seconds(a.wallMs)} |`), "",
    "| Stage | Closed wall seconds |", "| --- | --- |",
    ...Object.entries(report.stageWallMs).map(([stage, ms]) => `| ${stage} | ${seconds(ms)} |`), "",
    "| Command class | Stage | Result | Exit | Monotonic seconds |", "| --- | --- | --- | --- | --- |",
    ...report.commandRuns.map((r) => `| ${r.kind} | ${r.stage} | ${r.result} | ${r.exitCode ?? "UNKNOWN"} | ${seconds(r.durationMs)} |`), "",
    "| Tool | Completed spans | Wall seconds (overlap possible) | Known failures | Unknown results |", "| --- | --- | --- | --- | --- |",
    ...Object.entries(report.tools).sort((a, b) => b[1].wallMs - a[1].wallMs).slice(0, 10).map(([tool, m]) => `| ${tool} | ${m.count} | ${seconds(m.wallMs)} | ${m.knownFailures} | ${m.unknownResults} |`), "",
    `Observed turns: ${report.observedTurns}; subagent starts: ${report.subagentStarts}; compactions: ${report.compactions}; permission requests: ${report.permissionRequests}.`,
    "Model requests and tokens: UNKNOWN (not supplied by these hooks). Observed turns are not model request counts.", "",
    "Repeated clean-head candidates are investigation hints, not proof of wasted work: arguments, environment and generated inputs may differ.",
    ...report.repeatedCleanHeadCandidates.map((c) => `- ${c.key}: ${c.count} runs`), ""
  ].join("\n");
}
