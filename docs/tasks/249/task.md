# [Platform][PF-04][P1] 新工作台的最小 i18n 与 UI 语言合同

历史引用：[#249](https://github.com/CoderLambert/translateflow-plugin/issues/249)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

## 执行卡
Parent #191；硬依赖 #246；可与 #247/#248 的测试准备并行，配置改动交 coordinator 单写。规划待启动。难度 L2，UI/i18n agent；reviewer 核对配置/缓存语义。

## 结果
#235 第一版 React 学习中心直接使用 en/zh_CN 本地化资源，不先写大量硬编码文案再翻工。本任务不是全面重写旧界面，也不是空的 React 组件库任务。

## 实现
1. 明确 `browserLocale` 只作信号、`uiLocale = auto | en | zh_CN` 是用户设置、`targetLanguage` 是翻译目标、`dictionaryLanguages` 是词典语言。UI locale 不进入翻译/解释 cache identity，不改变 Prompt、历史 Artifact目标语言或词典检索。
2. 建立 TranslateFlow 所有的纯 `t(key, args)`、locale resolver、格式化接口与 en/zh_CN catalog。优先小型类型化消息表+Intl，需要复杂 ICU 时另提实际需求，不引入多套i18n引擎。变量按文本插值，不输出 HTML；明确英文 fallback 和缺 key 的开发诊断。
3. locale policy：显式 en/zh_CN 优先；auto 的简体中文语言标签映射 zh_CN，en映射en，其他语言暂回en，zh-TW/HK不假装已有繁体。提供显式简体选择，规范化写入值且兼容旧用户没有 uiLocale 的情况。
4. Manifest `_locales` 与用户可切换的运行时 UI 不能混为一谈：Manifest由浏览器选择语言，应用可由用户覆盖。使用受控 catalog 投影生成对应 manifest messages/default_locale，避免两份长期手写的相同字符串；不谎称用户修改UI语言会立即改变商店或浏览器扩展名称。
5. Settings 先增加最小语言选择（可原生），#235 消费同一接口。监听经后台/现有storage边界分发的变化更新已打开应用；避免渲染期间未就绪闪出错误语言；不在纯共享层访问 chrome.*。
6. 单测覆盖fallback/插值/不同语言独立性与缺key；locale一致性检查纳入 validate。此阶段只迁移该控件、必要Manifest和新学习中心所需命名空间；其他旧UI允许清单化过渡，由PF-08清零，不宣称全插件双语已完成。

## 验收
- [ ] 中文浏览器+英文UI+中文翻译目标、英文浏览器+中文UI+原词典语言均可正确配置。
- [ ] 切UI语言前后相同翻译配置 cache身份/Provider请求体不变。
- [ ] 新界面没有复制Prompt、凭据、浏览器权限或ReadingRecord逻辑。
- [ ] Manifest语言键完整；缺key/无效插值测试失败；所有内容按不可信文本处理。
- [ ] 关闭重开恢复设置，存储失败有真实反馈，未选择的旧用户仍可使用。

## 所有权/验证
主写 `src/i18n/`、catalog与相应单元测试；Settings控件、manifest generation、package/scripts由coordinator整合。若#247尚未合入先用已有node:test验证纯函数；合入后适用Vitest，避免硬依赖循环。运行实际已有的validate与设置页Chromium E2E。
React/组件 primitives 在 #235 真实功能中实现；不引入全局状态库、路由平台、额外语言或批量AI翻译词典内容。
