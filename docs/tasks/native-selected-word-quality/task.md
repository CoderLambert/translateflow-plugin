# Native selected-word quality follow-up

## Scope
Based on main at 7cc6002fb575ccbd2e11044defcb88de6be4b62c. Retain the current production rule: Chrome built-in translation is only permitted for eligible selected words. Do not activate local models for webpages, subtitles, or longer text.

Implement exactly three improvements:
1. Reuse the existing non-sensitive selection source projection as a short LanguageDetector sample, without sending surrounding context to the Translator, AI Provider, or translation cache.
2. Replace immediate model capacity errors with abortable, deadline-bounded waiting (30 seconds) and preserve per-request cancellation and native resource cleanup.
3. After creation/first use of a Translator pair, perform a real non-empty translation self-check and expose verification status; failure invalidates the instance and allows an explicit retry.

Keep the existing ISOLATED Content runtime, WXT entry, message protocol, language pair cache identity, dictionaries, Reading records, permissions, and database intact. No Offscreen or external model downloads.

## Automated acceptance
Targeted Node tests for context extraction/privacy, resource queue fairness/cancellation, real test translation and failure/retry, plus JS syntax checks. Do not run browser E2E or human product acceptance in this coding round.

## User acceptance
Open an HTTPS reading page in Chrome. Select an ambiguous word with English/French/German sentence context; verify language recognition follows the sentence. Trigger two active language pairs and then another pair if practical; no immediate busy error. Prepare a new pair and confirm the verification phase appears and a definition is eventually returned. Confirm other content (page, subtitle and longer selection) still requires AI.
