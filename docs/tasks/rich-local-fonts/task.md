# Oxford 富词条可见内容、导航与安装恢复收口

依据 main `cbf9e3b7498a3fa36e768ffcf48146996cd4786c`，在一个 WIP PR 中完成仍直接影响本地 Oxford 使用的剩余能力，完成后统一执行一次 exact-head 验收。PR329 已完成 radio/CSS/长词条布局，本任务不得重做；#270 parser/query 已完成，index cache/LRU 按用户决定暂停。

范围包括四部分：有界本地 TrueType 字体；inline/MDD 静态 SVG；同词典 `entry://`、fragment、Back/Forward 与 Oxford POS/hint/unbox/插图 adapter；六文件选择、ignored JS、完整附件重选、browser restart orphan reservation 恢复与 old healthy 保护。

安全边界保持不变：不执行词典 JS，不保留 event handler，不访问任意外网，不放宽 CSP/权限，不注入原始 HTML/XML/CSS URL，不把私有 Oxford 文件或正文写入仓库。所有资源继续经过 AST sanitizer、canonical resource resolver、owner/version/generation/cancel 检查和累计预算。Navigation history 只保存最多 20 条有限 metadata，不保存 raw record、AST、DOM、Blob 或 FontFace，也不写浏览器 history、Reading 或 Vocabulary。

Oxford adapter 只按完整、有限的结构关系启用展示行为，不按标题、hash 或任意 `data-*` 认证来源。POS、发音、词头符号只投影三个 canonical 数字字段；hint/preview 是扩展自有控件，Escape 先关闭内层再关闭 Selection。静态 SVG 只允许闭合 tag/attribute/geometry 子集并用 `createElementNS` 重建；字体只允许验证过的本地 sfnt TrueType，使用随机 family alias 和 `FontFace(ArrayBuffer)`，失败明确降级。

安装恢复复用现有 MDD worker、OPFS staging 和 `active.resources` 原子切换。六文件中的 JS 只生成有限 ignored diagnostic，不读取内容、不送 worker、不存储、不执行。安装行重新选择的是完整附件集合；browser-session token 只存在 `chrome.storage.session` 与后台 reservation，重启后只清理旧会话未激活暂存，同会话仍保持 busy。恢复 metadata 只保存 version/count/errorCode；失败、取消、配额或校验错误不得改变旧 active 资源。

最终验收只绑定冻结候选一次执行：任务 state 中的 targeted Node、`npm run validate`、WXT build、smoke、安全、取消与统一 Chromium E2E。随后用同一份合法私有 Oxford 六文件和同一 WXT artifact 做一次真实流程：六文件选择（JS ignored）、安装/重启、arch/go/come/get/重复键、POS、UK/US audio、字体、图片/SVG、entry navigation、Back/Forward、hint/unbox/preview、长文底部、附件中断/恢复及 old healthy 保护；记录 exact commit、artifact hash、Chromium、脱敏输入身份、Provider/external HTTP 次数。无法在当前 runner 可靠覆盖的单项必须标 `NOT_RUN`，不得用 synthetic 或旧 HEAD 结果替代。

不在本任务范围：index cache/LRU、prefix/fuzzy/full-text、Unified Article Shell、云同步/SRS、跨浏览器发布、Official 一键词典 #122、续传、任意附件增量合并、全资源后台健康扫描。
