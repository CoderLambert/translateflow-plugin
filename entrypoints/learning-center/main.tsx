import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/learning-center/App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing learning center root");
createRoot(root).render(<StrictMode><App /></StrictMode>);
