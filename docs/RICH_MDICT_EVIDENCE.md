# Rich MDict real-corpus evidence

TranslateFlow vNext keeps structured dictionaries in the lexical answer path and opens Rich MDict records as a separate local detail. The pinned ECDICT asset below is used to test import, persistent storage, exact lookup, safe rich rendering, safe text fallback, and removal. The raw dictionary is fetched by the dedicated gate and never enters Git or the extension package.

## Reviewed corpus

The corpus lock is [ecdict-mdx-1.0.28-corpus-lock.json](../lexicon/build-evidence/ecdict-mdx-1.0.28-corpus-lock.json). It freezes ECDICT release `1.0.28`, the single ZIP asset URL, archive layout, byte sizes, SHA-256 values, MDX title and format attributes, and independently decoded record excerpts.

The reviewed MDX is 97,786,525 bytes with 3,402,564 entries. It is MDX v2.0, UTF-8, `Encrypted=2` for key-info, `Compact=Yes`, `Compat=Yes`, and HTML records. Its 2,506 key blocks and 3,768 record blocks use zlib. The largest observed decompressed record block is 65,536 bytes. The reviewed corpus has four StyleSheet rules and no `@@@LINK` aliases or LZO blocks. These observations define this release gate's compatibility claims; they do not claim complete MDict support.

The upstream repository reports MIT, while the MDX description says “MIT / CC” without identifying a Creative Commons version. The gate retains the license evidence and uses the tag-specific upstream license URL. It downloads the dictionary only for local import testing and does not redistribute the asset.

## Run the compatibility gate

Run the corpus download, integrity check, range-index parse, and seven independent lookup checks with:

```sh
RICH_MDICT_CACHE_DIR=/tmp/translateflow-rich-mdict \
RICH_MDICT_EVIDENCE_DIR=/tmp/translateflow-rich-mdict/evidence \
node scripts/certify-rich-mdict-corpus.mjs
```

Then run the visible browser workflow with the extracted file from that cache:

```sh
RICH_MDICT_REAL_MDX='/tmp/translateflow-rich-mdict/简明英汉字典增强版.mdx' \
RICH_MDICT_EVIDENCE_DIR=/tmp/translateflow-rich-viewer-183 \
npx playwright test e2e/rich-mdict-product.spec.mjs e2e/rich-mdict-real-corpus.spec.mjs \
  e2e/rich-viewer-security.spec.mjs \
  --output=/tmp/translateflow-rich-viewer-183/playwright-results
```

The real-corpus Playwright spec intentionally skips when `RICH_MDICT_REAL_MDX` is unset. The dedicated `rich-mdict-compatibility` workflow supplies it, so ordinary test runs do not download the 98 MB asset. The isolated `--output` path keeps Playwright traces and results alongside the screenshots and report without writing to the repository's shared default output directory.

The browser gate imports through Settings, reloads, checks the installed count, runs exact lookups for `run`, `state`, `process`, `issue`, `branch`, `container`, and `cache`, and selects `run` on a page. It verifies the independent ECDICT excerpt appears in the isolated rich detail, the `Compact` markers render the reviewed headword/pronunciation/note hierarchy, and the structured `run` answer remains the primary result. It records zero Provider calls, deletes the dictionary, and confirms the lookup is empty after deletion. The same job runs a bounded hostile fixture through Selection and checks that unsafe active content, remote loads, and navigation remain inert while local image/audio references render only generic placeholders.

The parser report measures the actual source ranges read during index construction and each exact lookup, largest individual read range, compact index size, maximum decoded block sizes, parse/lookup latency, and sampled Node process RSS peak. The browser report records installation time, per-word lookup latency, returned records, and Provider calls. The workflow uploads only JSON reports and Settings/Selection/rich-viewer screenshots; it does not upload the MDX, ZIP, or browser profile. Local browser runs can keep these artifacts in `/tmp/translateflow-rich-viewer-183` by setting `RICH_MDICT_EVIDENCE_DIR` to that directory.

A local reference run on 2026-09-30 built a 1.15 MB JSON index in about 4.0 seconds. Index construction read 27.5 MB across 2,512 ranges, with a largest individual range of 61.3 KB. The largest decompressed key block was 32,769 bytes and the largest record block was 65,536 bytes. The seven representative exact lookups each read one key block and one record block: 27.3–33.5 KB compressed input and roughly 98.2 KB decoded across both blocks, in 3–7 ms. The Node parser process sampled at 176.6 MB RSS peak from a 96.9 MB baseline; this includes runtime, stream buffers, and parser state and is not a Chrome worker heap measurement. The dedicated gate reports its own measurements on each run.

One Chromium run installed the 97.8 MB MDX in 23.9 seconds and its seven post-reload exact lookups took 27–51 ms each. The captured report below records a separate run at 24.4 seconds and 26–61 ms. Every lookup returned its independently decoded record, and Selection displayed `run` beside the structured primary answer. Provider calls remained at zero before and after deletion. The generated test extension package was 37,818,639 bytes, and the gate checks it contains no `.mdx`, `.mdd`, or `.zip` file and is smaller than the source MDX. Browser lookup time includes message routing, OPFS reads, index verification/cache access, and decompression; it is not a pure parser benchmark. The browser report's parser metrics field is null because the current manager does not expose internal block metrics to the UI test; bounded range/decompression evidence comes from the separate direct parser certificate above.

Parser security tests live in [rich-mdict-security.test.mjs](../tests/rich-mdict-security.test.mjs); they cover an encrypted v2 fixture, StyleSheet metadata as inert data, HTML-to-text fallback, malformed offsets, corrupt compressed records, and alias loops. The pure sanitizer has separate bounded hostile-input tests in [rich-dictionary-sanitizer.test.mjs](../tests/rich-dictionary-sanitizer.test.mjs). Browser rendering security evidence lives in [rich-viewer-security.spec.mjs](../e2e/rich-viewer-security.spec.mjs), using the bounded fixture in [rich-viewer-security-fixture.mjs](../tests/helpers/rich-viewer-security-fixture.mjs). Its report and screenshots contain no raw corpus asset. The words used by the real and synthetic gates remain in test/evidence assets and do not become runtime vocabulary.

## Current support boundaries

Structured dictionaries remain the primary result; Rich MDict HTML renders in a separately scoped ShadowRoot after parsing into a bounded safe tree. Remote image/audio references are omitted, while local image/audio references produce inert placeholders for later MDD work. This evidence covers the pinned ECDICT v2.0 corpus and bounded hostile fixtures; it does not certify full MDict compatibility. MDict v1/v3, LZO, password-protected record decryption, MDD resolution, and unreviewed encodings remain outside this slice. The real corpus has no LZO blocks or aliases, so those features are not enabled by corpus evidence here.
