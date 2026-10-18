import {
  getCatalogPermissionOrigins,
  getDictionaryCatalogEntryForRecipe
} from "../shared/dictionary-catalog-v2.js";

export async function requestDictionaryPackOriginPermission(
  source,
  permissions = globalThis.chrome?.permissions
) {
  const catalogEntry = getDictionaryCatalogEntryForRecipe(source?.id);
  if (catalogEntry) {
    if (!permissions?.request) {
      throw new Error("Chrome optional-origin permission API is unavailable.");
    }
    const origins = getCatalogPermissionOrigins(catalogEntry);
    if (!origins.length || origins.some((origin) => !isExactHttpsOriginPattern(origin))) {
      throw new Error("Dictionary catalog permission origins are invalid.");
    }
    return permissions.request({ origins });
  }

  const pattern = String(source?.originPattern || "");
  if (!pattern.endsWith("/*")) {
    throw new Error("Dictionary pack source has an invalid origin permission.");
  }

  const originUrl = new URL(pattern.slice(0, -1));
  const isLocalhost = ["127.0.0.1", "localhost", "[::1]"].includes(originUrl.hostname);
  const allowedProtocol = originUrl.protocol === "https:" ||
    (source?.allowInsecureLocalhost === true && isLocalhost && originUrl.protocol === "http:");
  const exactHost = Boolean(originUrl.hostname) && !originUrl.hostname.includes("*");
  if (!allowedProtocol || !exactHost || pattern !== `${originUrl.origin}/*`) {
    throw new Error("Dictionary pack source permission must be one exact trusted origin.");
  }
  if (!permissions?.request) {
    throw new Error("Chrome optional-origin permission API is unavailable.");
  }

  return permissions.request({ origins: [pattern] });
}

function isExactHttpsOriginPattern(pattern) {
  if (!pattern.endsWith("/*")) return false;
  let url;
  try { url = new URL(pattern.slice(0, -1)); } catch { return false; }
  return url.protocol === "https:" && Boolean(url.hostname) &&
    !url.hostname.includes("*") && pattern === `${url.origin}/*`;
}
