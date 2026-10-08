# Selection Vocabulary Book v1

## Goal

Continue the merged Selection Dictionary UX with an explicit save action, a local vocabulary book, and a small review queue. Keep the completed Reading history and source markers as separate existing features.

## Scope

- Let a user explicitly add the current successful local dictionary result from the Selection card.
- Show saved words and a due review card in the existing Learning Center page.
- Provide a minimal review choice: “Still learning” schedules the word again in 15 minutes; “Know it” schedules 1, 3, 7, then 14 days after successive successful reviews.
- Persist only a bounded plain-text lexical snapshot and review state in `chrome.storage.local`; do not store page URL, selection context, page title, raw rich-dictionary markup, credentials, or AI output.
- Keep wordbook data independently removable and independent of Reading consent, records, history, export, and site markers. Do not modify the Reading database or its marker state.
- Preserve local-only lookup and explicit-only AI behavior. Saving, listing, and reviewing must make zero Provider requests.

## Limits and behavior

- A successful dictionary hit is required; no-hit and translation-only results cannot be added.
- De-duplicate by normalized headword and source/target language pair. A repeat save must be idempotent and may merge bounded source definitions and provenance without duplicating the word.
- Bound the collection to 200 entries and the serialized store to 4 MiB. Reject writes that exceed limits; never report “saved” before storage confirms.
- Render lexical content as text. Do not interpret dictionary markup or enable new permissions, network access, CSP relaxations, or AI calls.
- The initial review queue contains newly saved words. “Still learning” and “Know it” update only the wordbook review schedule. Deleting a word removes only that wordbook entry.
- The existing Reading return-to-source and marker paths remain unchanged; this task does not add a second anchor or history implementation.

## Ownership and validation

- Main owns the Selection action, local wordbook message/service, and Learning Center wordbook/review views.
- No current Selection PR owns this work. Existing Reading tasks #234–#236 are complete and their storage/marker paths are out of scope.
- Validate pure store/scheduling rules, source checks/types, the WXT extension package, and real Chromium/MV3 add → open wordbook → review → delete flows using synthetic data.
- Record browser/package evidence and limitations; do not claim Oxford/private-dictionary, real-AI, or OS-IME acceptance.
