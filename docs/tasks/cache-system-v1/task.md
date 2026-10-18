# 独立缓存系统 V1（当前唯一开发模块）

授权：用户要求先实现可独立演进的完整缓存系统，模块解耦，覆盖多个现有缓存场景，并在准备好后通知最终验收。此指令取代旧 M0→M1→M2→M3 的当前优先级；本模块结束前不开发 MT/AI 质量等其它模块。

## 基线与归属

基于 main `961a3757f3cad93921031b038e52e621c8c840b7`，使用独立分支 `feat/independent-cache-system-20261018`。不合入 PR #342 的未验收 MT 功能，也不修改 main。#342 后续须重基到本模块，不得以旧 cache-db.js 整文件覆盖新系统。

## 范围

2026-10-18 用户追加授权：继续修复验收中全部失败，包括 main 同样存在的既有故障。覆盖 Selection/Reading、词典安装和导入、设置语言、字幕及公共测试隔离；分别记录生产缺陷、测试前提漂移和环境问题。该范围不包含新 Provider、新产品模块、合并 main 或发布。此前 169 通过 / 54 失败 / 7 跳过和 2 个套件级错误仅作为待核对的历史结果，不视为当前候选验收。

2026-10-19 用户已确认人工验收通过，并追加授权完成提交、推送与 squash 合并，以及清理造成提交阻塞的不合适仓库规则。此轮仅修复索引对缺状态历史目录的处理、验收报告归档边界，并取消普通 commit 自动升版本/编译；保留按需版本准备、实际验收和准确远端 head 合并。该授权取代上段的合并限制，不包含发布或继续新功能。

通用请求身份、record envelope/namespace/TTL/容量策略、Memory/IndexedDB StorageDriver、持久化失效代次、取消共享、Page/Selection/Chrome plan/Subtitle/AI 解释适配、旧普通译文一次性废弃、测试和架构 owner 调整。

数据库布局 DB4、通用记录 recordVersion1、业务策略版本分开。业务和存储均不依赖旧 CACHE_SCHEMA_VERSION 哈希规则。翻译 Prompt/模型/源处理改变只改变业务身份；数据库结构不随之升级。无旧译文 parser、legacy key fallback 或双写。AI 解释内容仅一次性封装搬运，不影响独立 Reading 数据库/词典/凭据。

## 实现与安全合同

缓存核心不得 import Provider、DOM 或翻译业务，存储唯一 owner 为 `src/background/cache/storage-indexeddb.js`，`src/background/cache-db.js` 仅稳定门面。核心不联网，cache-only miss 不执行 loader。每次写入必须携带读取时的原始 token；清理后的旧请求不能重新写回。取消最后消费者后重试不共用旧 Promise，旧 finally 不清理新任务。

所有业务调用点贯通 token/format/actual providerText；字幕定位身份不等于发给模型的正文。读/写与真实请求共用有效配置，API Key 不进入日志/缓存值/指纹。未测试的 UI 或模型能力不能声称通过。

## 验收

1. 核心、内存存储、策略隔离、错误结果、TTL/LRU、取消与跨实例失效的 Node 定向测试。
2. Node24 完整仓库 validate；受影响现有测试按新合同适配，不减少安全断言。
3. 真实 Chromium 的原生 IDB 新安装、DB2/3→4 升级、非空解释搬运、回滚、blocked retry、跨连接失效、关闭重开。
4. 实际 WXT 包的 Page/Selection/Browser/Subtitle/解释流程和缓存管理；相同 ID 升级、无缓存不隐式调用、用户设置/词典/Reading 保留。
5. 准确候选、实际包 fingerprint、用户人工最终验收及受保护合并。当前没有这些完整证据时不得写 completed。

未执行写 NOT RUN，环境阻塞写 BLOCKED。最终候选须先提交再测，acceptance 绑定 testedHead；不将离线 overlay 的 Node22 结果冒充完整远端候选 Node24/WXT 结果。
