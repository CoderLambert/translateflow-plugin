import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEcosystemCertificationBase } from "../scripts/resolve-ecosystem-certification-base.mjs";
import { certifyDictionaryEcosystemV2 } from "../scripts/certify-dictionary-ecosystem-v2.mjs";

const SCOPE_PATH = "docs/DICTIONARY_ECOSYSTEM_V2_RELEASE_SCOPE.json";
const scopeTemplate = JSON.parse(await readFile(new URL(`../${SCOPE_PATH}`, import.meta.url), "utf8"));

async function repository(t) {
  const cwd = await mkdtemp(join(tmpdir(), "translateflow-scope-base-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "--initial-branch=main");
  const commit = (message) => {
    git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-c", "commit.gpgsign=false", "commit", "--no-verify", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  await writeFile(join(cwd, "README.md"), "synthetic initial main\n");
  const frozenBaseSha = commit("initial main before frozen manifest");
  const scope = { ...structuredClone(scopeTemplate), mainBaseSha: frozenBaseSha };
  await mkdir(join(cwd, "docs"));
  await writeFile(join(cwd, SCOPE_PATH), JSON.stringify(scope));
  const eventBaseSha = commit("frozen scope recorded on main");
  await writeFile(join(cwd, "README.md"), "synthetic advanced main\n");
  const headSha = commit("main advances without changing frozen scope");
  return {
    cwd, git, commit, scope, eventBaseSha, frozenBaseSha, headSha,
    resolve: (options = {}) => resolveEcosystemCertificationBase({ cwd, eventName: "pull_request", eventBaseSha, ...options })
  };
}

async function unrelatedCommit(repo) {
  repo.git("checkout", "-q", "--orphan", "unrelated");
  repo.git("rm", "-rfq", ".");
  await writeFile(join(repo.cwd, "unrelated.txt"), "not an ancestor\n");
  const sha = repo.commit("unrelated synthetic history");
  repo.git("checkout", "-q", "main");
  return sha;
}

function certifyScope(scope, expectedBaseSha) {
  // Other evidence is intentionally absent; assert the unchanged certifier's scope result.
  return certifyDictionaryEcosystemV2({ scope, expectedBaseSha });
}

test("PR and push use the trusted frozen identity when the main tip advances", async (t) => {
  const repo = await repository(t);
  for (const eventName of ["pull_request", "push"]) {
    const result = repo.resolve({ eventName, eventBaseSha: repo.headSha });
    assert.deepEqual(result, { eventName, eventBaseSha: repo.headSha, headSha: repo.headSha, frozenBaseSha: repo.frozenBaseSha });
    assert.notEqual(result.frozenBaseSha, result.eventBaseSha);
    assert.equal(certifyScope(repo.scope, result.frozenBaseSha).evidence.scope.status, "passed");
  }
});

test("a changed HEAD scope cannot supply its own expected base to the existing certifier", async (t) => {
  const repo = await repository(t);
  const changedScope = { ...repo.scope, mainBaseSha: repo.headSha };
  await writeFile(join(repo.cwd, SCOPE_PATH), JSON.stringify(changedScope));
  repo.commit("PR changes its scope identity");
  const resolved = repo.resolve();
  assert.equal(resolved.frozenBaseSha, repo.frozenBaseSha);
  const result = certifyScope(changedScope, resolved.frozenBaseSha);
  assert.equal(result.status, "FAIL");
  assert.equal(result.evidence.scope.status, "failed");
  assert.ok(result.failures.some((failure) => failure.includes("frozen scope base SHA for this certification run")));
});

test("missing, zero, abbreviated, uppercase and unknown event commits fail closed", async (t) => {
  const repo = await repository(t);
  for (const eventBaseSha of [undefined, "", "0".repeat(40), repo.eventBaseSha.slice(0, 7), "A".repeat(40), "f".repeat(40)]) {
    assert.throws(() => repo.resolve({ eventBaseSha }), /event base SHA must be/u);
  }
});

test("a blob or annotated tag is rejected rather than peeled into a commit", async (t) => {
  const repo = await repository(t);
  const blob = repo.git("rev-parse", "HEAD:README.md");
  repo.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "tag", "-a", "fixture-tag", "-m", "synthetic tag");
  const tag = repo.git("rev-parse", "fixture-tag");
  for (const eventBaseSha of [blob, tag]) {
    assert.throws(() => repo.resolve({ eventBaseSha }), /available commit ancestor/u);
  }
});

test("an available event commit outside the checked-out history is rejected", async (t) => {
  const repo = await repository(t);
  const other = await unrelatedCommit(repo);
  assert.throws(() => repo.resolve({ eventBaseSha: other }), /event base SHA must be an available commit ancestor/u);
});

test("the trusted event commit must contain a readable scope manifest", async (t) => {
  const repo = await repository(t);
  assert.throws(() => repo.resolve({ eventBaseSha: repo.frozenBaseSha }), /readable frozen ecosystem scope/u);
  await writeFile(join(repo.cwd, SCOPE_PATH), "{not-json");
  const malformed = repo.commit("malformed trusted manifest");
  assert.throws(() => repo.resolve({ eventBaseSha: malformed }), /readable frozen ecosystem scope/u);
});

test("wrong scope identity or invalid frozen commit never receives an implicit fallback", async (t) => {
  const repo = await repository(t);
  for (const mainBaseSha of ["", "0".repeat(40), "f".repeat(40), repo.git("rev-parse", "HEAD:README.md")]) {
    await writeFile(join(repo.cwd, SCOPE_PATH), JSON.stringify({ ...repo.scope, mainBaseSha }));
    const eventBaseSha = repo.commit("invalid frozen commit");
    assert.throws(() => repo.resolve({ eventBaseSha }), /frozen scope base SHA must be/u);
  }
  await writeFile(join(repo.cwd, SCOPE_PATH), JSON.stringify({ ...repo.scope, manifest: "different-manifest" }));
  assert.throws(() => repo.resolve({ eventBaseSha: repo.commit("wrong manifest") }), /invalid ecosystem scope identity/u);
});

test("the frozen commit must also be an ancestor of HEAD", async (t) => {
  const repo = await repository(t);
  const other = await unrelatedCommit(repo);
  await writeFile(join(repo.cwd, SCOPE_PATH), JSON.stringify({ ...repo.scope, mainBaseSha: other }));
  const eventBaseSha = repo.commit("scope claims unrelated base");
  assert.throws(() => repo.resolve({ eventBaseSha }), /frozen scope base SHA must be an available commit ancestor/u);
});

test("manual dispatch uses only its explicit valid ancestor input", async (t) => {
  const repo = await repository(t);
  const result = repo.resolve({ eventName: "workflow_dispatch", manualBaseSha: repo.frozenBaseSha });
  assert.deepEqual(result, { eventName: "workflow_dispatch", eventBaseSha: null, headSha: repo.headSha, frozenBaseSha: repo.frozenBaseSha });
  assert.equal(certifyScope(repo.scope, result.frozenBaseSha).evidence.scope.status, "passed");
  for (const manualBaseSha of [undefined, "", "0".repeat(40), repo.frozenBaseSha.slice(0, 8), "f".repeat(40), await unrelatedCommit(repo)]) {
    assert.throws(() => repo.resolve({ eventName: "workflow_dispatch", manualBaseSha }), /explicit manual base SHA must be/u);
  }
});

test("manual input differing from the frozen scope still fails the existing certifier", async (t) => {
  const repo = await repository(t);
  const result = certifyScope(repo.scope, repo.resolve({ eventName: "workflow_dispatch", manualBaseSha: repo.headSha }).frozenBaseSha);
  assert.equal(result.status, "FAIL");
  assert.equal(result.evidence.scope.status, "failed");
  assert.ok(result.failures.some((failure) => failure.includes("frozen scope base SHA for this certification run")));
  assert.throws(() => repo.resolve({ eventName: "schedule" }), /unsupported certification event/u);
});

test("the actual CLI publishes only validated output and logs each evidence identity", async (t) => {
  const repo = await repository(t);
  await mkdir(join(repo.cwd, "scripts"));
  const script = join(repo.cwd, "scripts/resolve-ecosystem-certification-base.mjs");
  await copyFile(new URL("../scripts/resolve-ecosystem-certification-base.mjs", import.meta.url), script);
  const output = join(repo.cwd, "github-output");
  await writeFile(output, "");
  const env = { ...process.env, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: "pull_request", ECOSYSTEM_EVENT_BASE_SHA: repo.eventBaseSha, ECOSYSTEM_MANUAL_BASE_SHA: "" };
  const result = spawnSync(process.execPath, [script], { cwd: repo.cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(output, "utf8"), `base_sha=${repo.frozenBaseSha}\n`);
  assert.deepEqual(JSON.parse(result.stdout), repo.resolve());
  const failed = spawnSync(process.execPath, [script], { cwd: repo.cwd, env: { ...env, ECOSYSTEM_EVENT_BASE_SHA: "0".repeat(40) }, encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, "");
  assert.equal(await readFile(output, "utf8"), `base_sha=${repo.frozenBaseSha}\n`);
});

test("workflow passes the trusted event and explicit input then uses the resolver output", async () => {
  const workflow = await readFile(new URL("../.github/workflows/dictionary-library-vnext-certification.yml", import.meta.url), "utf8");
  const resolverAt = workflow.indexOf("id: ecosystem-base");
  const finalGateAt = workflow.indexOf("- name: Certify frozen Dictionary Ecosystem v2 release scope and evidence");
  assert.ok(resolverAt > 0 && resolverAt < finalGateAt);
  const resolverStep = workflow.slice(resolverAt, finalGateAt);
  assert.match(resolverStep, /if: steps\.ecosystem-scope\.outputs\.ready == 'true'/u);
  assert.match(resolverStep, /run: node scripts\/resolve-ecosystem-certification-base\.mjs/u);
  assert.match(resolverStep, /ECOSYSTEM_EVENT_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}/u);
  assert.match(resolverStep, /ECOSYSTEM_MANUAL_BASE_SHA: \$\{\{ inputs\.base_sha \}\}/u);
  assert.match(workflow.slice(finalGateAt), /DICTIONARY_ECOSYSTEM_V2_BASE_SHA: \$\{\{ steps\.ecosystem-base\.outputs\.base_sha \}\}/u);
});
