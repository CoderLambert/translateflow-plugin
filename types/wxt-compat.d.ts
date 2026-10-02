import type { Browser } from "@wxt-dev/browser";

// WXT 0.21.4's generated I18n.Static reference and Browser 0.3.4's
// typeof chrome global reference use older names for this same SDK shape.
// Type-only aliases: no second Chrome SDK and no runtime shim or globals.
declare global {
  const chrome: typeof Browser;
  namespace I18n {
    // WXT specializes getMessage with generated message-key overloads.
    // Its WxtBrowser type already omits the SDK getMessage before composing it.
    type Static = Omit<typeof Browser.i18n, "getMessage">;
  }
}
