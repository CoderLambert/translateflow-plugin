# TranslateFlow v0.5

轻量、BYOK、缓存优先的 Chrome Manifest V3 双语网页翻译扩展。保留英文原文，在原段落中展示中文译文；支持 DeepSeek 与 OpenAI-compatible API，并按“规范化 URL + 有效翻译配置 + 原文指纹”缓存翻译结果。

## v0.5 重点

- DeepSeek / OpenAI-compatible Provider 与站点级配置
- 划词翻译、统一 Translation Task、取消/重试/in-flight 去重
- 结构化双语渲染：保留链接、强调、code/kbd/mark 等安全内联语义
- 全局 + 站点术语表；站点术语可覆盖同名全局术语
- IndexedDB 缓存与有效配置隔离

## 架构

```text
Web Page -> content -> background/router
                       |
                       v
          resolveTranslationConfig(pageUrl)
                       +
          resolveEffectiveGlossary(pageUrl)
                       |
              +--------+--------+
              v                 v
           cache-db          providers/
```

关键原则：API 请求和缓存查询必须使用同一份有效配置。Provider adapter 不负责拼接术语；术语在共享配置/Prompt 边界解析。

## 开发

```bash
git clone https://github.com/CoderLambert/translateflow-plugin.git
cd translateflow-plugin
npm run validate
```

Chrome 中通过 `chrome://extensions/` 开启开发者模式并加载仓库根目录。

## Provider 与站点配置

设置页支持 DeepSeek 与 OpenAI-compatible。OpenAI-compatible Base URL 会自动补 `/chat/completions`，API Host Permission 按 Origin 动态申请。站点可以覆盖 Provider、Model、Prompt 和 Target Language；凭据仍保持 Provider 全局配置。

## 术语表

设置页可维护：

- 全局术语：应用于所有站点；
- 站点术语：只应用于规范化后的站点 Origin；
- source / target；
- 区分大小写；
- 启用/停用；
- 编辑与删除。

解析顺序：

```text
global glossary + matching site glossary -> effective glossary -> shared prompt composition
```

同一规范化 source term 冲突时，站点条目覆盖全局条目。禁用或删除条目会立即改变后续请求的有效术语配置。Provider adapter 只接收已经组合好的 Prompt，不感知 glossary 存储结构。

## 缓存

IndexedDB 保持：

```text
ai_bilingual_translator
├── pages
└── translations
```

缓存身份由 normalized URL、cache schema、Provider、Model、Target Language、最终 Prompt、OpenAI-compatible endpoint（适用时）以及非空有效 glossary identity 共同决定。**空术语表不会增加新的 identity 字段，因此保持既有缓存兼容性。** 非空术语按确定性顺序规范化；修改、禁用、删除有效条目会形成新的相关缓存版本。站点术语只在匹配 Origin 时进入有效配置，因此修改 A 站术语不会使 B 站缓存失效。

普通纯文本段落继续使用原有规范化文本作为 segment identity；包含受支持内联结构的段落使用 TranslateFlow 确定性结构标记。不会因为术语表功能提升全局 cache schema。

## 安全与权限

必需权限：`storage`、`activeTab`、`scripting`、DeepSeek API Host。可选 http/https Host Permission 仅作为用户后续按站点/API Origin 授权的最大范围。结构化翻译不会把模型 HTML 注入 `innerHTML`。

## 自动翻译与划词

自动模式使用 IntersectionObserver、MutationObserver、IndexedDB 缓存优先和 SPA 页面身份更新。划词翻译仅在用户触发后调用 Provider，并复用当前站点 Effective Translation Config。修改 Provider、站点 Profile 或有效术语后，后续翻译请求使用新的配置/缓存身份。

## 开发约束

`npm run check` 校验 shared 层不依赖 `chrome.*`、外部 fetch 仅位于 Provider、IndexedDB 仅位于 cache-db、Content Script 不使用 ESM、`src/` 单文件不超过 420 行等架构约束。GitHub Actions 在 PR 和 main push 执行 `npm run validate`。

## 当前限制

OpenAI-compatible 基于 Chat Completions；不同服务 JSON 输出能力存在差异。PDF、视频双语字幕尚未实现。Chrome 内部页面等受保护页面无法注入。API Key 保存于 `chrome.storage.local`，定位为个人 BYOK。
