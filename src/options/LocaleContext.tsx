import { createContext, useContext } from "react";
import type { I18n } from "../i18n/index.js";

const LocaleContext = createContext<I18n | null>(null);
export const LocaleProvider = LocaleContext.Provider;
export function useOptionsI18n(): I18n {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("Options locale context is unavailable");
  return value;
}
