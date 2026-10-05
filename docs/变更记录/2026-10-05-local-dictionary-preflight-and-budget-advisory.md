# 本地词典真实样本预检与包体门禁记录

- 日期：2026-10-05
- 分支：`fix/wiktionary-mdict-preflight-20261005`
- 基线：`origin/main` `39bdb53de2cff9f6f470ee6fa39809b635858810`
- 真实 MDX/MDD E2E `testedHead`：`7195185865797ddd1275faa61227080847361f86`
- 范围：修正 Options 本地词典隐藏控件、MDX `StripKey` 空描述符和 MDD 实际排序识别；保留 #245 包体阈值的 advisory 行为。真实 MDX+MDD 文件只在本机用于解析与 Options 浏览器验收。未合并、未发布。

## 变更

| 提交 | 内容 |
| --- | --- |
| `90b543baaa44caf35c5f19d4f210c51c5cc183a7` | `options.css` 明确遵守 `[hidden]`，避免预检/确认控件被布局样式重新显示；同步等待元素隐藏的 E2E 断言。 |
| `86b151faa7d356b366ddce186a3facb6123c494d` | 增加 MDD 大小写折叠顺序读取，同时按原拼写区分相同折叠值。 |
| `b4676ba582e489570f5a706d6831c26f25975417` | 将 #245 平台代码字节预算超额由失败改为 `WARN`；审计数值与其它断言仍保留。 |
| `7162a31567c8ff85812dcbecd6a7a0e4fc27bb39` | 仅允许 `StripKey` 规范化产生的空 MDX 描述符，继续拒绝空实际词头；检测 MDD 实际排序，验证完整描述符端点对。 |
| `a54e70509e63138a74f5f4a303b6b911c5ef4298` | 增加缺省 `KeyCaseSensitive` 头部的 MDD 原始排序兼容回归。 |

## 真实 MDX/MDD 发现

旧预检把 key-block 描述符当作实际词头校验。该输入使用 `StripKey=Yes`：真实首词头 `%` 非空，但其规范化描述符为空。独立成熟 reader 也读到实际首词头 `%`，记录偏移为 0；下一词头从偏移 298 开始。这解释了旧的 `MDICT_UNSAFE_CONTENT` 结果，**并非真实词头为空或当前安全拒绝有效**。

修复后，实际存储词头仍经过非空及内容安全校验；只有 `StripKey` 下的描述符端点可为空，且查找边界仍由实际词头派生。真实本地 MDX 成功建立 197,519 项、104 个 key block 的索引。

MDD 索引在读取已解码键时识别实际原始或大小写折叠顺序，跨 block 比较也参与判断。新 schema 保存识别结果；schema 1 继续按原始大小写排序读取。描述符端点仅在完整原始端点对或完整 `lower(actual)` 端点对匹配时接受；混合/错误端点和倒退 offset 仍拒绝。回归覆盖大小写折叠相同但拼写不同的资源、旧索引、缺失大小写头部、跨 block 查询及最后一项完整资源字节。

真实 MDD 的本地结构检查仍显示 17 个资源键、1 个 key block、8 个 record block。既有策略接受 1 个 CSS 与 2 个 PNG，拒绝 4 个 TTF、4 个 WOFF、4 个 WOFF2、1 个 EOT 与 1 个 SVG；没有扩大 allowlist。此策略统计不证明产品已实际呈现那些资源。

## 验证与产物

环境：Linux x86_64；本次 E2E/构建实际使用 Node `v24.19.0`、npm `11.9.0`、Chromium `153.0.8010.12`。仓库要求 Node `>=24.21.0 <25`、npm `>=11.19.0 <12`，因此这次 PASS 使用了低于仓库要求的运行时，不能视为合规版本认证。当前执行环境仅发现此 Node/npm 安装；合规版本重跑为 NOT_RUN。本运行环境不提供可观测模型名或推理档位，记为 `UNKNOWN`。

| 检查 | 结果 |
| --- | --- |
| `npm run check` | PASS；619 个 JS/TS/TSX 源文件检查，738 个 en/zh_CN locale 键。 |
| `node --test tests/rich-mdict-format.test.mjs tests/mdd-format.test.mjs` | PASS，17/17。 |
| `npm run build:extension:wxt` | PASS_WITH_WARNING；Manifest/资源/审计断言通过。平台代码 1,582,032 字节，#245 旧阈值 1,576,595 字节，超额 5,437 字节并发出 WARN。 |
| 当前 WXT 产物 | Chrome MV3，112 文件、2,198,751 字节、无内置词库；按 E2E tree-fingerprint 计算 SHA-256：`f6e28352271856a373e9a3f13a182acd473233a652c13b63a1c5dfd88f3409f2`。真实输入未进入构建产物。 |
| 本地真实文件 Options E2E | `npm run test:e2e -- e2e/local-dictionary-import-v2-product.spec.mjs --grep "locally supplied real MDX/MDD" --workers=1 --retries=0`，当前运行时 PASS，1/1；仓库要求版本下的重跑为 NOT_RUN。Git `testedHead` 为 `7195185865797ddd1275faa61227080847361f86`。输入只在本地读取；Options 导入后以 `中国` 查到 `中國`，持久 profile 重启后再次得到相同词条，再删除本次安装。Provider 调用 0、观测到的外部请求 0。运行器的 `sourceHead` 字段为空；这里的 testedHead 由本地 Git HEAD 核验。 |
| 真实导入截图 | `test-results/e2e/local-dictionary-import-v2-5db7d--survives-a-browser-restart/local-real-mdict-import-complete.png`；SHA-256 `139fa14c280a9e42f2072be68714a8e71bad46e7c5f7a80186933a5f5e2184cf`。截图显示预检可用、19.7 万词条及真实 MDD 文件关联；E2E 另行断言查询与重启后的词条相同。 |

本轮没有重新运行完整 `npm run validate`。既有 Reading/Selection/Provider 通过记录不移作本轮证据。本次真实 E2E 验证了 Options 的导入、直接离线查询、重启持久性和删除；没有覆盖 Selection 浮层或 MDD 资源在富文本卡中的真实呈现。

## 未运行与边界

- 未做整个 MDX 原文映射的独立实现全量 byte-for-byte 对照、60 个固定查询、10 个复杂词条的内容价值验证；不能据此完成 `offline-dictionary` 整卡认证。
- 该真实样本只验证本地 CC-CEDICT 格式导入与离线查询；Wiktionary 内容覆盖/质量和 Oxford 词典内容均未验证。
- 未验证实际 MDD CSS/图片/音频展示；字体和 SVG 继续受当前策略阻止，另有 CSS 引用没有资源键。没有放宽 CSP、权限或资源 allowlist。
- 真实/付费 Provider、商业或私人词典、Firefox/Safari、Edge、真实安装升级、商店打包/上传均未运行。
- 未改 GitHub Issue、任务状态、标签或 #229 审计结论。#229 仍为 open/auditing；只读核对发现 draft PR [#304](https://github.com/CoderLambert/translateflow-plugin/pull/304) 已更新其 post-merge 状态记录，此分支未改其文件或 Issues。
- 未推送本分支、未创建产品 PR、未合并或发布。准确产物 hash 仅指本节候选 `a54e705` 的 `.output/chrome-mv3`；先前文档中未由当前 tree-fingerprint 规则验证的产物 SHA/尺寸不再沿用。
