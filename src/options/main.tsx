import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readLegacyMarkup } from "./LegacyIslands";

const root = document.getElementById("root");
if (!root) throw new Error("Missing Options root");
const markup = readLegacyMarkup();
createRoot(root).render(<StrictMode><App markup={markup} /></StrictMode>);
