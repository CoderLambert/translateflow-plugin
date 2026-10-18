const STORAGE_KEY = "quickControlPositions";
const MAX_SITES = 256;
let store;

export const readQuickControlPosition = sender => (store ||= createQuickControlPositionStore()).read(sender);
export const saveQuickControlPosition = (sender, position) => (store ||= createQuickControlPositionStore()).write(sender, position);

export function createQuickControlPositionStore({ storage = chrome.storage.local, extensionId = chrome.runtime.id } = {}) {
  let queue = Promise.resolve();
  function site(sender) {
    let url, tab;
    try { url = new URL(sender?.url); tab = new URL(sender?.tab?.url); } catch {}
    if (sender?.id !== extensionId || !extensionId || sender?.frameId !== 0 || !Number.isInteger(sender?.tab?.id)
      || !url || !tab || !["http:", "https:"].includes(url.protocol) || url.origin !== tab.origin) {
      throw Object.assign(new Error("Position preferences are only available to top-frame page content."), { code: "QUICK_CONTROL_CONTENT_ONLY" });
    }
    return `${url.protocol}//${url.hostname}`;
  }
  async function readSites() {
    const value = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
    const entries = value?.version === 1 && value.sites && typeof value.sites === "object" ? Object.entries(value.sites) : [];
    return Object.fromEntries(entries.filter(([origin, position]) => {
      try { const url = new URL(origin); return ["http:", "https:"].includes(url.protocol)
        && `${url.protocol}//${url.hostname}` === origin && valid(position); } catch { return false; }
    }).slice(-MAX_SITES));
  }
  return Object.freeze({
    async read(sender) {
      const origin = site(sender);
      await queue;
      return { position: (await readSites())[origin] || null };
    },
    write(sender, position) {
      const origin = site(sender);
      if (position !== null && !valid(position)) throw Object.assign(new Error("Invalid floating control position."), { code: "QUICK_CONTROL_POSITION_INVALID" });
      const next = position === null ? null : { x: position.x, y: position.y };
      const result = queue.then(async () => {
        const sites = await readSites();
        delete sites[origin];
        if (next) sites[origin] = next;
        await storage.set({ [STORAGE_KEY]: { version: 1, sites: Object.fromEntries(Object.entries(sites).slice(-MAX_SITES)) } });
        return { position: next };
      });
      queue = result.catch(() => {});
      return result;
    }
  });
}

function valid(position) {
  return position && typeof position === "object" && !Array.isArray(position)
    && Object.keys(position).length === 2 && [position.x, position.y].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}
