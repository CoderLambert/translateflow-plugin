# 单段恢复失败不再拖垮整页翻译

用户截图：nextjs.org 文档页在本地 `hy-mt2-7b`（LM Studio）下整页未翻译，弹出"自动翻译暂停：模型返回的译文不完整或破坏了原文格式"。

根因：本地 provider 的批次恢复是"全有或全无"。批请求格式校验失败后进入逐段恢复，只要**一个**段落恢复仍失败（模型丢 `⟦TF:n:S/E⟧` 标记、对短片段返回空、或始终返回非 JSON），`translateLocalBatches` 就把整批 throw 出去，`TRANSLATE_BATCH` 因此整页失败；`auto.js` 又把 `MALFORMED_RESPONSE` 视为"立即暂停"，于是一次格式失败就关掉整页自动翻译，并提示"重试整页翻译"——同一段落重试仍会失败。

范围：

1. `src/background/providers/openai-compatible.js`：逐段恢复失败改为**丢弃该段并继续**；只有当本次调用里没有任何段落成功时才抛错。对返回内容的校验强度不变（标记树、受保护内容、信封检查照旧），被丢弃的段不对应任何译文，内容层与字幕层已有 `missing` 处理。
2. `src/content/auto.js`：`MALFORMED_RESPONSE` 不再立即暂停，改为与超时/网络一致的连续失败计数（≥3 次）；`CONFIG`/`AUTH`/`PERMISSION`/`CONFIG_SNAPSHOT_EXPIRED` 仍然立即暂停。
3. 回归测试：新增"一段失败、其余返回"与"全段失败仍抛错"两类用例；更新既有单段恢复与自动暂停用例的期望。

不做：不放宽对已返回译文的校验、不让未校验文本上屏、不改 `partialResults` 契约语义以外的网关行为、不新增用户可见文案（缺段提示留待后续单独决定）。

验收：受影响用例 + 全量 Node 测试 + `npm run validate` 通过；"一段失败"用例在回退修复后必须失败。
