import pRetry, { AbortError } from "p-retry";
import { machineError, machineSupports } from "../../shared/machine-translation.js";
import { prioritizeMachineCandidates } from "./machine-translation-health.js";
import { translateMachineBatch } from "./machine-translation.js";

// Candidate selection is business policy. SingleFlight and cancellation stay in
// the existing coordinator; transport alone owns actual HTTP concurrency.
export async function translateMachineRoute(segments, config, { signal, onProgress, deadline = performance.now() + 25000 } = {}) {
  if (config.routing !== "auto") return translateMachineBatch(segments, config, { signal, deadline });
  const results = [];
  for (const segment of segments) {
    const candidates = prioritizeMachineCandidates(config.routeCandidates || []).filter(c => machineSupports(c.provider, c.sourceLanguage, c.targetLanguage)).slice(0, 5);
    if (!candidates.length) throw machineError("MT_LANGUAGE");
    try {
      const result = await pRetry(async attempt => {
        if (signal?.aborted) throw new AbortError(machineError("CANCELLED"));
        if (performance.now() >= deadline) throw new AbortError(machineError("MT_TIMEOUT"));
        const candidate = candidates[attempt - 1];
        onProgress?.({ type: "machine-route", providerId: candidate.provider, providerLabel: candidate.providerLabel, switching: attempt > 1 });
        try {
          const [output] = await translateMachineBatch([segment], candidate, { signal, deadline });
          return { ...output, providerId: candidate.provider, providerLabel: candidate.providerLabel };
        } catch (error) {
          if (["CANCELLED", "MT_INPUT", "MT_STRUCTURE", "MT_CONFIG"].includes(error?.code)) throw new AbortError(error);
          throw error;
        }
      }, { retries: candidates.length - 1, minTimeout: 0, maxTimeout: 0, randomize: false });
      results.push(result);
    } catch (error) {
      if (signal?.aborted || error?.code === "CANCELLED") throw machineError("CANCELLED");
      // Completed segments survive a later segment failure. Content already
      // leaves missing segments in their original form with an explicit retry.
      if (!results.length) throw error;
      break;
    }
  }
  return results;
}
