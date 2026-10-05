import { LOCAL_DICTIONARY_MAX_PACKAGE_SOURCE_BYTES } from "../../shared/local-dictionary-limits.js";

export function isRichMddPackageWithinBudget(mdxSourceBytes, attachmentSourceBytes) {
  return Number.isSafeInteger(mdxSourceBytes) && mdxSourceBytes >= 0 &&
    Number.isSafeInteger(attachmentSourceBytes) && attachmentSourceBytes >= 0 &&
    mdxSourceBytes + attachmentSourceBytes <= LOCAL_DICTIONARY_MAX_PACKAGE_SOURCE_BYTES;
}

export function richMddAttachmentSourceBytes(snapshot) {
  if (!Array.isArray(snapshot?.sources)) return Number.POSITIVE_INFINITY;
  const sourceBytes = snapshot.sources.reduce((sum, item) => sum + Number(item?.sourceSize || 0), 0);
  const sidecarBytes = Array.isArray(snapshot.sidecars)
    ? snapshot.sidecars.reduce((sum, item) => sum + Number(item?.sourceSize || 0), 0)
    : 0;
  return sourceBytes + sidecarBytes;
}
