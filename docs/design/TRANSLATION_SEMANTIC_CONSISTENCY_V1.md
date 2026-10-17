# TranslateFlow：全文与划词翻译语义一致性方案（V1 / RFC）

- 日期：2026-10-18
- 审查基线：main @ 961a3757f3cad93921031b038e52e621c8c840b7
- 范围：AI 驱动的 Page/Selection 翻译、结构标记、缓存身份和验收；不改词典、阅读记录、字幕及机器翻译的产品行为
- 状态：设计评审，**本 PR 不修改生产代码，不宣称已修复问题**
- 并行工作：PR #342 正在修改 Page/Selection、机器翻译、批处理、缓存和请求层；后续实现应以其合并结果或最新 main 重基线

## 1. 问题、结论及证据等级

复现原文：

> It is also important to understand that useMemo does not prevent a component from re-rendering. It only helps avoid unnecessary recalculations.

同一用户页面的两处译文：

- 全文内联：还需要明白 useMemo 但不会阻止组件重新渲染。这只是帮助避免不必要的重新计算。
- 划词弹窗：还需要理解的是，useMemo 并不会阻止组件重新渲染。这只是帮助避免不必要的重新计算。

证据支持的结论：

1. 不是完全缺少文本规范化。src/shared/text.js 的 normalizeSourceText 已进行空白合并与 trim。
2. 全文路径 src/content/dom.js 的 extractSourceSegment 会调用 src/content/structured.js 的 encodeElement。富文本中 a/strong/b/em/i/code/kbd/mark 可能被编码为 ⟦TF:n:S⟧...⟦TF:n:E⟧；Selection 路径 src/content/selection/translation-query.js 则发送 snapshot.text。
3. src/content/batch.js 对全文段落分组、批量提交；Selection 单独提交一个 segment。两个请求的输入文本与批次上下文可能不同。
4. src/background/translation-requests.js 会对包含结构标记的 AI 请求追加 marker-preservation 指令，因而系统提示也可能不同。
5. src/background/cache-db.js 的 key 由规范化页面 URL、有效配置及规范化 segment text 的 hash 组合。富文本 marker 与纯文本不同，通常不会共享同一个缓存条目；相同页面、相同配置的非富文本原文则已经可能共用缓存。
6. src/background/providers/deepseek.js 翻译请求设有 temperature=0.2，src/background/providers/openai-compatible.js 提供默认 0.2（显式设置优先）。即使输入完全相同，也不能保证每次译文字面一致。

尚未证实：

- 无真实 Provider 请求/命中日志，不能把用户截图的词句差异唯一归因于 marker、批次、缓存或随机性。
- 截图无法确定实际使用的 Provider、模型、预设、站点 Prompt、是否命中历史缓存。
- 不应声称“取消 marker”或“temperature=0”能独立解决质量问题。

## 2. 目标与非目标

目标：

- 相同原文在 Page/Selection 形成可比对的、稳定的 semanticText；保留现有格式描述及受保护代码跨度。
- 相同有效 AI 配置时两模式的术语、语气及系统指令一致；结构保护是额外约束，而不是另一套翻译风格。
- 在**可证明安全**的情况下复用缓存，降低同页重复调用；其他情况下继续独立翻译，不以安全性换字面一致。
- 保持原页面 DOM、富文本格式、词典优先策略、浏览器本地翻译、字幕、阅读记录和取消/恢复行为兼容。
- 可通过无真实密钥的确定性 fixture，以及用户手动真实模型对照验收。

非目标：

- 不承诺生成模型每次字面输出完全一致。
- 不强制全文翻译变为“逐句一请求”，不因此扩大 API 用量。
- 不把用户原文上传到新的遥测服务；不改变 API 凭据、授权策略或跨页面隐私边界。
- 不在本次设计 PR 更改 IndexedDB schema/cacheSchema 或清理既有缓存。
- 不让机器翻译、browser-translator、AI 解释或字幕默认共享 AI 译文缓存。

## 3. 现有完整链路

Page：
1. src/content/dom.js: collectElements → extractSourceSegment。
2. src/content/structured.js: encodeElement 构造 marked text/descriptors，code/kbd 保留 protectedText。
3. src/content/batch.js: buildEntries → groupEntriesByText → makeBatches。
4. src/content/processor.js: CACHE_LOOKUP → TRANSLATE_BATCH → CACHE_STORE → insertGroupTranslation。
5. src/background/router.js: Effective Config snapshot → cache-db/translation-requests。
6. src/background/translation-requests.js: 对 rich marker 增加指令 → translation-gateway/providers。
7. src/content/structured.js: renderTranslation 严格按允许标签重建 DOM，受保护 code/kbd 取原文。

Selection：
1. src/content/selection/controller.js 读取 snapshot / range 与阅读上下文。
2. src/content/selection/translation-query.js: CACHE_LOOKUP → TRANSLATE_BATCH → CACHE_STORE；每次提交一个纯文本 segment。
3. 与 Page 共享 background Provider，但并非共享完全相同的 segment payload。

有效配置：
- src/background/config.js 合并 Default Service、Site Profile、Preset、Glossary；
- src/background/effective-config-snapshots.js 维持任务期间的配置快照；
- src/background/cache-db.js 的配置 hash 含 provider/model/prompt/targetLanguage、特定连接或协议/端点、glossaryIdentity。
- 同一页面 URL 不等于同一有效配置：站点 Prompt、预设和引擎选择仍需逐项确认。

### 已有保护，不得回退

- code/kbd 的原文恢复不能依赖模型正确拼写；
- URL/title 只能从原始 DOM 经白名单读取，绝不解析模型产生的 HTML；
- marker 嵌套/配对错误时现有 renderer 有降级路径；
- cacheOnly 模式不能调用 Provider；
- cancel/navigation/配置快照过期不能写入晚到结果；
- AI、browser-translator、机器翻译、字幕及 Selection explanation 缓存边界保持隔离。

## 4. 推荐设计：语义身份和呈现结构分离，但逐步上线

### 4.1 输入合同（新增纯数据模型，不替换现有协议）

建议在 src/shared/translation-source.js（或当前 Content 所属可共享的纯模块）定义 V1 合同：

    TranslationSourceV1 = {
      version: 1,
      semanticText: string,
      providerText: string,
      format: "plain" | "structured",
      formatDescriptors: FormatDescriptor[],
      protectedSpans: ProtectedSpan[],
      sourceIdentity: string,
      formatIdentity: string
    }

- semanticText：由**已验证的 DOM 文本节点顺序**提取，去除 TranslateFlow 自己的结构标记；仅空白规范化，保留大小写、Unicode 字符与词法标点。不能用无条件的正则删除用户原文中看似 marker 的字串。
- providerText：V1 plain 使用普通文本；rich **暂时保持**现有 marker 协议，不能仅把标记删掉就交给模型，否则无法无损恢复格式。
- formatDescriptors：只含允许的标签类型、结构位置、原始安全属性和 code/kbd protectedText，限额/深度沿用现有安全预算；不允许在 Provider 响应中构造原始 HTML。
- protectedSpans：引用已验证描述符的不可翻译范围，不得存页面完整 DOM 或扩展凭据。
- sourceIdentity：包含 V1 版本与 semanticText 的受控 hash；formatIdentity：包含 marker 布局和受保护文本签名的 hash（或等价稳定表示）。只在内存中做跨模式比较；不要直接拿 sourceIdentity 替换现有 IDB key。
- 规范化只做安全且可逆/不改变语义的处理，不做 case folding、NFKC、自动拼接跨段落、代码词替换。既有 normalizeSourceText 不改变公共语义。

示例：

    原始 DOM：It is ... that <code>useMemo</code> does not ...
    semanticText：It is ... that useMemo does not ...
    providerText：It is ... that ⟦TF:0:S⟧useMemo⟦TF:0:E⟧ does not ...
    formatIdentity：区分 code、strong、link 的原始结构

注意：跨模式 semanticText 相等不意味着 formatted translation 可被直接复用。

### 4.2 请求/Prompt 一致性

- 继续复用现有 resolveTranslationConfig/getEffectiveConfigSnapshot；不新增“全文 Prompt”或“划词 Prompt”配置项。
- 在 Provider 前形成相同的基础翻译规范（目标语言、术语表、代码标识符保留、语体/预设），按段落作独立指令；仅 rich 增补最小 marker 保护协议。
- 保持 JSON translations by id 的响应合同；批次里不得把相邻段落隐式拼成一个长段落；继续保留限额与重试策略。
- 为 plain/rich 对照 fixture 记录 canonical prompt 指纹、extra-format instruction 指纹、segment 数量和有效模型，但不持久化完整原文/凭据。
- 评估 DeepSeek 0.2 与可配置 temperature：可单独做受控 A/B；设为 0 也不保证完全确定，不能作为合并通过的唯一依据。
- 如后续优化 HTML marker 导致译文语法生硬，应通过**单独的质量实验**判断“分离占位符”和“受保护术语”的效果，而不是直接剥离 marker 后猜测 DOM 对齐。

### 4.3 缓存策略：exact-first + safe-reuse-only

优先级：

1. 原有 exact key（pageKey + configHash + sourceHash）命中 → 完全沿用，维护已有用户缓存。
2. 完全相同配置和 semanticText、且两端都是 plain / 经实测证明兼容的结构 → 可以尝试共享。
3. 如果一端是 rich 而另一端是 plain，**不能把不含 marker 的译文直接当作 rich translation 写入/渲染**；必须先有可信的格式对齐与校验器。V1 默认 miss → 原路径翻译。
4. 多层嵌套、链接、code/kbd、同词重复、受保护文字、marker 碰撞或对齐失败 → fail closed，不复用，也不写错误 alias。
5. 结构化模型返回需要逐项验证 marker 数量、嵌套、合法性及 protected span；失败按现有异常/降级策略处理，不得污染可共享缓存。

隔离范围：

- 复用必须至少保持完整的页面身份边界、有效配置 hash（含模型、prompt/preset/glossary、Provider 连接版本/端点/目标语言）和引擎类别；不同页面即使相同原文也不得自动跨站复用。
- 任何变更 request in-flight coalescing key 时，同时审核 temperature、protocol、streaming/采样配置及 Provider 身份；不能只用“相同原文”合并并发请求。
- 缓存转换需独立命名空间/字段和版本号。优先读旧数据；新增写入有独立容量统计、LRU/Prune 与孤儿清理方案。没有经过测试不得调整 DB_VERSION / CACHE_SCHEMA_VERSION。
- 不反向覆盖已存在的 ReadingRecord、Vocabulary、Translation Artifact；如要展示来源只使用已允许的 engine/cache 状态。

### 4.4 输出验证与用户体验

- 优先保持自然语言质量、技术词准确性，而不是强迫两个模式逐字相等。
- 当前原文中的 useMemo 必须保持大小写和原文形式，且“不会阻止重新渲染”不能产生“但不会”这种不自然的衔接。
- 格式层必须可恢复 strong/em/code/kbd/mark/a，原始安全 href/title 不改变；禁止执行模型响应中的 HTML/脚本。
- 弹窗可显示译文来源：同页缓存 / 新翻译（如产品设计确认），不误标“AI 一定返回相同答案”。
- 用户切换预设、站点 Profile、术语表或 Provider 后，旧结果可查看但不得冒充新配置翻译。

## 5. 交付拆分（最多同时打开两个开发 PR）

### T1：复现证据 + semanticText 合同（独立，低风险）

代码范围：src/content/structured.js、src/content/dom.js、src/shared/translation-source.js、独立 unit tests/fixtures。首先按 #342 合并后的 main 重审实际代码，避免覆盖其机器翻译格式工作。

交付：
- 新增 pure canonical extraction，并为 plain/rich 导出只读 semanticText/formatIdentity。
- 不修改 Provider 请求内容、不改缓存 key、不改用户界面。
- 对照 fixture：纯文本、code(useMemo)、strong、a+code、嵌套 span、同一技术名多次、非拉丁字符、用户文本含字面 marker 字符。
- 单测证明相同视觉原文得到同一个 semanticText；独立的格式身份区分不同 HTML 结构；不能意外读取扩展 UI 或敏感 input/contenteditable。

验收：现有 structured、selection、page tests 全过；新增纯单测全过；静态构建产物没有新增危险权限。

### T2：统一翻译指令 + Page/Selection 对照回归（中风险）

代码范围：src/background/translation-requests.js、Provider 公共 prompt 构造、可验证的 page/selection fixture；保持旧批次 API 和结构标记合同。

交付：
- 结构 marker 指令只涉及恢复结构，不引入不同的语体/翻译质量偏好。
- 同一有效配置的普通文本/富文本模型输入差异可解释、可观测；不暴露原文。
- 使用可控 Mock Provider 区分语义输入与 marker 协议，复现并验证 useMemo 句子的自然译文，避免模型返回 JSON 后错序。
- 保持请求取消、配置快照、provider failure/retry、cacheOnly 不触发请求。

验收：全量静态校验 + unit + E2E；任何富文本结构回退视为阻断合并。

### T3：安全的同页缓存复用（单独开发、单独评审）

代码范围：src/background/cache-db.js、src/content/processor.js、src/content/selection/translation-query.js、独立验证器与缓存测试。

交付：
- exact-first；仅 plain→plain 及**形式严格验证过**的场景启用共享；rich↔plain 没有可靠 alignment 时维持 miss。
- 并发“同页同原文”最多一次 Provider 调用，仅限完全相同有效请求身份。
- 旧缓存可以照常读取；新缓存不发生跨引擎/站点/预设污染；容量、撤销/取消、路由切换符合现有状态机。
- 对不可安全对齐的富文本走原路径：明确称为“安全降级”，而非“缓存故障”。

验收：100% 旧缓存 fixture 兼容、富文本 marker/链接/code 不丢失、并发与 config 切换无串写、自动恢复 0 Provider 请求；性能退化有基线对比。

### T4：真实体验验收（用户执行，不作为 T1/T2 前置条件）

产品对照：截图原句 + 技术文档、新闻、长文本、混合粗体/链接/代码；至少 DeepSeek 一种真实模型，同一有效配置、冷缓存和热缓存分开记录。

记录：实际 engine/model、是否命中缓存、语义指纹、段落数、样例质量结果；不能通过截图推断 Provider 参数。密钥、完整原文和站点敏感信息不写入 CI 日志。

通过标准：无语义错误/技术名损坏、用户可接受的自然中文、已有布局与划词交互不退化；对同一语义原文给出相同缓存结果仅在安全复用条件满足时要求。生成式调用本身的字面一致率是观察指标，不是硬性 100% 门槛。

## 6. 重点测试矩阵

| ID | 场景 | 预期 |
| --- | --- | --- |
| C01 | 普通 p 与整段划词，文本与配置完全一致 | semanticText 一致，旧 exact 缓存可用 |
| C02 | code(useMemo) 与整段划词 | semanticText 一致；rich 的 code 必须原文恢复；不能盲用 plain 缓存 |
| C03 | strong/em/mark 嵌套 + 中文调序 | 无非法嵌套/错误丢失标记；译文仍自然 |
| C04 | 多处相同 code、链接与原始 title/href | 不发生跨位置错配，不注入 HTML |
| C05 | 预设/站点 Prompt/术语表/模型/目标语言变更 | 不共享不同有效配置的缓存 |
| C06 | 同页并发划词与全文 | 只有身份完全一致才 coalesce；取消一个不影响其他合法 consumer |
| C07 | 旧版本已写入标记缓存 | exact key 正常命中且不重写旧数据 |
| C08 | cacheOnly 自动恢复 | 无新 Provider 请求；缺失时只报告 miss |
| C09 | DOM/SPA 修改、取消、快照过期 | 不写入已过期页面/配置结果 |
| C10 | 不可信字面 ⟦TF:7:S⟧ 及不成对 marker | 不误剥离用户文本，不生成危险节点 |
| C11 | AI、browser、机器翻译、字幕、Reading | 引擎/存储与行为边界保持隔离 |
| C12 | 429、超时、Malformed JSON、错误标记 | 重试/降级受控，无错误缓存污染 |

复现 E2E 必须比较“新请求”与“缓存命中”，不能只比较 UI 字符串。对于原文里存在内联格式的场景，必须检查真实 DOM tag、源 code 字符串及原始安全链接属性。

## 7. PR #342 协作与上线顺序

PR #342 修改了 src/background/cache-db.js、src/background/translation-requests.js、src/content/batch.js、src/content/processor.js、src/content/selection/translation-query.js 及机器翻译适配，且目前仍未合并。

- 本 RFC 从 main 直接分支，仅修改此设计文档，**可以独立审查**。
- T1/T2/T3 需要在 #342 合并后基于最新 main 实现；若 #342 放弃，则以最新 main 为准并重做受影响文件的对照审计。
- Machine Translation 具有自身的 engine/sourceLanguage/protectedIds 输入和 cache identity，不得让新的 AI 缓存快捷路径绕过 #342 的隔离。
- 提交顺序建议 T1 → T2 → T3；最多两个开发 PR 并行，T3 不能早于 T1 合入，T2/T3 涉及同名文件时串行落地。
- 不需要迁移/清除旧 IndexedDB 就可以上线第一阶段；任何真实 key/schema 迁移要单独列明确回滚方案。

## 8. 合并门槛、性能与回滚

每个实现 PR 必须包含：
1. 新的单元与集成测试，相关 Playwright E2E 证据；本设计 PR 不需要真实模型调用。
2. npm run check、npm test、npm run typecheck、npm run test:unit、npm run build:extension；E2E 使用项目既有 scripts/run-e2e.mjs 并报告 NOT RUN 项。
3. HTML/DOM 安全、权限、取消和缓存隔离的评审结论；变更脚本入口要通过打包 allowlist。
4. 长页面 1,000 段 fixture 的对照测量：新增纯文本规范化不应成为主要热路径瓶颈；与 baseline 比较 p95/内存/Provider 调用数，而不是臆造节省比例。
5. 回滚后可继续识别既有 exact cache，任何新字段可忽略、不改变旧记录含义；不删除任何阅读记录或凭据。

### 决策

- **采用**：在输入阶段分离 semanticText 与格式描述，保持 rich marker 有效、先做测量和兼容修复，再考虑安全复用。
- **拒绝**：直接删除 marker、直接把 Selection 缓存文本塞进 rich DOM、全局改变 normalizeSourceText、强制逐句请求、简单把 temperature=0 作为根治手段。
- **明确风险**：模型本身具有随机性，富文本翻译也要付出结构约束的代价；优先保证语义正确、自然、格式安全，之后再优化一致率及 API 成本。
