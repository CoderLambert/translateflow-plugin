# Dictionary Library vNext certification

This gate integrates the pinned real-corpus, curated-install, independent MDD, multi-dictionary, security, package-boundary, and product-browser evidence for the vNext dictionary library. Its workflow is `dictionary-library-vnext-certification`. It runs on matching pull requests, pushes to `main`, and manual dispatch. Every report is generated in that workflow run; the gate does not infer a pass from a separate workflow having run at some earlier time.

## Evidence and identities

| Gate | Fresh evidence and required result |
| --- | --- |
| Pinned ECDICT parser and exact range I/O | `ecdict-corpus-parser-report.json` must match [the ECDICT 1.0.28 corpus lock](../lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json): ZIP 97,755,340 bytes, SHA-256 `b06a72a0cfc37485a0466ee62fb43137559ea75eea147d8b7715142faca2229`; MDX 97,786,525 bytes, SHA-256 `275e71b58fd359bfe649af1cbee533ea81770bdbc53ec4a34567f84720a5751b`; 3,402,564 entries, 2,506 key blocks, and 3,768 record blocks. The parser check freezes 2,512 index reads totaling 27,504,767 bytes with a largest range of 61,253 bytes. It also checks seven independently decoded lookups. Each reads one key block and one record block in two ranges; source bytes are `run` 33,515, `state` 30,189, `process` 27,683, `issue` 33,104, `branch` 28,650, `container` 27,325, and `cache` 30,659. Compact index JSON must stay under 2 MiB, and measured parser RSS growth must stay under 128 MiB. The published summary contains these metrics and timings, but no dictionary definitions. |
| Curated install and local rich viewer | `ecdict-real-corpus-report.json` must report the same pinned archive/MDX identity, all seven expected records, local structured primary result, rich viewer ShadowRoot, zero Provider calls, and successful deletion. `ecdict-one-click-real-archive-report.json` must record the exact permission pair `https://github.com/*` and `https://release-assets.githubusercontent.com/*`, successful install and reinstall, failure/cancel preservation, offline lookup, zero Provider calls, and deletion. |
| Independent MDD interoperability and safe resources | `mdd-interop-certification.json` must regenerate the tiny fixture with MIT-licensed `zhansliu/writemdict` commit `f0240b30cabd2f0470d3ee1a0641fc7f8c38dcf5` and verify source, license, and fixture hashes. The checked-in synthetic pair is `interop.mdx` (1,194 bytes, SHA-256 `b8996c8cd7449e67a5049ba0cd284fb1528385ff090c82af4113c67e050a8a82`) and `interop.mdd` (1,723 bytes, SHA-256 `98adc93097939119d72d5d0257027099ab25d421b9df43d10867e29cc24fe4f5`). It must also pass the separate deterministic 100 MiB-class MDD range case: 104,857,676 uncompressed payload bytes, range-index construction reads no record bodies, and the 76-byte probe reads only its one needed record block. This synthetic range corpus is explicitly not a real dictionary. `mdd-resources-e2e-report.json` must confirm resource hashes and MIME, persistence after Settings reload, corrupt-replacement rollback, user-triggered audio playback, dark 320px layout without horizontal overflow, zero external requests/Provider calls, object URL cleanup, and delete. |
| Settings, personal Rich preference, disable, delete, and structured-primary stability | `playwright-vnext-report.json` must contain each required case exactly once with an expected passing status and only successful attempts. This includes the `multi-dictionary-viewer.spec.mjs` cases for saved personal preference/order and expanded defaults after reload, disabling a dictionary while retaining its installed bytes, and isolating one corrupt card. It also includes `settings-ia.spec.mjs` trust labels/narrow-width case and the new integrated `dictionary-library-vnext-product.spec.mjs` case. `dictionary-library-vnext-product-report.json` records the two local dictionary IDs and trust labels, saved order, disabled-file byte counts, dictionary-scoped MDD request, unchanged structured primary candidate IDs, post-delete zero source bytes, cleared preferences/object URLs, and zero Provider/remote calls. |
| Viewer safety, theme, keyboard, and narrow layout | `rich-viewer-security-report.json` must identify the bounded hostile MDX fixture and report zero active elements, zero script execution, zero external requests, and zero Provider calls. It also checks the safe local image/audio placeholders, distinct light/dark colors, dark 360px viewport bounds, a keyboard-focusable viewer, Escape dismissal, and the reviewed compact headword/pronunciation/note hierarchy. The corresponding Playwright case is required and cannot be skipped or retried. |
| Production package boundary | The certifier builds the extension using `scripts/build-extension.mjs` with the generated Core and Technical packs. It scans the actual file inventory and fails if it finds an `.mdx`, `.mdd`, or `.zip`, a validation-only path, missing Core/Technical assets, unexpected host permissions, or a package at least as large as the pinned MDX. The production manifest must retain only its reviewed Provider host permission. |
| Lexical primary lane | The integrated product report and required multi-dictionary case must show the structured result still routes locally and retains the same top candidate and candidate set while rich details load. The quantitative source-derived lexical regression remains the `lexicon-release` workflow; its exact-head benchmark and release evidence continue to run independently. |

The Playwright JSON must include outcome counts with zero skips, unexpected results, and flaky tests. Each required test must have an expected `passed` result and no failed, skipped, or retried attempt. The vNext product spec is checked in full, including every case it reports. Missing or malformed report files, wrong corpus IDs/hashes/counts, missing lookup I/O metrics, unsafe resource observations, package drift, and absent E2E cases all produce `FAIL`.

## Run locally

The workflow first prepares the locked Core and Technical packs and installs Chromium. Then it downloads the pinned archive to a cache directory separate from the evidence directory, measures the parser, regenerates the MDD interoperability fixture from the locked independent writer, and runs the focused product specs. The same commands can be run locally:

```sh
npm run setup:lexicon
npm run validate
git clone https://github.com/zhansliu/writemdict.git /tmp/writemdict
git -C /tmp/writemdict checkout f0240b30cabd2f0470d3ee1a0641fc7f8c38dcf5
mkdir -p /tmp/translateflow-vnext/cache /tmp/translateflow-vnext/evidence-private /tmp/translateflow-vnext/evidence-published /tmp/translateflow-vnext/mdd-work
RICH_MDICT_CACHE_DIR=/tmp/translateflow-vnext/cache \
RICH_MDICT_EVIDENCE_DIR=/tmp/translateflow-vnext/evidence-private \
node scripts/certify-rich-mdict-corpus.mjs
MDD_INTEROP_EVIDENCE_DIR=/tmp/translateflow-vnext/mdd-work \
node scripts/certify-mdd-interop.mjs \
  --writer-checkout /tmp/writemdict --regenerate \
  --large-range-evidence --bulk-bytes 104857600 \
  --out /tmp/translateflow-vnext/evidence-private/mdd-interop-certification.json
```

After installing Chromium, run the workflow's focused Playwright file list with these environment values:

```sh
RICH_MDICT_CACHE_DIR=/tmp/translateflow-vnext/cache \
RICH_MDICT_REAL_MDX='/tmp/translateflow-vnext/cache/简明英汉字典增强版.mdx' \
RICH_MDICT_EVIDENCE_DIR=/tmp/translateflow-vnext/evidence-private \
MDD_INTEROP_EVIDENCE_DIR=/tmp/translateflow-vnext/evidence-private \
DICTIONARY_LIBRARY_VNEXT_EVIDENCE_DIR=/tmp/translateflow-vnext/evidence-private \
ECDICT_MDX_ONE_CLICK_GATE=1 \
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/translateflow-vnext/evidence-private/playwright-vnext-report.json \
npx playwright test \
  e2e/rich-mdict-real-corpus.spec.mjs \
  e2e/rich-mdict-product.spec.mjs \
  e2e/mdd-resources.spec.mjs \
  e2e/multi-dictionary-viewer.spec.mjs \
  e2e/settings-ia.spec.mjs \
  e2e/rich-viewer-security.spec.mjs \
  e2e/dictionary-library-vnext-product.spec.mjs \
  --reporter=line,json
npm run certify:dictionary-library-vnext -- \
  --evidence-dir /tmp/translateflow-vnext/evidence-private \
  --out /tmp/translateflow-vnext/evidence-published/dictionary-library-vnext-certification.json
```

The aggregate writes `dictionary-library-vnext-certification.json` with schema version 1, report ID `dictionary-library-vnext-certification`, an overall `PASS`/`FAIL`, observed corpus and writer identities, bounded parser/resource measurements, product outcomes, and explicit failure strings. Detailed evidence filenames are fixed by the certifier: `ecdict-corpus-parser-report.json`, `ecdict-real-corpus-report.json`, `ecdict-one-click-real-archive-report.json`, `mdd-interop-certification.json`, `mdd-resources-e2e-report.json`, `rich-viewer-security-report.json`, `dictionary-library-vnext-product-report.json`, and `playwright-vnext-report.json`.

The raw ECDICT archive and extracted MDX live only in the separate cache directory. Detailed parser, browser, and Playwright reports stay in a private runner-temporary evidence directory. The real-corpus E2E report stores only whether each pinned record matched; it does not store definitions or record screenshots. Artifact upload publishes only the filtered `dictionary-library-vnext-certification.json` summary from a separate output directory. The workflow does not upload detailed reports, corpus cache, source archive, extracted MDX, browser profile, or temporary 100 MiB synthetic MDD file.
