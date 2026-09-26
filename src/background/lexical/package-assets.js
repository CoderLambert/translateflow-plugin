export async function readPackageBytes(relativePath) {
  const path = String(relativePath || "");
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Unsafe extension package path");
  }

  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Extension package asset unavailable: " + path);
  return new Uint8Array(await response.arrayBuffer());
}
