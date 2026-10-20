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
3. 通用翻译缓存 IndexedDB **仅由 `src/background/cache/storage-indexeddb.js` 直接访问**；`src/background/cache-db.js` 是稳定门面，`cache/application.js` 负责业务命名空间，`cache/service.js` 负责通用策略。ReadingRecord 独立数据库仅由 `src/background/reading-record/idb.js` 直接访问。源码检查器只允许这两个精确路径作为直接 IndexedDB owner。其它 Reading 后台模块调用其 adapter，Content 与扩展 UI 只能走后台 v2 消息；两库不得互相迁移或清空，词典 OPFS 独立。
4. 普通 `http/https` 页面的 Content Script 由生产 Manifest 静态声明；`src/background/auto-sites.js` 只维护按站点模式状态并清理旧动态注册。若未来恢复动态注册，其唯一所有者仍是该模块。
5. `background.js` 和 `content.js` 保持组合入口，不承载业务功能。
   `src/entries/content.js` 是唯一生产 Content 模块图；WXT 将有序 classic/IIFE owners 与 `src/entries/reading-contract.js` 的共享 Reading DTO adapter 编译为一个 ISOLATED IIFE。`scripts/reading-*-classic.mjs` 与 `src/content/reading-{source,contract,record}.js` 仅保留旧注册/Node 合同的可复现投影，不进入当前安装包。Content 编译闭包不引入 React 或动态 import；浏览器基础翻译仅在 ISOLATED Content 内调用 Translator / LanguageDetector，不增加 MAIN 桥或网络 Provider。
6. Runtime message value 必须集中定义。
7. 权限属于公共 API，不能在普通重构中扩大。
8. API 调用和缓存读写必须基于同一个 Effective Translation Config。
9. YouTube MAIN-world code may observe only the page player's own timedtext response; it must not refetch signed caption URLs or expose privileged extension operations through `window.postMessage`.
10. Lexical content follows **Source-driven data → Rule-driven retrieval → Context-driven ranking → User-driven AI**. Project-authored word/translation rows and query-specific sense hacks are not a long-term coverage mechanism.
11. Production extension packaging is allowlist-based. Build inputs, source locks, tests, E2E fixtures and benchmark assets stay outside the installed extension.

React is limited to the three extension-owned document surfaces: the fixed
`popup.html` action page, the fixed full-tab `options.html` page and the
unlisted `learning-center.html` page. Popup and Options use typed page clients
over the existing storage/runtime/content messages; they do not add a Provider,
cache, translation-task or Reading service. The Learning Center client consumes
the Reading repository only through its v2 message boundary. Safe return uses a
background-owned, worker-memory-only handoff bound to the new tab and controlled
Content document; the page never puts a record/token in the web URL. See
[Learning center v1](LEARNING_CENTER_V1.md) for navigation, consent, invalidation
and chunked download boundaries.

Options now owns Glossary and the complete dictionary-library control tree in
React. Popup, Options and Learning Center each have one document-level locale
hook; it performs the initial `uiLocale` read, listens for changes and removes
that listener on cleanup. Options is the only React document that writes the
preference. Rendering waits for the first read, while the pure `src/i18n/`
catalog remains free of browser and storage access. `src/options/glossary-client.ts`, `dictionary-client.ts` and
`local-dictionary-client.ts` are typed page clients: they preserve the existing
versioned glossary stores, runtime messages and import controllers instead of
creating a second parser, network, OPFS, quarantine, sanitizer or cancellation
state machine. Initial effects read current state only. File pickers, optional
origin permission prompts and install/update commits start from trusted user
actions; effect cleanup invalidates stale reads and disposes controller/Worker
owners under StrictMode.

## Configuration

全局配置位于 `chrome.storage.local`。

`uiLocale` (`auto` / `en` / `zh_CN`) is independent of translation targets and dictionary languages. The pure `src/i18n/` catalog, resolver and typed text/Intl API have no browser or storage access, including transitive dependencies. Each React document has one storage/listener owner; only the Options owner writes this preference, and only from an explicit change event. UI locale does not enter Provider payloads, prompts or cache fingerprints. Controlled catalog projection generates the two allowlisted Manifest message files; browser-selected Manifest language and user-selected UI language remain separate. See [UI_LOCALE.md](./UI_LOCALE.md).

`resolveTranslationConfig()` 负责把：

- 默认服务引用
- API Key 连接定义与 credentials
- 默认 Prompt
- Target Language
- Site Profile

解析成一次翻译真正使用的配置。

站点 Profile 只覆盖 `serviceRef` / Model / Prompt / Target Language，不复制 API Key。API Key 连接由 `providerConnections` + `providerCredentials` 表示；`chatgpt-plan` 保持独立服务引用。旧 Provider 配置会惰性迁移，但仍保留用于回滚。

Background 将本地存储访问限制为 trusted extension contexts。Content 不直接读取 `chrome.storage.local`；它通过 `PUBLIC_SETTINGS_GET` / `PUBLIC_SETTINGS_SET` 获取允许暴露的页面行为设置，并接收脱敏的 `PUBLIC_SETTINGS_CHANGED` 通知。Provider 连接列表只返回 `hasApiKey`。

页面翻译的第一次 cache lookup 会创建短生命周期 Effective Config snapshot；同一任务的 Provider 请求和 cache store 使用该 snapshot，避免设置中途变化造成缓存与请求身份不一致。

## Background

- `config.js`: 持久配置 + effective config
- `providers/`: 网络 Provider adapter；统一接收 AbortSignal，并由 shared 层负责 timeout/retry
- `translation-requests.js`: requestId / in-flight coalescing / background AbortController
- `cache-db.js`: stable cache API facade; no direct IndexedDB or translation identity rules
- `cache/application.js`: translate/subtitle/AI explanation namespaces and legacy-facing response contracts
- `cache/service.js`, `cache/storage-indexeddb.js`, `cache/storage-memory.js`: pure cache orchestration, sole IndexedDB owner, independent in-memory driver
- `../shared/cache/`, `../shared/translation-cache-identity.js`: one record envelope and provider-/format-aware request identity; domain strategy revision is separate from physical DB version
- `auto-sites.js`: serialized per-site auto/cache/Quick Control/Reading-marker intent state + obsolete dynamic-registration cleanup; a feature intent is not a permission grant
- `router.js`: message dispatch
- `index.js`: service-worker lifecycle

Selection assistant text streaming uses the dedicated `selection.assistant-stream` Port. It is bound to the actual top-frame Content sender/document (or the existing 32-hex fallback owner), accepts one start/requestId, and is aborted on stop, disconnect, navigation, tab removal or permission revocation. It reuses Provider permission/timeout/AbortController code; it is not `reading.invalidate`, a generic bus, or permission to persist partial text.

## Lexical data ownership and package boundary

TranslateFlow owns the lexical **engine**, not the ongoing authorship of dictionary content.

- dictionary facts should come from attributable source pipelines;
- generic normalization/morphology/phrase/ranking algorithms belong in runtime code;
- validation words belong in test/benchmark fixtures;
- a local no-hit remains an honest no-hit until a real dictionary source or explicit user-triggered Provider action supplies more information;
- AI output is never silently promoted into authoritative local dictionary data;
- large dictionaries should be downloadable/imported rather than increasing the base extension artifact.

The extension contains no dictionary content. Users explicitly download or import local dictionaries; fresh installs have a normal empty library. Query engines and content sources are independent. See [LEXICAL_DATA_BOUNDARIES.md](./LEXICAL_DATA_BOUNDARIES.md).

Production builds are created from an explicit allowlist into `dist/extension`. The repository may contain large source/validation corpora without those bytes becoming user installation cost.

### Default WXT build

`build:extension` and `build:extension:release` use the sole WXT production engine, audit the package before replacing the stable `dist/extension/` install directory, and preserve the existing `buildExtension()` report contract for certifiers. `build:extension:wxt` uses the same builder with `.output/chrome-mv3/` as its output. Each build uses isolated temporary staging so parallel certifiers cannot overwrite one another. `entrypoints/background.ts` statically imports the existing `initializeBackground()` and synchronously registers listeners in `main`; WXT build-time imports have no substitute Chrome/window globals. The root `popup.html` and `options.html` remain the unique UI source, registered through the WXT entrypoint hook and compiled by Vite. Their installed identities and full-tab `options_page` semantics stay unchanged.

`src/shared/runtime-assets.js` provides stable Worker, MAIN and page paths to runtime callers and build/tests. WXT owns the Content entrypoint and emits stable `content-scripts/content.js/.css`, used by both Manifest injection and Popup/Command recovery. `scripts/wxt-assets.mjs` now derives raw assets only from mapped MAIN/Worker roots and their relative-import closure; locale files are added separately. The whole `src` tree is never copied, and generated source locks/corpora stay outside both packages.

Content source owners remain classic/IIFE registry modules, compiled by WXT into one ISOLATED script; MAIN and Workers retain their existing loading contexts and raw source bytes. The production Manifest loads the compiled Content JS/CSS at `document_idle` on ordinary `http/https` pages, so Selection starts with the page. Reading first establishes a document-only controlled registration. One-shot handoff resolves one anchor; persistent page recognition additionally requires the independent site intent and fetches only the current page's bounded `PageSummaryItem` pages. Both reuse text-projection exclusions/budgets, render only in Shadow layers, and never wrap page DOM or call a Provider. Recognition draws a pointer-transparent highlight for each unique verified Range. Pointer hit-testing on the underlying word opens an extension-origin iframe with the selected record's useful dictionary, translation and saved context. The preview may also include a bounded set of completed assistant artifacts from exact same-item records on that page after the repository rechecks page, item identity and revision; the host page receives none of those bodies. It does not render a badge or page-history panel. SPA route changes re-register the document/page identity before reading again. `auto-sites.js` keeps automatic translation, cache restoration, persistent Quick Control and independent Reading recognition intent by site, and removes registrations left by older builds to prevent duplicate injection. The compiled JS/CSS explicitly targets Chrome 102, without a polyfill or a claim that Chrome 102 runtime has been tested. See [WXT_COMPAT_V1.md](./WXT_COMPAT_V1.md) for the build and artifact audit.

### Approved type and test tooling

TypeScript checks every new `src/**/*.ts(x)`, `entrypoints/**/*.ts(x)`, unit test/config and owned declaration under strict mode with `skipLibCheck:false`; legacy JS is not converted wholesale. Test discovery is disjoint: Node `tests/*.test.mjs`, Vitest `tests/unit/**/*.test.ts(x)`, Playwright `e2e/**/*.spec.mjs`. The only DOM environment is test-only jsdom; React interaction fixtures and all test libraries remain outside both production packages.

`scripts/check.mjs` parses all actual JS/MJS/CJS/TS/TSX/JSX sources and walks runtime import/export/dynamic-import dependencies. React/JSX is allowed only under `entrypoints/learning-center/`, `src/learning-center/`, `src/popup/` and non-Worker `src/options/`; each non-UI source's transitive closure must remain React-free. `src/options/workers/` is explicitly outside that allowlist. The production audit independently computes Popup, Options and Learning Center compiled closures and rejects React in Background/Content; MAIN and Workers remain exact raw-asset closures. Unregistered runtime packages, unresolvable/computed imports and runtime imports of tests/build sources fail. Declaration files are parsed and strictly typechecked but never enter the runtime graph; runtime edges into them fail. Complete `import type`/`export type` edges are erased, while inline type specifiers retain runtime edges under the actual verbatim compiler configuration. API ownership checks also cover TS and bounded aliases/computed API access. The single reviewed YouTube MAIN observer is pinned by an unconditional fixed SHA256 of its complete LF source, so container or mutable fetch delegation cannot widen its exception. Its exact path is fixed to LF by `.gitattributes` for fresh checkouts. Existing worktrees can retain Git-converted CRLF after an attribute-only upgrade, so the checker canonicalizes only CRLF to LF for this hash; standalone CR and all other source differences still fail. It does not rewrite the working file. Any other byte change requires authorized implementation, real subtitle regression and independent review before the coordinator updates that fixed value; this does not claim general JavaScript taint safety. The engineering migration itself grants no storage exception. The separately authorized ReadingRecord adapter is the second exact IndexedDB owner in Hard boundaries; frontend runtime dependency chains into it are rejected.

The type-only WXT aliases and unused generated `import.meta` environment limitation are recorded in [TYPES_TESTS_V1.md](./TYPES_TESTS_V1.md). They do not install browser globals or replace runtime validation/authorization. Reading DTOs remain owned by the existing `src/shared/reading/` validators; consumers begin with unknown input and must validate before narrowing.

## Lexical Gateway

Selection lexical lookup is a separate local-only Background boundary:

```text
Content/Selection (later #79)
  -> LEXICAL_LOOKUP
  -> background/lexical/gateway.js
       -> effective User Glossary override
       -> enabled user-installed OPFS readers
       -> attributable candidates
```

`background/lexical/active-opfs-reader.js` discovers enabled user-installed dictionaries from existing state and isolates per-pack faults. The generic `tflex-reader.js` retains bounded shard reads and byte-accounted LRU caching for format tooling; production lookup does not read extension-package dictionaries or issue health probes. An empty library yields local no-hit, while User Glossary remains available. Local lexical results do not enter translation cache. No data migration or preference reset is involved.

Rich dictionary lookup/navigation follows the frozen selection capture, independently of AI request versions; a new selection, query, route or document still invalidates the old session.

## Content

An invalidated extension context is terminal for the current document's automatic translation and cache-restore queues. `runtime.js` classifies a missing messaging API; `auto.js` stops both in-memory modes, observers and timers, clears pending work, and displays one localized refresh notice. Saved site settings and cached data remain intact, and a page refresh starts a fresh context with the saved modes. Ordinary network failures retain the existing retry/backoff behavior.

Content Script 的 owner 继续按 classic registry 模块分层，由 WXT 在构建期按唯一图组合：

1. runtime
2. tasks
3. dom
4. batch
5. processor
6. auto
7. selection modules
8. bootstrap

安装包只暴露 `content-scripts/content.js/.css`；源码图、旧逐文件投影和根 Content 文件不作为 ISOLATED public assets。

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
- provider connection ID / revision / protocol
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

The current generic cache uses `ai_bilingual_translator` **DB4** with `entries` / `epochs` and a **single record envelope v1**. On the DB2/DB3→DB4 structural upgrade, disposable old translation/page rows are intentionally discarded; independent AI explanation values are preserved by a one-time opaque transfer. ReadingRecord, user dictionary OPFS, settings and credentials remain separate. Plain/structured source identity, effective Provider configuration and prompt/format protocol are captured by `src/shared/translation-cache-identity.js`; later translation strategy changes update the identity/revision, **not** the database version or the record parser. Cache-only misses never trigger a new Provider call. See [CACHE_SYSTEM.md](./CACHE_SYSTEM.md).


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
- glossary UI 位于 `src/options/GlossarySection.tsx`，通过
  `src/options/glossary-client.ts` 操作同一 versioned store；
  Provider/cache/content 不依赖 Options DOM。


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

Popup and the complete Settings control tree use React while preserving their
existing message, storage, task/cancel, Effective Config and permission-union
contracts. Permission requests, file selection and dictionary installation occur
only in trusted user-action chains. Options Workers and Background remain
React-free; React clients coordinate the existing dictionary controllers and
render only text/validated metadata, never untrusted dictionary HTML.
Automatic cache restore is an explicit per-site mode: cache hits restore from
IndexedDB and cache misses do not fall through to Provider translation.

## Development task evidence

`docs/tasks/` contains sanitized local task contracts and candidate-bound acceptance/review metadata. `scripts/local-task.mjs` verifies local evidence without network/model calls or automatic Git mutations; the coordinator owns state and integration. Raw logs, events and screenshots remain ignored under `docs/task-execution/local/`. These development files and `.codex` hooks are outside both production allowlists. See [tasks/LOCAL_WORKFLOW.md](tasks/LOCAL_WORKFLOW.md).

## Browser basic translation

`translationEngineSettings()` selects browser basic translation for page, subtitle and explicitly authorized single-word selection tasks when no AI is configured, unless explicit machine translation takes precedence for the surface. Phrases and longer selections retain the ordinary selection route (AI or explicitly enabled machine translation). The blank untouched DeepSeek connection created by legacy migration is a placeholder; explicit default selection (`aiServiceConfigured`) and invalid connection references remain visible configuration errors. AI explanations keep the existing Provider path.

`browserTranslationEnabled` defaults to true, `browserSourceLanguage` to auto, `dictionaryEnabled` to false on new installs. Existing active imported dictionaries infer the dictionary preference before defaults are persisted; explicit false and per-dictionary enabled preferences survive upgrades. No dictionary, vocabulary or Reading store is cleared.

`TRANSLATION_ENGINE_SETTINGS` returns engine, configured state, enabled flag and language preferences. The Content translation client maps a selection to `selection-word` only when the current lookup explicitly carries `browserTranslationAllowed: true`; the Selection controller grants this only for lexical intent with exactly one token, including the local no-hit button. False or missing permission retains `selection`, without inheriting a previous task’s fallback choice. Page and subtitle browser routes remain available; longer selections use effective AI or explicit machine translation. Frozen browser plans retain their surface and cache write fences independently of the compact store payload. Browser snapshot creation normalizes the source code and resolves the target from global/site settings. Browser cache identity uses provider `browser-translator`, model `translator-v1` and explicit source/target languages within the shared DB4 contract. AI/Browser/Subtitle requests carry separate effective identities; a model, Prompt or format revision changes its cache key without introducing a new physical schema or a legacy reader.

`browser-translation.js` owns capability/prepare/execute/cancel, live instances and generation guards. The view calls create synchronously from a trusted page button. Capability queries and automatic cache restore never download models. Available language detection can be used locally; otherwise the page/track language is a hint and the user can choose or explicitly prepare detection. Internal structured markers are split outside the translator; code/kbd bodies are copied from protected descriptors. Translation of formatting runs separately can reduce cross-run linguistic context.

Eligible page, subtitle and single-word AI failures wait for explicit fallback selection, then restart through a new task and config snapshot. Ineligible selections report the AI requirement when unconfigured and never fall back to browser models. Closing, stopping, route changes and disabling basic translation abort pending local work; generation and task guards reject late results before rendering/cache writes. Disabling basic translation releases its instances without cancelling an active AI task or deleting shared Chrome language packs. With dictionaries enabled, a single-word or short CJK dictionary miss first queries enabled rich dictionaries; if none match, it remains a local no-hit result with no Provider request. Unavailable or invalid local resources retain a distinct diagnostic. Ordinary translation or AI explanation from those states requires an explicit user action. Disabling dictionaries and longer multi-word selections retain their existing translation routes.

All production builds exclude dictionary content, even if generated files exist locally. No alternate bundled-dictionary build mode exists. User dictionary validation and installation transactions remain unchanged.
