const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid",
  "igshid", "yclid", "_hsenc", "_hsmi", "vero_conv", "vero_id"
]);

export function normalizeUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error("仅支持 http/https 网页缓存。");
  if (!isRouteLikeHash(url.hash)) url.hash = "";

  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString();
}

export function normalizeOrigin(rawOrigin) {
  const url = new URL(String(rawOrigin ?? ""));
  if (!/^https?:$/.test(url.protocol)) throw new Error("仅支持 http/https 站点自动翻译。");
  return `${url.protocol}//${url.hostname}`;
}

export function getOriginMatchPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function isRouteLikeHash(hash) {
  return /^#(?:!\/|\/)/.test(hash ?? "");
}
