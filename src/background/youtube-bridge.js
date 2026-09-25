const YOUTUBE_MAIN_BRIDGE_FILES = Object.freeze([
  "src/content/subtitles/youtube-bridge-protocol.js",
  "src/content/subtitles/youtube-timedtext.js",
  "src/content/subtitles/youtube-main-bridge.js"
]);

export function isYouTubePageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl || "");
    return /^https?:$/.test(url.protocol)
      && /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)
      && (/\/watch$/.test(url.pathname) || /^\/(?:shorts|live|embed)\//i.test(url.pathname) || url.hostname.endsWith("youtu.be"));
  } catch {
    return false;
  }
}

export function validateYouTubeBridgeSender(sender) {
  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error("YouTube bridge requires a valid sender tab.");
  if (!isYouTubePageUrl(sender?.tab?.url)) throw new Error("YouTube bridge is only available on a YouTube video page.");
  return tabId;
}

export async function installYouTubeMainBridge(sender, {
  chromeApi = globalThis.chrome,
  files = YOUTUBE_MAIN_BRIDGE_FILES
} = {}) {
  const tabId = validateYouTubeBridgeSender(sender);
  if (!chromeApi?.scripting?.executeScript) throw new Error("Chrome scripting API is unavailable.");
  await chromeApi.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: [...files]
  });
  return { installed: true, tabId, world: "MAIN", files: [...files] };
}

export { YOUTUBE_MAIN_BRIDGE_FILES };
