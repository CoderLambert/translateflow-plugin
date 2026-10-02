import type { en } from "./catalog.js";

export type UiLocale = "auto" | "en" | "zh_CN";
export type Locale = Exclude<UiLocale, "auto">;
export type MessageKey = keyof typeof en;
type Placeholders<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;
export type MessageArguments = {
  [K in MessageKey as Placeholders<(typeof en)[K]> extends never ? never : K]:
    Record<Placeholders<(typeof en)[K]>, string | number>;
};
export type Translate = <K extends MessageKey>(
  key: K,
  ...args: K extends keyof MessageArguments ? [MessageArguments[K]] : []
) => string;
export interface I18n {
  readonly locale: Locale;
  readonly t: Translate;
  formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions): string;
  formatDateTime(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
}
export interface I18nDiagnostic {
  code: "missing-key" | "english-fallback" | "invalid-arguments";
  key: string;
}
export function normalizeUiLocale(value: unknown): UiLocale;
export function resolveLocale(uiLocale: unknown, browserLocale: unknown): Locale;
export function createI18n(options?: {
  uiLocale?: unknown;
  browserLocale?: unknown;
  onDiagnostic?: (diagnostic: I18nDiagnostic) => void;
}): I18n;
export function messageParameters(template: string): string[];
export function validateCatalogs(candidate?: Record<Locale, Record<string, string>>): number;
export function getManifestMessages(locale: Locale): Record<string, { message: string }>;
