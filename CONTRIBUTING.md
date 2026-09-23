# Contributing to TranslateFlow

## Required validation

提交前：

```bash
npm run validate
```

项目没有第三方 npm 运行依赖；校验使用 Node 内置能力。

## Module ownership

- shared contracts/pure helpers: `src/shared/`
- Provider/network: `src/background/providers/`
- effective config: `src/background/config.js` + `src/shared/provider-config.js`
- IndexedDB: `src/background/cache-db.js`
- dynamic site scripts: `src/background/auto-sites.js`
- DOM extraction/render: `src/content/dom.js`
- batching: `src/content/batch.js`
- cache-first orchestration: `src/content/processor.js`
- observers/auto queue: `src/content/auto.js`

## Provider changes

新增 Provider 必须明确：

- credential storage
- endpoint format
- Host Permission strategy
- cache fingerprint fields
- JSON response behavior
- tests

不要在 Content Script 中添加 Provider 分支。

## Site profiles

站点配置应尽量只存“覆盖值”，不要复制完整全局配置。

当前允许覆盖：

- Provider
- Model
- Prompt
- Target Language

新增站点配置字段时，需要确认它是否影响缓存 identity。

## Cache changes

缓存是用户数据。不要在无关 PR 中修改：

- DB version
- stores/indexes
- cache schema
- URL/text normalization
- Provider fingerprint

需要修改时必须增加兼容/迁移测试。

## Permissions

新增 required host permission 必须有明确理由。优先使用 optional host permission，并在用户操作时按 Origin 申请。

## Commits

使用聚焦的 conventional-style message，例如：

- `feat: add site translation profiles`
- `feat: add openai-compatible provider`
- `fix: preserve provider host permission`
- `refactor: isolate provider config resolution`


## Presets

- 内置 Preset 只放在 `src/shared/presets.js`，不要在 Popup/Options 复制 prompt 文本。
- Preset 不得包含 API Key、Provider 凭据或 endpoint。
- 临时模式必须使用 session 状态，不得写入永久用户配置。
- 新增/修改 Preset 必须覆盖 prompt precedence 与 cache identity 测试。
- Site Profile 自定义 Prompt 的优先级高于 Preset。
