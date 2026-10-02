# TranslateFlow Architecture

## Dependency direction

```text
UI (popup/options)
        |
        v
shared contracts / config + glossary normalization
        |
        +--------------------------+
        |                          |
        v                          v
content scripts -> messages -> background router
                                |
                                v
                    getEffectiveConfig(pageUrl)
                    + effective glossary
                         /      |       \
                        v       v        v
                     cache   providers  auto-sites
```

## Hard boundaries

1. `src/shared/` 是纯合同/纯函数层，不访问 `chrome.*` 或 `browser.*`，也不能通过间接依赖引入它们。
2. 外部 HTTP 只能位于 `src/background/providers/`。
3. 翻译缓存 IndexedDB 仅由 `src/background/cache-db.js` 直接访问；独立 ReadingRecord 数据库仅由 `src/background/reading-record/idb.js` 直接访问。其它 Reading 后台模块调用唯一 adapter，Content 与扩展 UI 只能走后台 v2 消息，不能直接或间接引入 adapter。两库不互相迁移或清空；词典 OPFS 独立。
4. 动态 Content Script 注册只能位于 `src/background/auto-sites.js`。
5. `background.js` 和 `content.js` 保持组合入口，不承载业务功能。
6. Runtime message value 必须集中定义。
7. 权限属于公共 API，不能在普通重构中扩大。
8. API 调用和缓存读写必须基于同一个 Effective Translation Config。
9. YouTube MAIN-world code may observe only the page player's own timedtext response; it must not refetch signed caption URLs or expose privileged extension operations through `window.postMessage`.
10. Lexical content follows **Source-driven data → Rule-driven retrieval → Context-driven ranking → User-driven AI**. Project-authored word/translation rows and query-specific sense hacks are not a long-term coverage mechanism.
11. Production extension packaging is allowlist-based. Build inputs, source locks, tests, E2E fixtures and benchmark assets stay outside the installed extension.

## Configuration

全局配置位于 `chrome.storage.local`。

`uiLocale` (`auto` / `en` / `zh_CN`) is independent of translation targets and dictionary languages. The pure `src/i18n/` catalog, resolver and typed text/Intl API have no browser or storage access, including transitive dependencies. Options owns its existing storage adapter; it writes only this preference. UI locale does not enter Provider payloads, prompts or cache fingerprints. Controlled catalog projection generates the two allowlisted Manifest message files; browser-selected Manifest language and user-selected UI language remain separate. See [UI_LOCALE.md](./UI_LOCALE.md).

`resolveTranslationConfig()` 负责把：

- 默认 Provider
- Provider credentials
- 默认 Prompt
- Target Language
- Site Profile

解析成一次翻译真正使用的配置。

站点 Profile 只覆盖 Provider / Model / Prompt / Target Language，不复制 API Key。

## Background

- `config.js`: 持久配置 + effective config
- `providers/`: 网络 Provider adapter；统一接收 AbortSignal，并由 shared 层负责 timeout/retry
- `translation-requests.js`: requestId / in-flight coalescing / background AbortController
- `cache-db.js`: cache identity / IndexedDB / LRU
- `auto-sites.js`: optional site permission + persistent script registration
- `router.js`: message dispatch
- `index.js`: service-worker lifecycle

## Lexical data ownership and package boundary

TranslateFlow owns the lexical **engine**, not the ongoing authorship of dictionary content.

- dictionary facts should come from attributable source pipelines;
- generic normalization/morphology/phrase/ranking algorithms belong in runtime code;
- validation words belong in test/benchmark fixtures;
- a local no-hit remains an honest no-hit until a real dictionary source or explicit user-triggered Provider action supplies more information;
- AI output is never silently promoted into authoritative local dictionary data;
- large dictionaries should be downloadable/imported rather than increasing the base extension artifact.

The current project-authored reviewed technical terms are a transitional compatibility layer after #115, not a source to keep expanding for coverage. See [LEXICAL_DATA_BOUNDARIES.md](./LEXICAL_DATA_BOUNDARIES.md).

Production builds are created from an explicit allowlist into `dist/extension`. The repository may contain large source/validation corpora without those bytes becoming user installation cost.

### Approved opt-in WXT build

`build:extension:wxt` creates a separate production package at `.output/chrome-mv3/`. `entrypoints/background.ts` statically imports the existing `initializeBackground()` and synchronously registers listeners in `main`; WXT build-time imports have no substitute Chrome/window globals. The root `popup.html` and `options.html` remain the unique UI source, registered through the WXT entrypoint hook and compiled by Vite. Their installed identities and full-tab `options_page` semantics stay unchanged.

`src/shared/runtime-assets.js` provides stable Worker, MAIN, page and bundled-dictionary paths to runtime callers and build/tests. `scripts/wxt-assets.mjs` derives the raw bridge from the current ordered Content lists plus mapped MAIN/Worker roots and their relative-import closure. Only those individual files and authenticated generated pack descriptors enter WXT public assets; the whole `src` tree is never copied. Generated source locks and corpora stay outside both packages. Bridge removal belongs to the authorized legacy migration slice, not an ad hoc rewrite here.

Content remains classic-script code; MAIN and Workers retain their existing loading contexts and source bytes. `auto-sites.js` remains the sole dynamic registration owner. React is reserved for the future learning-center extension page; it is absent from this compatibility build. The new compiled JS/CSS explicitly targets Chrome 102, without a polyfill or a claim that Chrome 102 runtime has been tested. Provider, cache/OPFS, privacy and permission boundaries above remain unchanged. See [WXT_COMPAT_V1.md](./WXT_COMPAT_V1.md) for actual commands, asset audit and limited smoke evidence.

### Approved type and test tooling

TypeScript checks every new `src/**/*.ts(x)`, `entrypoints/**/*.ts(x)`, unit test/config and owned declaration under strict mode with `skipLibCheck:false`; legacy JS is not converted wholesale. Test discovery is disjoint: Node `tests/*.test.mjs`, Vitest `tests/unit/**/*.test.ts(x)`, Playwright `e2e/**/*.spec.mjs`. The only DOM environment is test-only jsdom; React interaction fixtures and all test libraries remain outside both production packages.

`scripts/check.mjs` parses all actual JS/MJS/CJS/TS/TSX/JSX sources and walks runtime import/export/dynamic-import dependencies. React/JSX is allowed only under `entrypoints/learning-center/` and `src/learning-center/`; each non-UI source's transitive closure must remain React-free. Unregistered runtime packages, unresolvable/computed imports and runtime imports of tests/build sources fail. Declaration files are parsed and strictly typechecked but never enter the runtime graph; runtime edges into them fail. Complete `import type`/`export type` edges are erased, while inline type specifiers retain runtime edges under the actual verbatim compiler configuration. API ownership checks also cover TS and bounded aliases/computed API access. The single reviewed YouTube MAIN observer is pinned by an unconditional fixed SHA256 of its complete LF source, so container or mutable fetch delegation cannot widen its exception. Its exact path is fixed to LF by `.gitattributes` for fresh checkouts. Existing worktrees can retain Git-converted CRLF after an attribute-only upgrade, so the checker canonicalizes only CRLF to LF for this hash; standalone CR and all other source differences still fail. It does not rewrite the working file. Any other byte change requires authorized implementation, real subtitle regression and independent review before the coordinator updates that fixed value; this does not claim general JavaScript taint safety. The engineering migration itself grants no storage exception. The separately authorized ReadingRecord adapter is the second exact IndexedDB owner in Hard boundaries; frontend runtime dependency chains into it are rejected.

The type-only WXT aliases and unused generated `import.meta` environment limitation are recorded in [TYPES_TESTS_V1.md](./TYPES_TESTS_V1.md). They do not install browser globals or replace runtime validation/authorization. Reading DTOs remain owned by the existing `src/shared/reading/` validators; consumers begin with unknown input and must validate before narrowing.

## Lexical Gateway

Selection lexical lookup is a separate local-only Background boundary:

```text
Content/Selection (later #79)
  -> LEXICAL_LOOKUP
  -> background/lexical/gateway.js
       -> effective User Glossary override
       -> bundled/active TFLex readers
       -> attributable candidates
```

`background/lexical/tflex-reader.js` performs bounded shard reads and byte-accounted LRU caching; it does not use IndexedDB or Provider APIs. `background/lexical/package-assets.js` is the narrowly scoped exception to the source-level `fetch` rule: it reads only extension-package URLs produced by `chrome.runtime.getURL`, never external HTTP origins. Local lexical results do not enter translation cache.

## Content

Content Script 继续保持 build-free classic script modules：

1. runtime
2. tasks
3. dom
4. batch
5. processor
6. auto
7. selection modules
8. bootstrap

`processor.js` 会把 pageUrl 同时传给缓存和翻译请求，因此 Background 可以为当前站点解析同一份有效配置。

### YouTube acquisition boundary

```text
Background youtube-bridge.js
  -> chrome.scripting.executeScript({ world: "MAIN", files: [...] })
        |
        v
MAIN youtube-main-bridge.js
  player/private metadata + fetch/XHR response observation
  + pure youtube-timedtext parser
        |
        | versioned validated window.postMessage
        v
ISOLATED sources/youtube.js
  source arbitration + active-cue scheduling + visual suppression
        |
        v
existing #25 subtitle pipeline -> Background Provider/cache
```

The bridge owns a monotonic `videoId + generation` identity. The isolated source independently rejects mismatched envelopes before ingestion. The fallback order is current-generation MAIN timedtext, real active HTML TextTrack cues, then rendered YouTube caption DOM. The player-local renderer remains responsible for bilingual/original/off presentation.

## Migration-sensitive boundaries

以下变化必须视为数据/协议迁移：

- IndexedDB DB version/name
- object-store/index schema
- cache schema
- URL normalization
- text normalization
- provider identity
- Provider endpoint 是否参与 cache fingerprint
- Runtime message value
- site profile storage shape


## Translation task lifecycle

用户主动翻译与自动增量翻译共享统一任务状态：

```text
queued
→ cache_lookup
→ translating
→ storing
→ completed

failed / cancelled
```

职责分层：

- `src/content/tasks.js`: 页面侧状态、进度、取消意图；
- `src/background/translation-requests.js`: requestId、in-flight coalescing、后台 AbortController；
- `src/background/providers/shared.js`: 网络 timeout、429/5xx/network retry、Retry-After；
- Provider adapter: 请求体和 Provider 特有协议；
- Popup/Selection: 只展示任务状态，不实现自己的 retry/backoff 算法。

取消后 content 层会在写缓存前再次检查任务状态，因此被取消的 Provider 结果不会写入 IndexedDB。


## Structured inline translation

Page translation encodes supported inline elements (a, strong/b, em/i, code, kbd, mark) into TranslateFlow-controlled markers before the Provider request. Provider adapters remain format-agnostic; the request coordinator adds the marker-preservation protocol only when structured markers are present. Rendering never uses model-produced HTML or innerHTML: it rebuilds DOM from a fixed tag whitelist and preserves only the original safe link href/title attributes. code/kbd text is restored from the original DOM.

Plain paragraphs retain their existing normalized source identity. Rich paragraphs use the deterministic marker-encoded source as their segment identity, so only those paragraphs can incur a one-time cache miss; the IndexedDB schema and global cache schema version remain unchanged.


## Glossary boundary

术语表属于 Effective Translation Config 的组成部分，但 Provider adapter 不直接读取术语存储。

```text
chrome.storage.local
  ├─ glossary { version, entries }
  └─ siteGlossaries { version, sites }
            |
            v
normalize + resolveEffectiveGlossary(pageUrl)
            |
            +--> composeGlossaryPrompt()
            |
            +--> glossaryIdentity -> cache fingerprint
```

规则：

- 空有效术语表保持原有 Prompt 和 cache identity；
- 站点术语只在匹配 Origin 时参与解析；
- 同 effective key 的站点术语覆盖全局术语；
- 设置页只操作 versioned normalized store；
- glossary UI 位于 `src/options/glossary-ui.js`，Provider/cache/content 不依赖 Options DOM。


## Preset resolution boundary

Preset 定义位于 `src/shared/presets.js`，只描述翻译风格，不包含 Provider、凭据或模型配置。

```text
Site Profile preset ─────┐
                         ├─> resolveTranslationConfig()
storage.session override ┘          |
                                    v
                      resolved prompt/style
                                    |
Glossary ----------------------------+
                                    |
                                    v
                           Provider + Cache
```

临时 Preset 存在 `chrome.storage.session`，由 `src/background/preset-session.js` 管理；Content Script 不直接读取 session storage。Popup 通过 Background message 设置临时模式，并触发当前页重新翻译。

优先级：

1. Site Profile 显式 Prompt；
2. session 临时 Preset 或 Site Profile 保存的 Preset；
3. 全局 Prompt；
4. 项目默认 Prompt。

Preset 不单独进入 cache fingerprint，最终解析 Prompt 才是缓存行为的一部分，因此恢复相同有效配置会恢复相同缓存版本。


## v0.8 UI / access surfaces

Extension-owned controls share the sage/beige design system and Shadow DOM foundation under `src/content/ui/`. Page translations remain in the real page DOM. Quick Control reuses the page task lifecycle, while YouTube uses the separate SubtitleSource → subtitle pipeline → player-local renderer path.

Chrome Commands are routed through Background and reuse existing Content messages. First-use invocation uses `activeTab` + `scripting`; it does not add a broad required Host Permission.

Settings remains native HTML/CSS/JS and reuses existing storage contracts. Automatic cache restore is an explicit per-site mode: cache hits restore from IndexedDB and cache misses do not fall through to Provider translation.
