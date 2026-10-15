# Browser native language detection and translation

## Frozen scope

Base: `CoderLambert/translateflow-plugin@0ebd54fa9397ce76cf3d1bfe217522cc13f36550`.
Reference: `FluentRead/FluentRead@fa431a8459f3c1ddcd0c274d6c027cb8223b16c2`, `src/app/offscreen/translation.ts` and `src/features/settings/model/chromeTranslationPreparation.ts`.

User requested a working migration of FluentRead's automatic language selection and reliable local-model interaction, not another feasibility investigation. This is an independently written adaptation of the workflow, not a source-copy or a replacement of TranslateFlow's runtime with FluentRead's application.

Retain ISOLATED Content execution, AI priority, explicit cloud-to-native fallback, existing cache schema, protected formatting, dictionaries and Reading storage. No Offscreen/MAIN bridge, new permissions, model downloads during tests, E2E or product acceptance. Product acceptance belongs to the user.

## Changed behavior

- Native LanguageDetector is the main language evidence. Use the reference's 0.4 confidence floor, validate finite scores and reject near-ties within 0.1 rather than choosing a guessed winner. No short-word length penalty.
- The site's UI language is not a source-language decision. Script-only fallback accepts conservative Kana/Hangul evidence; generic Latin/Cyrillic/Han does not identify a language.
- Refine Chinese script only after Chinese is detected. Shared or mixed evidence stays uncertain. Explicit settings/corrections remain authoritative.
- Detect each paragraph/selection independently. Group a batch by actual source language and create a separate existing background cache snapshot per language. Re-evaluate later native page batches instead of freezing the first batch's language.
- First-use detector preparation is the primary action. Detection success continues automatically; manual correction is a secondary control used for uncertain results. Once a language pair is available, warm/reuse it without another confirmation.
- Keep one detector and at most two translator pairs per document. Share creation, serialize use, separate request cancellation from instance lifetime, evict idle pairs after two minutes, and retire non-responsive cancelled instances.
- Skip known target-language paragraphs/selections without generating or persisting a duplicate translation.
- Refresh a lost native cache snapshot once, preserving and checking its source/target. A missing local plan never falls through to an AI Provider. Cancellation invalidates both in-flight operations and the following cache-store step.

## Interfaces

`src/shared/browser-language.js`: `chooseDetectedLanguage`, `explicitSource`, `scriptLanguage`, `refineChinese`, `translationParts`, `detectionSample`.

`browserTranslation`: preserve `capability`, `prepare`, `prepareDetector`, `detect`, `execute`, `ready`, `dispose`, `dispatch`, `error`; add `detectorCapability` and `detectDecision`.

`translationClient.send` keeps the existing external message names. `browser-plan:*` IDs are Content-local fan-out plans; each child uses a real background `configSnapshotId`. They must never be sent to Background as real snapshot IDs. AI snapshots remain unchanged.

## Deliberately not included

No full statistical language library, automatic cloud fallback, commercial translator, cross-browser port, new AI Provider, new database or unrelated UI redesign. Paragraph-level language detection does not claim perfect sentence-internal code-switching. Chrome origin/Permissions Policy and initial activation requirements remain visible constraints; the UI does not promise globally installed packs always appear available.
