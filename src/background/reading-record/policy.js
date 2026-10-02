import { sha256 } from "../../shared/hash.js";
import { READING_ERROR as E, READING_LIMITS as L } from "../../shared/reading/constants.js";
import { fail, safeReturnUrl, text } from "../../shared/reading/validation.js";

const RETURN_QUERY_KEYS = new Set(["id", "page", "p", "article", "lang", "language", "chapter", "section", "v"]);
export async function derivePageIdentity(rawUrl) {
  text(rawUrl, L.urlChars, "sender.url");
  let url;
  try { url = new URL(rawUrl); } catch { fail(E.FORBIDDEN, "sender.url"); }
  if (!/^https?:$/u.test(url.protocol)) fail(E.FORBIDDEN, "sender.url");
  const canonical = new URL(url.href);
  canonical.username = ""; canonical.password = ""; canonical.searchParams.sort();
  const pageKey = `rp1:${await sha256(JSON.stringify(["rp1", canonical.origin, canonical.pathname, canonical.search, canonical.hash]))}`;
  let locator = null;
  try {
    safeReturnUrl(url.href, "locator");
    if ([...url.searchParams.keys()].every((key) => RETURN_QUERY_KEYS.has(key.toLowerCase()))) locator = url.href;
  } catch { /* A locator is optional; the authoritative digest retains meaningful query/hash. */ }
  return { pageKey, siteKey: url.origin, safeReturnUrl: locator };
}
// Deliberately finite conservative rules; this is not comprehensive private-content detection.
export function classifyPage(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return { sensitive: true, accountPage: true }; }
  const host = url.hostname.toLowerCase(), path = url.pathname.toLowerCase();
  const sensitive = /^(?:mail|webmail|chat|messages)\./u.test(host) ||
    ["mail.google.com", "outlook.live.com", "outlook.office.com", "teams.microsoft.com", "discord.com", "slack.com", "app.slack.com"].includes(host) ||
    /\/(?:mail|inbox|chat|messages|account|accounts|login|signin|settings|admin)(?:\/|$)/u.test(path);
  return { sensitive, accountPage: sensitive };
}
export function requireCaptureSafety(proof) {
  if (proof?.captureSafety?.selection !== "safe" || proof.captureSafety.context !== "safe" ||
      proof.captureSafety.root !== "light-dom") fail(E.FORBIDDEN, "captureSafety");
}
