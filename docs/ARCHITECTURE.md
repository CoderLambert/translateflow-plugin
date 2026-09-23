# TranslateFlow Architecture

## Dependency direction

```text
UI (popup/options)
        |
        v
shared contracts / config normalization
        |
        +--------------------------+
        |                          |
        v                          v
content scripts -> messages -> background router
                                |
                                v
                    getEffectiveConfig(pageUrl)
                         /      |       \
                        v       v        v
                     cache   providers  auto-sites
```

## Hard boundaries

1. `src/shared/` 是纯合同/纯函数层，不访问 `chrome.*`。
2. 外部 HTTP 只能位于 `src/background/providers/`。
3. IndexedDB 只能位于 `src/background/cache-db.js`。
4. 动态 Content Script 注册只能位于 `src/background/auto-sites.js`。
5. `background.js` 和 `content.js` 保持组合入口，不承载业务功能。
6. Runtime message value 必须集中定义。
7. 权限属于公共 API，不能在普通重构中扩大。
8. API 调用和缓存读写必须基于同一个 Effective Translation Config。

## Configuration

全局配置位于 `chrome.storage.local`。

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
