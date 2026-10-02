import { BACKGROUND_MESSAGES } from "../shared/constants.js";

export async function readInstalledDictionaryState(runtime) {
  const [richResult, packResult] = await Promise.allSettled([
    Promise.resolve().then(() => runtime.sendMessage({ type: BACKGROUND_MESSAGES.RICH_MDICT_LIST })),
    Promise.resolve().then(() => runtime.sendMessage({ type: BACKGROUND_MESSAGES.DICTIONARY_PACK_STATUS }))
  ]);
  const candidates = [];
  let rich = false;
  let packs = false;

  if (richResult.status === "fulfilled" && richResult.value?.ok !== false && Array.isArray(richResult.value?.dictionaries)) {
    rich = true;
    for (const dictionary of richResult.value.dictionaries) {
      if (!dictionary?.title) continue;
      candidates.push({
        name: dictionary.title,
        family: "mdict-rich",
        packId: dictionary.id,
        fileName: dictionary.fileName,
        sourceFiles: dictionary.fileName ? [dictionary.fileName] : [],
        sourceSize: dictionary.sourceSize,
        version: dictionary.packVersion
      });
    }
  }

  const packState = packResult.status === "fulfilled" && packResult.value?.ok !== false ? packResult.value?.state?.packs : null;
  if (packState && typeof packState === "object" && !Array.isArray(packState)) {
    packs = true;
    for (const [packId, entry] of Object.entries(packState)) {
      if (!entry?.active) continue;
      const name = String(entry.display?.name || packId);
      const format = entry.display?.format || "";
      candidates.push({
        name,
        family: format || "tflex",
        packId,
        version: entry.active.packVersion,
        sourceFiles: format === "tflex" ? ["manifest.json", "index.dat", "entries.dat"] : [],
        sourceSize: entry.active.totalBytes,
        format: entry.display?.formatLabel
      });
    }
  }

  return { candidates, known: { rich, packs } };
}

export function isInstalledStateKnownForFamily(family, known) {
  if (!family) return false;
  return family === "mdict-rich" ? known?.rich === true : known?.packs === true;
}
