import type { I18n, MessageKey } from "./index.js";

export type LocalizedMessage = string | Readonly<{
  key: MessageKey;
  args?: Readonly<Record<string, string | number>>;
}>;

export function localizedMessage(key: MessageKey, args?: Record<string, string | number>): LocalizedMessage;
export function renderLocalizedMessage(i18n: I18n, value: LocalizedMessage | null | undefined): string;
