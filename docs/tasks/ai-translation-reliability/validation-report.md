# 0.8.49 翻译可靠性验收

候选：`c61c8587e52ef56a76de1113b418bc59896732ee`。Node 24.21.0、npm 11.19.0、Chromium 153.0.8010.12。机器检查的准确命令、耗时和日志 SHA256 见 acceptance.json。

| 检查 | 结果 |
| --- | --- |
| `npm run validate` | PASS：静态/i18n、2093/2093 Node、严格 TypeScript、82/82 Vitest、公开包构建 |
| `npm run build:extension:wxt` | PASS |
| `npm run build:extension:dev` | PASS |
| `TF_SMOKE_ARTIFACT=dist/extension npm run test:wxt:smoke` | PASS |
| state.json 指定的五个受影响 E2E 文件 | PASS：30 项，包括协议污染/标记恢复、缓存、错误提示和手动恢复自动模式 |
| 真实 MDN + 用户指定 LM Studio/HY-MT2 手动翻译 | PASS：13/13 段，9 处代码内容完整，链接目标完整，无标记或协议残片；已查看真实截图 |
| 同一真实页面缓存恢复 | PASS：13/13 命中，0 次新增请求 |
| 真实 MDN 自动模式 | PASS：独立场景 10 段完成、backoff=0、无受保护标记内容变化，退出码 0（15.695 秒） |

## 失败与修复记录

- 原 0.8.48：模型 HTTP 200，但漏格式标记，整页 `MALFORMED_RESPONSE`、0/13。真实复现日志 `docs/task-execution/local/ai-translation-reliability/mdn-before.log`。
- 首候选 dc0c69d：机器验收通过，但截图发现标题混入 JSON/其它段落，产品验收不通过，未合入。保留 `candidate-dc0c69d-*` 与 `envelope-before.log`；最终候选增加协议污染拒绝和有界单段恢复。
- 实际模型请求期间出现超时；单段控制和相同批次随后可成功，根因尚未确定。没有改超时策略或重试上限掩盖失败。
- 最终候选联合真实脚本完成手动/缓存断言后，在自动阶段的 45 秒等待窗口结束，因此该脚本整体退出码为 1。只复验自动场景，等待窗口覆盖已有 HTTP 重试预算；不重复完整机器验收或手动请求。原日志与 binding 保留为 `mdn-final.log` / `mdn-final-binding.json`。
- DOM 自查曾错误假定同层代码标记必须保持原语序；现按既有合同比较内容及次数，adapter 仍逐 ID 验证代码和父子结构。该检查修正与产品代码保护规则无关。

## 证据与边界

原始日志、截图、脚本 hash 和补充 binding 保存在 `docs/task-execution/local/ai-translation-reliability/`，不提交公开页面完整模型 payload 或密钥。最终 `mdn-manual.png` 已确认标题与正文可读，非仅检查 completed 状态。自动模式的独立通过记录是 `mdn-auto-final.log` / `mdn-auto-final-binding.json`，与手动场景绑定同一候选；联合脚本中的自动等待失败仍原样保留。

没有执行全仓库浏览器 E2E、真实付费 Provider、真实 ChatGPT 账号或浏览器同 ID 升级验收。Native FIFO/取消/断线由合成 Host 回归覆盖。格式恢复可能降低跨片段语境连贯性；不承诺所有模型或服务状态下永不超时。

生产权限、DB schema、词典与用户配置不变；富文本通过 tf-markers-v2 隔离旧身份，原缓存不清空。旧 0.8.48 安装目录保留。验收后主 Agent 自查见 review.md，没有启动独立审核 Agent。
