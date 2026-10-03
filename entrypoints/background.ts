import { defineBackground } from "wxt/utils/define-background";
import { initializeBackground } from "../src/background/index.js";

export default defineBackground({
  type: "module",
  main() { initializeBackground(); }
});
