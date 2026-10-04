import { defineContentScript } from "wxt/utils/define-content-script";
import "../src/entries/content.js";
import "../content.css";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  cssInjectionMode: "manifest",
  noScriptStartedPostMessage: true,
  main() {}
});
