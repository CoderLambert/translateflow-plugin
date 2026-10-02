import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTflexTechnical } from "../../scripts/build-tflex-technical.mjs";
import { byteSummary } from "../../scripts/wxt-assets.mjs";
import { CONTENT_SCRIPT_FILES, CONTENT_STYLE_FILES } from "../../src/shared/constants.js";
import { EXTENSION_PAGES, WORKER_PATHS, YOUTUBE_MAIN_BRIDGE_FILES } from "../../src/shared/runtime-assets.js";
import { startupNetworkControl } from "./closed-network.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const defaultArtifact = resolve(repoRoot, process.env.TF_E2E_ARTIFACT || "dist/extension");

export async function inventoryArtifact(root) {
  const summary = await byteSummary(root);
  const files = await Promise.all(summary.files.map(async (entry) => ({...entry,
    sha256: createHash("sha256").update(await readFile(join(root, entry.path))).digest("hex")
  })));
  const treeSha256 = createHash("sha256").update(files.map((f) => `${f.path}\0${f.sha256}\n`).join("")).digest("hex");
  return {...summary, files, treeSha256};
}

export async function copyProductionArtifact(artifact, extensionDir) {
  const source = resolve(artifact);
  const destination = resolve(extensionDir);
  for (const [parent,child] of [[source,destination],[destination,source]]) {
    const rel=relative(parent,child);
    assert(rel && (isAbsolute(rel) || rel === ".." || rel.startsWith("../")),
      "Test copy must be isolated from the production artifact");
  }
  // No builder fallback: callers must build/select the real production artifact first.
  const inventory = await inventoryArtifact(source);
  const paths = new Set(inventory.files.map((f) => f.path));
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  const flatRuntime=new Set(["manifest.json",manifest.background.service_worker,...Object.values(EXTENSION_PAGES),
    "content.js","content.css","popup.js","popup.css","popup-appearance.js","options.js","options.css"]);
  for(const path of paths) {
    const top=path.split("/")[0];
    assert(flatRuntime.has(path) || ["src","assets","chunks","_locales"].includes(top),
      `Non-production artifact path: ${path}`);
    assert(!/\.(?:[cm]?tsx?|map|pem|crx|zip)$/u.test(path),`Non-runtime artifact file: ${path}`);
  }
  for (const path of ["manifest.json", manifest.background.service_worker, ...Object.values(EXTENSION_PAGES),
    ...CONTENT_SCRIPT_FILES, ...CONTENT_STYLE_FILES, ...Object.values(WORKER_PATHS), ...YOUTUBE_MAIN_BRIDGE_FILES]) {
    assert(paths.has(path), `Production artifact lacks runtime mapping: ${path}`);
  }
  await cp(source, extensionDir, {recursive: true, errorOnExist: true, force: false});
  assert.equal((await inventoryArtifact(extensionDir)).treeSha256, inventory.treeSha256, "Production copy changed bytes");
  return {...inventory, output: extensionDir, artifact: source,
    sourceHead: process.env.TF_E2E_ARTIFACT_SOURCE_HEAD || null};
}

export async function prepareExtensionTestCopy({artifact = defaultArtifact, extensionDir,
  lexiconPacks = "fixture", ecdictMdxReleaseHostAccess = false, ecdictMdxCachedArchivePath = "", captureCommands = false, observeInstalled = false, executionProof = false, startupNetwork = null, baseUrl}) {
    assert(!(captureCommands && observeInstalled), "Lifecycle observation and Commands probing use separate test copies");
    assert(!(captureCommands && (executionProof || startupNetwork)), "Startup observation and Commands probing use separate test copies");
    const sourceReport = await copyProductionArtifact(artifact, extensionDir);

    const lexiconDir = join(extensionDir, "assets", "lexicon");
    await rm(lexiconDir, { recursive: true, force: true });
    if (lexiconPacks === "release") {
      await cp(join(repoRoot, "assets", "lexicon"), lexiconDir, { recursive: true });
    } else if (lexiconPacks !== "missing") {
      await mkdir(lexiconDir, { recursive: true });
      await cp(
        join(repoRoot, "tests", "fixtures", "tflex-runtime-pack"),
        join(lexiconDir, "core"),
        { recursive: true }
      );
      await compileTflexTechnical({
        extractPath: join(repoRoot, "lexicon", "sources", "wikidata-tech-entities.json"),
        sourceLockPath: join(repoRoot, "lexicon", "source-locks", "technical-wikidata.json"),
        outDir: join(lexiconDir, "technical")
      });

      if (lexiconPacks === "corrupt") {
        const shardPath = join(lexiconDir, "core", "shards", "0000.jsonl");
        const bytes = new Uint8Array(await readFile(shardPath));
        const corruptBytes = new Uint8Array(bytes.byteLength + 1);
        corruptBytes.set(bytes);
        corruptBytes[corruptBytes.length - 1] = 10;
        await writeFile(shardPath, corruptBytes);
      } else if (lexiconPacks === "incompatible") {
        const coreManifestPath = join(lexiconDir, "core", "manifest.json");
        const manifest = JSON.parse(await readFile(coreManifestPath, "utf8"));
        manifest.formatVersion = 2;
        await writeFile(coreManifestPath, JSON.stringify(manifest) + "\n", "utf8");
      }
    }

    const manifestPath = join(extensionDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.host_permissions = [...new Set([...(manifest.host_permissions || []),
      "http://127.0.0.1/*",
      "https://api.deepseek.com/*",
      "https://raw.githubusercontent.com/*"
    ])];
    if (ecdictMdxReleaseHostAccess) {
      manifest.host_permissions.push(
        "https://github.com/*",
        "https://release-assets.githubusercontent.com/*"
      );
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    if (ecdictMdxCachedArchivePath) {
      const mdxWorkerPath = join(
        extensionDir,
        WORKER_PATHS.curatedEcdictMdx
      );
      await writeFile(mdxWorkerPath, makeCachedEcdictMdxTestWorker(baseUrl));
    }


    if (captureCommands) {
      const background = join(extensionDir, manifest.background.service_worker);
      const code = await readFile(background, "utf8");
      await writeFile(background, commandProbePrefix + code + commandProbeSuffix);
    }
    let lifecycleObserver = null;
    if (observeInstalled) {
      const path = manifest.background.service_worker;
      const background = join(extensionDir, path);
      const code = await readFile(background, "utf8");
      const observed = installedObserverPrefix + code;
      await writeFile(background, observed);
      lifecycleObserver = {path,capacity:4,storageWrites:0,apiMocks:0,
        beforeSha256:createHash("sha256").update(code).digest("hex"),
        afterSha256:createHash("sha256").update(observed).digest("hex")};
    }
    let startupObserver = null;
    if (executionProof || startupNetwork) {
      const path = manifest.background.service_worker;
      const background = join(extensionDir, path);
      const code = await readFile(background, "utf8");
      let prefix = executionProof ? `globalThis.__tfWxtExecutionProof = ${JSON.stringify(sourceReport.treeSha256)};\n` : "";
      if (startupNetwork) {
        assert.deepEqual(startupNetwork, startupNetworkControl(startupNetwork.token, baseUrl));
        prefix += `globalThis.__tfNetworkStartupProbe = {token:${JSON.stringify(startupNetwork.token)},calls:3,results:[]};\n`;
        prefix += `for (const origin of ${JSON.stringify(startupNetwork.origins)}) {\n`;
        prefix += `  fetch(origin + "/startup-control", {cache:"no-store",credentials:"omit"}).then(\n`;
        prefix += `    response => __tfNetworkStartupProbe.results.push({origin,state:"FULFILLED",status:response.status}),\n`;
        prefix += `    () => __tfNetworkStartupProbe.results.push({origin,state:"REJECTED"})\n`;
        prefix += `  );\n}\n`;
      }
      await writeFile(background, prefix + code);
      startupObserver = {path,executionProof:executionProof ? sourceReport.treeSha256 : null,
        networkControl:startupNetwork,storageWrites:0,apiMocks:0,
        beforeSha256:createHash("sha256").update(code).digest("hex"),
        afterSha256:createHash("sha256").update(prefix + code).digest("hex")};
    }
    const after = await inventoryArtifact(extensionDir);
    const beforeFiles = new Map(sourceReport.files.map((f) => [f.path, f.sha256]));
    const afterFiles = new Map(after.files.map((f) => [f.path, f.sha256]));
    const changes = [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].filter((p) => beforeFiles.get(p) !== afterFiles.get(p)).sort();
    for (const path of changes) assert(path === "manifest.json" || path.startsWith("assets/lexicon/")
      || ecdictMdxCachedArchivePath && path === WORKER_PATHS.curatedEcdictMdx
      || (captureCommands || observeInstalled || executionProof || startupNetwork) && path === manifest.background.service_worker,
      `Test adapter changed production runtime: ${path}`);
    const originalManifest = JSON.parse(await readFile(join(sourceReport.artifact, "manifest.json"), "utf8"));
    assert.deepEqual({...manifest, host_permissions: originalManifest.host_permissions}, originalManifest,
      "Test adapter changed Manifest beyond host_permissions");
    return {...sourceReport, testCopy: {...after, changes}, lexiconMode: lexiconPacks,
      cachedWorkerOverride: Boolean(ecdictMdxCachedArchivePath), commandCallbackProbe: captureCommands,lifecycleObserver,startupObserver};
}

function makeCachedEcdictMdxTestWorker(baseUrl) {
  return `import { createCuratedEcdictMdxWorkerHandler } from "./curated-ecdict-mdx-worker-core.js";

const handler = createCuratedEcdictMdxWorkerHandler({
  postMessage(message) { self.postMessage(message); },
  network: {
    async fetchSource(source, { signal } = {}) {
      if (
        source?.id !== "ecdict-en-zh-mdx-curated" ||
        source?.downloadUrl !== "https://github.com/skywind3000/ECDICT/releases/download/1.0.28/ecdict-mdx-28.zip"
      ) throw new Error("Test archive bridge only accepts the pinned ECDICT 1.0.28 recipe.");
      const local = await fetch(${JSON.stringify(`${baseUrl}/__e2e/ecdict-mdx-28.zip`)}, {
        method: "GET",
        cache: "no-store",
        signal
      });
      return {
        ok: local.ok,
        status: local.status,
        url: "https://release-assets.githubusercontent.com/e2e-cached/ecdict-mdx-28.zip",
        redirected: true,
        headers: local.headers,
        body: local.body,
        arrayBuffer() { return local.arrayBuffer(); }
      };
    }
  }
});

self.addEventListener("message", (event) => {
  Promise.resolve(handler.handleMessage(event.data)).catch((error) => {
    self.postMessage({
      type: "curated-ecdict-mdx:error",
      requestId: event.data?.requestId || "",
      error: error?.message || String(error),
      errorName: error?.name || "Error",
      errorCode: error?.code || ""
    });
  });
});
`;
}

// Headless keyboard dispatch is not a native browser shortcut. This opt-in test-copy
// probe captures callbacks registered by the actual production entry/bundle; it adds
// no source module and preserves the native listener. All changes enter provenance.
const commandProbePrefix = `
const __tfProbe = globalThis.__tfCommandProbe = {callbacks: [], sends: [], injections: 0, queries: []};
const __tfAddCommand = chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);
chrome.commands.onCommand.addListener = function(callback) { __tfProbe.callbacks.push(callback); return __tfAddCommand(callback); };
const __tfNativeSend = chrome.tabs.sendMessage.bind(chrome.tabs);
chrome.tabs.sendMessage = function(...args) {
  const entry = {args, settled: false}; __tfProbe.sends.push(entry);
  const result = __tfNativeSend(...args);
  Promise.resolve(result).then(value => {entry.value = value; entry.settled = true;}, error => {entry.error = String(error); entry.settled = true;});
  return result;
};
const __tfNativeQuery = chrome.tabs.query.bind(chrome.tabs);
chrome.tabs.query = function(...args) { const promise = __tfNativeQuery(...args); __tfProbe.queries.push(promise); return promise; };
for (const method of ["insertCSS", "executeScript"]) {
  const native = chrome.scripting[method].bind(chrome.scripting);
  chrome.scripting[method] = function(...args) {__tfProbe.injections++; return native(...args);};
}
`;
const commandProbeSuffix = `
chrome.commands.onCommand.addListener = __tfAddCommand;
`;

// Observe real lifecycle delivery only in the explicit upgrade test copy. This
// listener neither changes production listeners nor writes extension storage.
const installedObserverPrefix = `
globalThis.__tfInstalledObserver = {events: [], capacity: 4, overflow: false};
chrome.runtime.onInstalled.addListener(event => {
  const observer = globalThis.__tfInstalledObserver;
  if (observer.events.length < observer.capacity) observer.events.push({...event});
  else observer.overflow = true;
});
`;
