import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReadingPreview } from "../../src/learning-center/ReadingPreview";

const root = document.getElementById("root");
if (!root) throw new Error("Missing reading preview root");
createRoot(root).render(<StrictMode><ReadingPreview /></StrictMode>);
