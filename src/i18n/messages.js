export function localizedMessage(key, args = {}) {
  return Object.freeze({ key, args: Object.freeze({ ...args }) });
}

export function renderLocalizedMessage(i18n, value) {
  if (typeof value === "string") return value;
  if (!value || typeof value.key !== "string") return "";
  return i18n.t(value.key, value.args || {});
}
