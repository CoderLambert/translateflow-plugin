import { parseSafeSvg, validateSafeSvgScene, extractSafeSvg, SAFE_SVG_LIMITS } from "../shared/safe-svg.js";
const app = globalThis.__TRANSLATE_FLOW_CONTENT__;
if (app && !app.modules.safeSvg) app.modules.safeSvg = Object.freeze({ parseSafeSvg, validateSafeSvgScene, extractSafeSvg, limits: SAFE_SVG_LIMITS });
