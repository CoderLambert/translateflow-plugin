# TranslateFlow 翻译质量：完整功能模块串行交付方案（V2）

> 2026-10-18，设计修订 / **仅方案，不包含生产代码改动**
>
> **本文件是 #343 开发顺序的优先执行合同，替代 V1 RFC 的 T1→T4“按技术切片跨模块推进”方式。** V1 仍保留为问题诊断及设计沿革；与本文件有冲突时以 V2 为准。
>
> 已审资料：[源码调研及交叉复审 #344](https://github.com/CoderLambert/translateflow-plugin/issues/344)（KISS、Read Frog、Linguist、FluentRead），[原设计 PR #343](https://github.com/CoderLambert/translateflow-plugin/pull/343)，[在线机器翻译 PR #342](https://github.com/CoderLambert/translateflow-plugin/pull/342)。
>
> 校验基线：`main@961a3757f3cad93921031b038e52e621c8c840b7`、`#342/head@8e7e70490a6c0c5511fcc102c93d9ad6c63499d8`。当前 #342 是 **Draft/未合并**，#343 是 docs-only Draft。**在实施前重新获取最新 main/PR**，不得用此静态 SHA 冒充未来基线。

## 0. 产品决定与交付制度

**唯一策略：一个正在实施的完整用户功能模块 + 一个模块自己的分支/PR/任务合同；通过功能与安全验收、满足仓库门禁并合入 main 后，才开始下一个模块。** 不并行启动第二个功能实现；可以在同一模块内做独立的只读调查/测试准备，但不能并发改写共享文件。

**“模块完成”严格定义**：已解决约定的可见用户场景，完成端到端生产路径，异常有安全回退，单测/受影响 MV3 E2E/候选验证通过，用户负责的真实体验验收结论明确，实际合入最新 main，`docs/tasks/<module>/state.json` 合法记录 mergeHead。只有文档、DTO、Prompt、Mock 测试、Draft PR 或构建成功都不等于模块完成。

**已有系统优先于新框架**：WXT 负责构建；Content 仍采用 `src/entries/content.js` 依序注册的 classic/IIFE 全局模块；`src/shared/` 仅纯函数合同；Background 仍统一 Provider 与配置快照；翻译缓存继续只由 `src/background/cache-db.js` 访问；ReadingRecord/离线词典/字幕维持隔离；不创建第二套任务状态机、Provider gateway、DOMParser 平台或数据库。

**本轮仅修改设计文档，尚未修复翻译行为**。旧的“W1 两项 P0 自动修复”已暂停，以避免其在本设计确定前并发落地。

## 1. 对现有缺陷的再审查：确认事实、影响与取舍

| 范围 | 最新源码证据 | 对产品的影响 | 修复归属 |
| --- | --- | --- | --- |
| Page 与 Selection 输入不同 | `src/content/dom.js#L39-L60`: plain `extractSourceText` 会过滤 code/pre；rich `structured.encodeElement` 保留 code 等标记；`selection/translation-query.js` 直接使用 `snapshot.text` | 相同可见句子不是稳定同一语义输入，模型所见信息不同 | M1 |
| 富文本完整性检查不足 | `src/content/structured.js` 的 `renderMarked` 检查 unknown/嵌套，却未逐项要求 descriptor 恰好出现一次；失败后 `stripMarkers` 降成纯文本 | 缺失标记时可能丢 code/kbd 文字或格式，错误结果仍可能入缓存 | M0/M1（各自路径） |
| 语义与 HTML 格式耦合 | `src/content/batch.js` 通过正则删除 marker 计算 visibleText；同时 `groupEntriesByText` 按 encoded text 身份去重 | 用户输入恰好包含 marker 字面时有碰撞/误识别风险；仅按表面文本判断无法定义安全复用 | M1 |
| LLM Prompt 差异 | `src/background/translation-requests.js` 针对标记文本追加额外规则，且当前要求不重排 marker | 中文自由语序与标签保全可能冲突，难以保证技术术语自然度 | M1 |
| 免费在线 MT | #342 里 `machine-translation.js` 通过 `translationParts` 对 prose 槽分别翻译；Provider 没有通用 HTML 恢复承诺 | 标记夹在语法中间时译文容易不自然；但完整硬送标记会带来更危险的错位 | M0 |
| Chrome 本地翻译 | `src/browser-native/runtime.js` 也是 `translationParts` 按槽调用；当前产品默认用于已获准的划词基础释义，不自动下载整页模型 | 小词/短句语种判断和复杂选区自然度受限；不应未经授权扩大为全页自动下载 | M2 |
| 缓存身份与恢复 | `src/background/cache-db.js` 现有 normalized URL + effective-config hash + providerText hash，且 cacheOnly 无新请求 | rich/plain 常不同 key；盲目用 semanticText 复用会破坏格式与引擎隔离 | M3 |
| #342 仍未交付完成 | Draft；其自报候选级合成网络 E2E 17/17，真实连接检查微软 PASS、腾讯 FAIL（2026-10-16 UTC），完整 validate/local-task gate 未确认通过 | 先将已在做的用户功能验收封板，再开始新的 AI 修复 | M0 |

**事实边界**：已核实输入、marker、分槽和缓存机制；截图差异的唯一因果仍需同一模型/配置、冷/热缓存、真实请求快照来验证，不承诺生成式模型每次文字完全一致。

## 2. 不推倒重做的统一技术合同

在 **M1 内部**引入共享概念，**不单独提交“只有 DTO 的功能模块”**。优先在既有 `src/content/structured.js` / `dom.js` 产生只读视图，需要跨执行上下文时再把纯函数放入 `src/shared/` 并按 WXT 的入口依赖图接线，禁止 classic IIFE 直接假定浏览器运行时可动态 import。

```ts
type TranslationSourceV2 = {
  version: 2;
  semanticText: string;          // DOM 真实可见语义，含 useMemo/code 文本，不含内部 marker
  providerText: string;          // 按引擎/能力决定实际送出的 payload；M1 初期继续兼容旧请求
  format: "plain" | "structured";
  formatDescriptors: SafeDescriptor[];   // 仅来自可信原始 DOM 的 a/strong/em/code/kbd/mark ...
  protectedSpans: ProtectedSpan[];       // 字面不得改写，引用安全 descriptor/范围
  formatIdentity: string;        // 节点/保护跨度身份，不是新缓存主键
};
```

- **语义提取**：从 DOM 原始文本/可见投影与受保护结构的同一个快照生成，避免 plain 路径丢 code、富文本路径带 marker；不通过全局 regex 移除用户输入中看似 `⟦TF:0:S⟧` 的字面内容；维持现有隐私/网站排除。
- **格式恢复**：span、code、kbd、a 属性只能从 source descriptor 创建。Provider 返回的标签/HTML 是不可信数据；成对 marker 必须存在且每个 id 恰好一次、嵌套合法、无额外 id/属性、保护文本按原文字面恢复。失败时不将结构错误译文当成功缓存，也不默默删掉原文 code；优先展示明确重试/安全保留原文，或能证明安全的纯文本双语降级。
- **语序**：允许译文中的“成对格式单元作为整体移动”，禁止更改标记自身及保护字面。只要模型不支持该能力就不能假装自动完成富文本对齐；需实际测试输出序列，必要时保守分槽。
- **能力分流**：
  - AI/本地 OpenAI-compatible LLM：支持条件性结构协议，但仍需严格校验与失败回退。
  - 微软/腾讯免费在线 MT：当前视为 text-only，未经实际验证不要把 HTML/TF markers 发给服务；在无受保护节点的普通段落尽量整句，复杂情况安全回退；任何新增能力必须基于具体 endpoint 的测试而非“微软/腾讯”品牌名。
  - Chrome Translator API：当前为已授权的划词单词/短语功能，text-only、模型生命周期与 LanguageDetector 独立；不得偷偷启用整页/自动下载。
  - Bergamot 或其它第三方离线引擎只作为设计参考，**不在本轮加入运行时**。
- **缓存合同**：继续 exact-cache-first，不改现有 IndexedDB schema/key/存量记录。除完全相同有效 Provider request identity 且结果渲染路径一致外，不跨 Page/Selection/格式/引擎共享；优化列入 M3 并要求可度量收益。
- **私密性**：诊断只留模型路由、样例 fixture ID、段数、hash 与耗时；真实网页原文、密钥、请求 body 不写 Issue、PR、日志或遥测。

## 3. 唯一串行开发路线

```text
M0 已有免费在线翻译封板（#342，正在进行）
   完整合入 main + 验收
          ↓
M1 AI Page/Selection 语义一致性与富文本可靠性
   完整合入 main + 验收
          ↓
M2 Chrome 浏览器本地基础翻译质量
   完整合入 main + 验收
          ↓
M3 同页缓存准确复用与恢复优化
   完整合入 main + 验收
          ↓
最终按同一产品矩阵回归（不再引入新功能）
```

### M0 — 完成已有免费在线机器翻译（优先处理 #342）

**用户看得见的完整功能**：无 AI Key 时用户明确选择微软/腾讯，完成设置确认 → 页面/划词翻译 → 译文显示 → 本站切换 → 取消/失败反馈 → 保存与缓存恢复；原 AI、字幕、词典和 Reading AI 追问不受影响。实现必须同时保护代码/链接结构，且不能将免费网络失败暗中转付费 AI。

**范围与内部顺序**：
1. 只在现有 #342 分支恢复，不另造竞争性 MT PR；核查最终候选源码、实测与本地任务 `docs/tasks/free-online-mt` 状态。补足 #342 尚欠的 `validate` / local-task gate / 候选准确证据，而不是拿开发时测试数冒充发布门槛。
2. 修复端到端 MT 结构保护与中文自然度：先覆盖可无损整句的普通段落，再针对 code/kbd/链接/粗体创建**明确的可支持能力矩阵**；没有可靠 marker 或文本位置对齐的场景安全保留原文并回退到可验证的分槽，不为追求自然度牺牲安全；结构损坏必须阻止缓存。与前一个变更完全属于同一功能模块，可分内部 commits，但只在一个工作模块内验收。
3. 保留用户主动发送确认、全局/本站覆盖顺序、无 Key/坏 AI 凭据可用、固定 endpoint、不发送 Cookie、取消/限流/429/超时和无自动付费回退；复用既有 UI 和 Reading artifact。
4. 核对真实网络：微软与腾讯分别记录 **当前网络/当前 endpoint/实际浏览器** 的结果。腾讯若仍不可用，标 BLOCKED 或另提显式缩范围决策（例如仅把微软标为已验证，腾讯不宣称可用），**不得把 17 个 mock E2E 当腾讯线上通过**。
5. 用户对真正可用的 Provider 完成产品验收，门禁/审查/合并通过后 M0 才算 Completed。没有得到必需的人体验收、不能合法完成 gate 时留在 blocked，不擅自开始 M1。

**本模块 Done**：一套可安装的当前候选包；页面/划词/设置/切换/取消/缓存/异常端到端覆盖；敏感文本不上报意外第三方；code/kbd 原文正确，链接安全；明确的真实服务可用性记录；无 P0/P1 遗留；合并 #342 到 main 并记录 mergeHead（按仓库实际保护/用户授权执行）。

### M1 — AI 全文和划词一致性（一个完整功能，不按 DTO/Prompt/Cache 拆开）

**用户可见结果**：React/技术文档中包含 `<code>useMemo</code>` 的句子，Page 与 Selection 都正确表达“useMemo **不会阻止**重新渲染”，技术名不改，链接/强调标签不坏；两处措辞允许不同但不应出现因内部结构导致的错意和明显语序问题。

**模块内部开发顺序（仅内部步骤）**：
1. 同一 DOM 快照产出 `semanticText` 与格式描述；修正原文提取跳过代码的差异、literal-marker 碰撞和结构分组，维持原 Content/WXT module graph。
2. 严格 rich 标记校验 + 受保护字面 + 安全 DOM 恢复；Provider 输出缺失/重复/错序标记时不当作翻译成功、不污染缓存/历史，仍允许从旧 exact cache 读取并做显示前校验；缓存错误仅在用户显式触发时重新翻译，cacheOnly 不隐式联网。
3. 对齐 Page/Selection 的基础译法/术语表和有效配置快照，附加 rich 规则只约束标记不更换译法；校准 prompt 对中文调序的要求，而非全局禁掉标签移动。保持原按 id 批处理、Provider 超时/取消与站点自定义 Prompt 优先级。
4. 实现已有覆盖范围内真实的 Page↔Selection 无密钥 E2E；对照 cold cache/warm cache、二次翻译和用户选择的真实 AI 模型。含 OpenAI-compatible 本地 LLM 时走相同 AI adapter，不给它单独开发第二套结构策略。
5. 候选验证与用户体验验收；只有完整成功后进入 M2。

**Done**：结构化与纯文本翻译都能完整显示；code/kbd、链接和样式正确或**明确且安全地降级**，无未被接受的 P0/P1；相同有效配置下译法和术语基本一致，无语义错误；异常可重试；任务取消/导航与旧缓存兼容；现有词典、Reading、字幕不退化；真实手工体验结果明确、合入 main。**不承诺 LLM 输出逐字一致，不要求跨 rich/plain 缓存命中。**

### M2 — Chrome Translator / LanguageDetector 现有划词能力质量

**边界**：只优化现有“被允许的划词基础翻译/语言检测/模型准备/失败反馈”，**不把 Chrome 模型无授权地扩展到整页或自动下载**；新增整页本地翻译属于未来单独产品决策。

**模块内部流程**：复核 `src/browser-native/runtime.js`、`src/shared/browser-language.js`、Content 选择及词典优先；语种检测优先使用合规上下文 sample，但翻译只发送用户选择且允许的文字；支持的整句（没有危险结构依赖）优先整体请求；有 code/marker 时必须严格保护且可降级到当前受控分槽。模型失败/未下载/权限拒绝/源语言不明/取消时不循环触发，也不悄悄调用付费 AI；实例生命周期与 in-flight 一致；补齐真实 Chromium Model API 能力与离线状态验收。

**Done**：词典优先不变、无需后台 HTTP、首次可明确准备/检查语言包、英文与中日韩等支持语种判断合理，不把拉丁字符直接臆断英语；整句、代码保护、取消/切换、模型销毁和失败状态完整，真实 Chromium 浏览器验收并合入 main。

### M3 — 缓存准确性、同页去重与恢复（最后优化成本）

**用户结果**：在已修复的文本输入与格式合同下，同页重复请求减少，刷新及 SPA 恢复稳定，用户不需清缓存。**提升命中率是优化目标而不是为强行复用牺牲译文质量。**

**范围**：保持 exact-first；对同一 URL/站点配置/Provider/语言/Prompt/格式保护和 payload 的安全等价请求做内存去重与在途合并；只有纯文本→纯文本等可证明一致的情况尝试 Page/Selection 复用，rich→plain 或 plain→rich 默认不共享译文。请求取消按消费者归属，旧 Promise 不能删除/覆盖新任务。单独测旧缓存、配置切换、模型/引擎隔离和 cacheOnly 0 Provider 请求。先做基准，确有收益再引入辅助 identity，非必要不增新 IDB schema。

**Done**：旧缓存/Reading 无损、错用率 0、取消与并发竞态无回归、测得重复请求数/首屏延迟/缓存命中改善或据数据放弃无收益优化，候选 gate、真实用户刷新验收、合并 main。

## 4. 每个模块的执行 / 交付模板（不能跳过）

使用仓库已有 `docs/tasks/<id>/{task.md,state.json,acceptance.json,review.md}` 与 `scripts/local-task.mjs`；**不造第二套远端状态机制**。

| 关口 | 执行动作与证据 | 不达标 |
| --- | --- | --- |
| G0 准入 | 上模块确实 completed + mergeHead 已在 `main`；本模块清晰验收、最新 main/PR/冲突检查、明确唯一 owner | 不启动 |
| G1 行为 | 生产代码贯通「提取→请求→结果校验→安全渲染→缓存/恢复」，有可用操作入口和错误恢复 | 继续本模块 |
| G2 定向回归 | Node/Vitest 目标测试、消息/缓存合同、API 失败、取消、页面变更、字面标记与保护文案 | FAIL 则修复 |
| G3 候选验收 | 根据变更范围按 `AGENTS.md`/LOCAL_WORKFLOW 运行一次合入前完整 `npm run validate`、受影响的真实 WXT Chromium E2E；记录真实包 fingerprint；现有有效 PASS 可复用 | BLOCKED/NOT RUN 不写 PASS |
| G4 产品验收 | 真实服务/模型、用户试用、明示功能范围、安全和体验质量；人工必需项由用户确认 | 保留 reviewing/blocked |
| G5 合并完成 | 主 Agent 自查准确候选、真实审查与合并权限门禁，合并/复核 main、写实际 mergeHead 和 completed | 不进入下模块 |

**G2 不是每次提交都重跑全量；G3 在最终候选/合入前集中执行一次。** 失败修复只重验受影响项，严格复用同指纹未变化的有效证据。不因无法访问本地包就把某个远程成功日志声称为当前候选实测。

模块归档只包含准确 SHA、来源、已 PASS/FAIL/NOT RUN、脱敏测试日志摘要、当前未关闭风险与回滚方式。生产模块每次只保留一个未完成的实现 PR；Review 中发现 blocker 在本模块修，不跳到新模块。

## 5. 用户级验收矩阵（每个模块按覆盖范围认领）

| ID | 用户场景 | 必须满足 |
| --- | --- | --- |
| U01 | 普通英文技术段落全文/划词 | 语义准确，完整句子自然，不需字面逐字相同 |
| U02 | `useMemo` 位于 code 标签中 | 否定关系准确，技术名、大小写、字面不变 |
| U03 | 重复两个 code/kbd + strong/em | 不丢、不重复、不移动到错误的结构单元 |
| U04 | 带 href/title 的 a 与中文调序 | 不引入新 URL/脚本属性，可信源属性保持安全 |
| U05 | 用户原文含字面 TF marker | 不当内部标记移除，不产生错位 |
| U06 | 标记丢失/重复/错嵌套/伪造 | 不落错误缓存；回退安全，有用户可理解的反馈 |
| U07 | 长段 / 空白 / 换行 / 列表 / 特殊字符 | 无错误语种识别、文本错序或结构破坏 |
| U08 | 站点 Prompt/Glossary/预设/模型/语言变更 | 生效优先级与缓存严格隔离 |
| U09 | 1000 段页面 + 短页面 | 无明显性能回退，记录 p50/p95、请求数和失效率的真实比较 |
| U10 | 冷缓存、热缓存、cacheOnly、SPA | 命中行为正确、历史恢复 Provider 新调用数 0 |
| U11 | 多个 Consumer、取消、导航、重试 | 晚到结果不污染新页面，不错误取消他人 |
| U12 | AI、MT、Browser、字幕、Reading | 不互相串模式/付费/缓存；功能和许可边界清晰 |
| U13 | 无 Key/坏 Key、离线/429/超时/格式错误 | 有明确错误、可重试、不会隐式调用收费 Provider |
| U14 | Chrome 模型未就绪/拒绝下载/重复准备 | 不自动下载，模型与语言状态、释放与取消可见且正确 |
| U15 | 真实微软/腾讯与 Mock 结果对比 | 真实供应商可用性与仿真 E2E 分离，不宣称未测服务已可用 |
| U16 | 真实 AI 冷/热和重复输出 | 质量/术语/结构正确；生成差异记录，不要求字面相同 |

**硬性质量底线**：经固定 fixture 验证的保护字面错误数 0、非法 DOM/不可信 HTML 插入数 0、跨 Provider/有效配置错缓存数 0、无用户意图的付费调用数 0。文本自然度先建立真实样本基线，再按实际人工评估做改进，不虚报百分比。

## 6. 协同、风险、回滚与排除项

1. **不重复开 #342**：优先完成已在运行的 M0；如其触及共享格式协议，由 M0 作为当前唯一 owner，合并后 M1 才在最新 main 更新 AI 语义合同。任何第二开发模块不得与之同写 `src/background/cache-db.js`、`translation-requests.js`、`src/content/processor.js`。
2. **#343 保留 Draft 设计 PR**；V1 是原始 RFC，本 V2 为串行可交付计划，不将其当生产 PR。两份文档都未改变代码行为。不要为了“通过门禁”给文档 PR 运行无关的构建/付费 Provider 测试。
3. 外部项目（KISS、Read Frog、FluentRead）多为 GPL-3.0；Linguist 存在 `LICENSE` BSD-3-Clause 与 `package.json` GPL-3.0 元数据冲突；只借鉴设计思想，自主实现，不直接复制项目代码。
4. 回滚仅回滚单模块候选与可选实验路径；不清 IndexedDB、词典、凭据或 Reading 历史，不增权限/跨站原文上传。格式策略异常时可用原有安全逻辑接管，不能用“静默显示已翻译”掩盖结构失败。
5. **延期但不在当前各模块偷做**：Google/B站免费服务、字幕机器翻译、整页 Chrome Translator、通用 Bergamot 模型管理器、跨网站共享缓存、智能 AI 复审、全站页面重写、词典/Reading schema 变更，均需未来明确需求和独立合同。
6. **既有 blocker**：#342 报告里 `docs/tasks/browser-native-language/` 缺少 `state.json` 导致 local-task index gate 失败；只在确认基线、真实任务归属和用户修改情况后合法修正或声明 BLOCKED，不允许虚构任务状态，也不降低 gate。

## 7. 当前实施命令

**当前唯一可开发模块：M0/#342；M1/M2/M3 均保持未启动。** 
下一次执行时先依据 #342 实际最新状态继续其未完成验收、复杂格式和真实网络门槛；只有 #342 真的满足合并与人工验收要求并成为 main 历史的一部分，才能开 M1 新分支。

如果 M0 在无法控制的第三方 endpoint 可用性上被阻塞，保留 blocked、交付独立验证证据，并由用户决定是否收窄支持范围；未获用户批准不得擅自视为完成或越过依赖。
---

## 8. 开源参考落地规范：复用现有实现，不重造翻译引擎

本附录是 [Issue #344 三份源码报告与交叉汇总](https://github.com/CoderLambert/translateflow-plugin/issues/344) 的**代码实施合同**，不改变 M0→M1→M2→M3 的串行交付顺序、门禁和人工验收。基线：`main@961a3757`，`#342/head@8e7e7049`，每次实施前复查最新状态。**本次补充纯文档，不等于代码修改或测试通过。**

### 8.1 成熟项目设计的“采用/不采用”

| 参考 | 对应已验证代码 | 采用方式 | 不做的事情 |
|---|---|---|---|
| FluentRead | [网页 whole-block 安全判定](https://github.com/FluentRead/FluentRead/blob/main/src/core/translation/serialization.ts#L298-L410)、[真正请求分叉](https://github.com/FluentRead/FluentRead/blob/main/src/features/full-page-translation/content/liveTextTranslation.ts#L175-L228)、[文档内联编号/atom](https://github.com/FluentRead/FluentRead/blob/main/src/features/document-translation/core/document.ts#L835-L975) | 采用**能安全整句才整句、无法保留结构就分槽**的策略；AI rich 中保留完整 code 语义并验证编号 marker | 不把文档协议误称为网页所有模式已实现；不直接照搬 GPL 源文件 |
| KISS Translator | [REPLACE/WARP 分类](https://github.com/fishjar/kiss-translator/blob/7a7e2957ce2084d374f802b3537f2e0ca87cd7b8/src/libs/translator.js#L82-L176)、[占位符保存与还原](https://github.com/fishjar/kiss-translator/blob/7a7e2957ce2084d374f802b3537f2e0ca87cd7b8/src/libs/translator.js#L4191-L4350) | 在已有 `structured.js` 中区分**可翻译样式**与**必须保留字面**，复用现有 source descriptor | 不照搬拼接 `outerHTML` + 模型结果 HTML 的完整渲染流程；不能靠 {{1}} 自动获得术语语义 |
| Read Frog | [按 Provider 能力分叉与回退](https://github.com/mengxi-ream/read-frog/blob/b7a63b77c3d7391905a83dd13e5e78ea651a8e11/src/utils/host/translate/core/translation-request.ts#L145-L240)、[marker 完整性](https://github.com/mengxi-ream/read-frog/blob/b7a63b77c3d7391905a83dd13e5e78ea651a8e11/src/utils/host/translate/html-attribute-markers.ts)、[Microsoft HTML 拒绝](https://github.com/mengxi-ream/read-frog/blob/b7a63b77c3d7391905a83dd13e5e78ea651a8e11/src/utils/host/translate/api/microsoft.ts#L37-L53)、[Google 换行保护](https://github.com/mengxi-ream/read-frog/blob/b7a63b77c3d7391905a83dd13e5e78ea651a8e11/src/utils/host/translate/api/google.ts#L42-L74) | 引擎能力选择 + 严格输出验证 + 不缓存退化结果；识别“语义检测文本”和“实际翻译文本”的区别 | 不把 Microsoft/腾讯网页服务当成 HTML-safe；不移植整套任务/状态/DOM 系统 |
| Linguist/Bergamot | [Bergamot html:false](https://github.com/translate-tools/linguist/blob/dcad45b5587d079a8a4aec8defdac34037fbbdf2/src/lib/translators/bergamot/BergamotTranslator.ts#L35-L63)、[模型资源缓存](https://github.com/translate-tools/linguist/blob/dcad45b5587d079a8a4aec8defdac34037fbbdf2/src/lib/translators/bergamot/TranslatorBackingWithCache.ts#L15-L75) | 本地引擎保持**纯文本 API、独立模型生命周期**，用现有 Chrome runtime 实现 | 不引入 Bergamot；模型文件 cache 不等于译文 cache |
| 通用库 | [domtranslator](https://github.com/translate-tools/domtranslator)（Apache-2.0）、[DOMPurify](https://github.com/cure53/DOMPurify)（Apache-2.0 / MPL-2.0） | 仅有**真实缺口**才评估增依赖；优先浏览器原生 `TreeWalker`、`createElement`、`Intl.Segmenter`、`AbortController` | domtranslator 示例逐 TextNode 调用，无法解决跨标签上下文分裂，不用它替换现有 Page/Selection/缓存管线。当前安全渲染不解析模型 HTML，不需要为此默认添加 DOMPurify |

**许可说明**：FluentRead/KISS/Read Frog 的上游实现采用 GPL-3.0，TranslateFlow 当前 main 没有核实到根目录 LICENSE；在未明确许可兼容前只能借鉴机制并独立实现，不能照搬 GPL 代码。Linguist 的根 LICENSE (BSD-3-Clause) 与 package.json (`GPL-3.0`) 存在元数据不一致，也不能简单复制整个项目。Apache 组件亦需保留适当 NOTICE/版权信息。

### 8.2 不增加新的 Provider/DOM/Cache 框架

**保留真实单一链路**：

```text
Content (classic IIFE + WXT single isolated script)
  dom.extractSourceSegment + structured.encodeElement
       → batch.buildEntries / groupEntriesByText
       → processor.CACHE_LOOKUP / TRANSLATE_BATCH
       → Background config snapshot / translation-gateway
       → selected Provider adapter
       → structured.renderTranslation (trusted source DOM descriptors)
       → processor.CACHE_STORE（只有通过格式和请求校验的结果）
```

不再实现一个新的跨项目 DOMTranslator、翻译 Scheduler、IDB、任务状态机或 Provider Gateway。新 shared 工具必须是**无 chrome、无 DOM、无副作用的纯函数**，Content 仍按 `src/entries/content.js` 的装配顺序使用，禁止在经典内容脚本中随意使用动态 import。

**M1 的最小数据合同（M0 不需要先造一套）**：

```ts
// 实施规格，不是已提交的代码
type SourceUnit = {
  semanticText: string;         // DOM 中真实可见的意义文本，保留 useMemo 等 code 字面
  providerText: string;         // 本次 Provider 真正收到的文本，按引擎适配
  descriptors: SafeDescriptor[];// 原始 DOM 中受控 tag/href/title/code 等
  protectedIds: number[];       // code/kbd 等本地强制恢复的编号
  formatIdentity: string;       // 本地验证和比对，初期不改现有 IDB key
};
```

在**同一次源快照**生成以上内容，避免 `text.replace(/⟦TF:[^⟧]*⟧/g, "")` 将用户字面标记误删；不能把 `semanticText` 直接当成跨引擎/跨格式的缓存 key。M1 先保留既有消息字段 `text` 与实际 Provider 参数，只有必要且有测试证明时才扩大合同。

### 8.3 引擎选择真值表（先保密和安全，再谈自然度）

| 当前输入/能力 | AI（含兼容本地 LLM） | M0 免费 MT（Edge/腾讯） | 现有 Chrome Translator |
|---|---|---|---|
| 无结构的自然句 | 一次整段 Provider 输入 | 一次整段纯文本输入，超限才断句 | 当前获准范围内整条选区调用 |
| strong/em/a 等可移动内联格式 | 整段加成对 marker，输出严格验证 | 默认继续受控分槽；若要放弃译文侧行内样式换取纯文本整句，先做独立产品验收，不暗改 | 仅安全纯文本场景整句；结构复杂仍分槽 |
| code/kbd 等不可变字面 | 现有 AI 授权范围内可以在标记对里传真实名称供模型理解，结果必须以源代码字面重建 | **保持 #342 承诺：代码、标记、URL 不上传**；不可能要求服务取得与 AI 完全相同的语义上下文，保留分槽与已知质量限制 | 本地不改 code/kbd；未证明安全时不做整体 rich 自动对齐 |
| 供应商 HTML、坏 marker 或服务不支持 | 拒绝错误结构/安全降级，不缓存 | 绝不硬送 HTML，失败不缓存且不转付费服务 | 纯文本 Provider，保留原文/明确失败、不得偷偷下载 |

**重要产品边界**：在“免费 MT 不上传 protected code 字面”的明确隐私条件下，含 `<code>useMemo</code>` 的复杂英文句子可能仍有语序不自然，不能宣称仅靠 Prompt 能根治。不要为了测试通过私自破坏这一约束。若未来希望获得更自然的 MT 整句，需单独取得允许发送技术标识符或接受译文侧纯文本格式降级的明确产品决策。

### 8.4 M0 #342 的最小实现步骤（当前唯一允许的生产代码模块）

**入口及现有能力**：

`src/shared/machine-translation.js` 定义 MT 选项、固定服务及 `machineSourceIdentity`；`src/content/batch.js` 透传 `protectedIds`；`src/shared/browser-language.js` 提供 `translationParts`；`src/background/providers/machine-translation.js` 依旧拆出 prose 请求；`machine-translation-transport.js` 已有严格固定 URL、15s 超时、512KiB 响应上限、禁 Cookie、禁重定向、排队与 429/403 冷却；`effective-config-snapshots.js` 保护 MT 任务归属。

1. **先冻结当前候选/定位真实缺口**：检查 #342 `docs/tasks/free-online-mt/{task.md,state.json,review.md}`，不要重建功能模块或伪造其它任务状态。已有相关 Node 23 项和生产 WXT 合成 HTTP E2E 17 项在 PR 中记为已报告结果；只保留准确候选绑定的有效证据，完成尚未通过的本地 `validate`/task gate/真正安装包验收。
2. **结果结构验证**：复用 `translationParts` 输入校验，新增源 marker 与回译 marker **相同 id 集合、每个 S/E 恰好一次、嵌套合法、无额外/残余 marker、protected span 原文字面**的成功门槛。Content `structured.renderMarked` 不能只检查 stack 却允许缺少 descriptor；**错误结果不 STORE、不展示为成功翻译**。旧 exact cache 命中时必须在展示前再次验证；cacheOnly 不能用付费调用修复坏条目。
3. **长句和行边界**：正常不含 marker 的句子仍一次发送；`splitMachineText` 只有遇到 provider 字节/字符上限才运行。若当前手写字符断句的 Unicode/换行边界有实际失败 fixture，可用内置 `Intl.Segmenter` sentence/grapheme 改进；不为了技术美观重构或增加 API 次数。
4. **有 code/kbd/链接的句子**：保持当前本地结构保护和文本槽分流。不能按字符串搜索在翻译结果中“猜测” code/link 应放哪里；Provider 无 HTML 对齐能力的场景安全保留原文、受控降级或明确失败，不能牺牲安全去追求整句。
5. **连接验收**：PR 报告微软单次真实调用 PASS、腾讯 FAIL（`MT_NETWORK`、无 HTTP status）；当前浏览器/网络重新用用户显式确认的固定非敏感句分别检查。腾讯仍不可用则模块保持 BLOCKED，或等待用户明确批准缩小首发范围；**mock E2E 不能冒充腾讯真实网络可用**。禁自动跨服务/付费 AI fallback。

**M0 已有测试入口**：`tests/machine-translation.test.mjs`、`e2e/machine-translation.spec.mjs`，只补缺失的 marker 丢/重/错、字面 TF token、code 重复、坏缓存/取消、长句语序/Unicode；保持原合成 Transport harness。不要增加第二套测试驱动器。

### 8.5 M1 全文/划词 AI 质量模块：内部步骤，必须同一模块完成

文件所有权：`src/content/{structured,dom,batch,processor}.js`、`src/content/selection/translation-query.js`、`src/background/translation-requests.js` 与受影响测试；完全保留 Provider Snapshot/Prompt/Glossary/Reading 原入口。

1. 原生 DOM 一次提取 `semanticText` 与受控 descriptors；plain/rich/Selection 可以做**语义对照**，仍保留正确的 providerText 和旧缓存身份。用户本来就含 `⟦TF:0:S⟧` 的正文必须当字面，不与内部标记碰撞。不要额外递归整页敏感 DOM。
2. 将现有 `renderMarked` 变为“先验证、后渲染”：检查每个 descriptor **恰好开闭一次**、未知/重复/错嵌套/残余 token；允许完整标记对作为原子单元随中文语序移动，但不许破坏父子关系；code/kbd 内容取源 `protectedText`，a.href/title 取源 DOM 允许的属性，不执行模型 HTML。
3. 对无效输出采用 **fail closed**：不写缓存和 Reading 成功记录；用户能看到明确错误或保留原文并显式重试。不要继续静默 `stripMarkers` 后标记为成功，因为它可能使受保护 code 丢失。缓存恢复也使用同一 validator，不隐式重新付费翻译。
4. 基础翻译 Prompt 仍由已有配置/站点/术语表决定，`translation-requests.js` 的 rich 补充规则**只约束格式**。现有 “do not reorder markers” 过于强，调整为“成对标记整体可移动；内部技术名不得改，数量/嵌套必须正确”；给用户 Prompt 维持覆盖优先级，温度=0 不是解决问题的唯一手段。
5. 完整端到端回归：同一真实模型与有效配置的 Page/Selection、冷/热缓存、复制/断言 `useMemo` 的否定语义（不会阻止重新渲染），多 code、嵌套 strong/a、恶意链接、断连/取消、SPA；对 UI 自然度做用户手动验收。**完成此一整条功能后才进入 M2**，不得把 DTO 或 Prompt 单独当已交付功能。

### 8.6 M2 Chrome 本地模型和 M3 缓存：只在其准入后动手

- **M2**：复用 `src/shared/browser-language.js` 的 `selectionDetectionSample`、`translationParts` 和 `src/browser-native/runtime.js` 的 `prepareBundle` / `detectDecision` / `execute`。KISS 的模型失败后失效实例重建仅供异常恢复思路参考；需要实际 Chromium 状态和 bounded retry，不照搬具体错误字符串。不自动下载、不默认整页、不引入 Bergamot，不把全页其它正文隐式发送供检测。
- **M3**：先量测现有 exact cache、`src/background/translation-requests.js` 的 `inflightByKey` 和 SPA/cacheOnly。仅当同配置+同 payload+同格式/保护 identity 的请求有可量化重复调用时优化。取消最后消费者后旧 aborted entry 应从 Map 隔离，旧 Promise `finally` 只能删自己的 entry（防止新任务被旧任务清理）。不清数据库、不增 DB_VERSION、不为语义相似就跨 rich/plain/Provider 共享缓存。可借鉴 Read Frog 的局部 LRU 思路，但不得复制其状态系统。

### 8.7 各模块最低完成标准与实际调用

**每个模块内部**可多次小提交、增量跑受影响 Node/Vitest 和 WXT 浏览器用例，仍只允许**一个模块拥有生产代码写入权**；不把下一模块与当前模块并行开发。候选合入前对准确 HEAD 集中完成一次完整 `npm run validate` 与必要 `npm run test:e2e`，后续失败按受影响范围重验，完整执行日志、包 fingerprint、真实 Provider 结果与人工验收分别记录。当前没运行的测试不得写 PASS。

功能门槛：受保护 code/kbd 字面失真 0，格式 marker 漂移/恶意链接不得作为成功缓存，自动缓存恢复 Provider 新调用 0，缺乏明确用户意图的收费 AI 调用 0，字幕/词典/Reading 既有数据不破坏。自然中文由真实样本+人工核查确定，不能要求不同 LLM 每次逐字相同。

**模块完成只以真实 PR 合并到最新 main + 完整验收 + 真实 mergeHead 为准。** 
