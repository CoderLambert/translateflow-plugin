import { useEffect } from "react";
import { mountLegacyOptionsIslands } from "./legacy-islands";

export type LegacyMarkup = { glossary: string; dictionaries: string };

export function readLegacyMarkup(): LegacyMarkup {
  const template = document.getElementById("legacy-options-source");
  if (!(template instanceof HTMLTemplateElement)) throw new Error("Missing legacy Options template");
  const section = (selector: string) => template.content.querySelector(selector)?.innerHTML || "";
  const markup = { glossary: section("#glossary"), dictionaries: section("#dictionary-packs") };
  template.remove();
  if (!markup.glossary || !markup.dictionaries) throw new Error("Incomplete legacy Options islands");
  return markup;
}

export function LegacyIslands({ markup, setStatus }: { markup: LegacyMarkup; setStatus: (message: string, error?: boolean) => void }) {
  useEffect(() => mountLegacyOptionsIslands(setStatus), [setStatus]);
  return <>
    <section id="glossary" className="legacy-options-island" data-island="glossary" tabIndex={-1} dangerouslySetInnerHTML={{ __html: markup.glossary }} />
    <section id="dictionary-packs" className="legacy-options-island" data-island="dictionary-packs" tabIndex={-1} dangerouslySetInnerHTML={{ __html: markup.dictionaries }} />
  </>;
}
