import { initializeCuratedDictionaryUi } from "./curated-dictionary-ui.js";
import { initializeGlossaryUi } from "./glossary-ui.js";
import { initializeLocalDictionaryImportUi } from "./local-dictionary-import-ui.js";
import { initializePackUi } from "./pack-ui.js";
import { initializeRichMdictImportUi } from "./rich-mdict-import-ui.js";

type StatusWriter = (message: string, error?: boolean) => void;
type LegacyController = { dispose?: () => void } | null | void;

let statusWriter: StatusWriter = () => {};
const controllers: LegacyController[] = [];
let pagehideBound = false;
const lifecycle = createLegacyIslandLifecycle(start, dispose);

export function mountLegacyOptionsIslands(setStatus: StatusWriter) {
  statusWriter = setStatus;
  if (!pagehideBound) {
    pagehideBound = true;
    window.addEventListener("pagehide", lifecycle.dispose, { once: true });
  }
  return lifecycle.mount();
}

export function createLegacyIslandLifecycle(startOwner: () => Promise<void>, disposeOwner: () => void) {
  let references = 0, started = false, startPromise: Promise<void> | null = null, disposalGeneration = 0;
  return Object.freeze({
    mount() {
      disposalGeneration += 1;
      references += 1;
      if (!startPromise) { started = true; startPromise = startOwner(); }
      let released = false;
      return () => {
        if (released) return;
        released = true; references = Math.max(0, references - 1);
        const pending = ++disposalGeneration;
        queueMicrotask(() => { if (references === 0 && pending === disposalGeneration) disposeOwner(); });
      };
    },
    dispose() { disposalGeneration += 1; references = 0; disposeOwner(); },
    state() { return Object.freeze({ references, started }); }
  });
}

async function start() {
  const setStatus = (message: string, error = false) => statusWriter(message, error);
  // Every controller binds its event listeners synchronously before the first
  // refresh await, so the visible compatibility island is interactive at commit.
  const glossaryReady = initializeGlossaryUi({ setStatus }).then(dispose => { if (dispose) controllers.push({ dispose }); });
  const packReady = (initializePackUi as unknown as (options: { setStatus: StatusWriter }) => Promise<LegacyController>)({ setStatus }).then(controller => { controllers.push(controller); });
  const rich = (initializeRichMdictImportUi as unknown as (options: { setStatus: StatusWriter }) => LegacyController)({ setStatus });
  controllers.push(rich);
  const curatedReady = (initializeCuratedDictionaryUi as unknown as (options: { setStatus: StatusWriter }) => Promise<LegacyController>)({ setStatus }).then(controller => { controllers.push(controller); });
  controllers.push((initializeLocalDictionaryImportUi as unknown as (options: { setStatus: StatusWriter }) => LegacyController)({ setStatus }));
  const results = await Promise.allSettled([glossaryReady, packReady, curatedReady]);
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") statusWriter(failed.reason instanceof Error ? failed.reason.message : "词典设置初始化失败。", true);
}

function dispose() {
  for (const controller of controllers.splice(0)) controller?.dispose?.();
}

export function legacyIslandDebugState() {
  return lifecycle.state();
}
