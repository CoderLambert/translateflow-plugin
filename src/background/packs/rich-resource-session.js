// Background-only: storage.session survives service-worker restarts, not browser restarts.
export const RICH_RESOURCE_SESSION_KEY = "richDictionaryResourceBrowserSessionV1";
const flights = new WeakMap();
export function getRichResourceBrowserSession({ storageArea = globalThis.chrome?.storage?.session, cryptoProvider = globalThis.crypto } = {}) {
  if (!storageArea?.get || !storageArea?.set) return Promise.reject(new Error("Browser-session storage is unavailable."));
  if (flights.has(storageArea)) return flights.get(storageArea);
  const flight = (async () => {
    const stored = (await storageArea.get([RICH_RESOURCE_SESSION_KEY]))?.[RICH_RESOURCE_SESSION_KEY];
    if (/^[a-f0-9]{64}$/u.test(stored || "")) return stored;
    const bytes = new Uint8Array(32);
    if (!cryptoProvider?.getRandomValues) throw new Error("Secure browser-session identity is unavailable.");
    cryptoProvider.getRandomValues(bytes);
    const token = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    await storageArea.set({ [RICH_RESOURCE_SESSION_KEY]: token });
    return token;
  })();
  flights.set(storageArea, flight);
  flight.catch(() => { if (flights.get(storageArea) === flight) flights.delete(storageArea); });
  return flight;
}
