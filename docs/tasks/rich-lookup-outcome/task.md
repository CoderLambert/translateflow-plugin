# Selection 富词典聚合结果状态正确性

当前用户授权本轮连续词典收口；以 GitHub 最新 main 为事实来源。此任务为唯一实施切片 task 0，基线 `cab9315819304a6ae1aa5e065a77c8864d88cc9d`。用户明确要求远端状态校准、独立审核、guarded squash merge 和 Issue 校准，覆盖本地流程的日常不调用 GitHub/不自动独审默认值。

目标：结构化 no-hit 不再因创建 Rich 卡片消失；session 级聚合区分 unqueried、queued、pending、hit、no-hit、error、cancelled、unavailable。structured hit 保持主结果；rich 真正 hit 清除空态；全体实际完成 no-hit 给出明确未找到；未展开和错误不冒充结果。旧 selection、关闭、取消、generation 变化不能回写当前 UI。

范围：rich-details 维护状态；popover 消费稳定 summary；必要小接口和定向 Node/Chromium 回归。复用排队、requestId、owner 与取消，不改变 Provider、权限、CSP、存储或词典数据合同。

验收覆盖：structured no-hit + rich hit；all rich no-hit；error+no-hit；error+hit；未展开；cancel 后旧结果；generation 改变；preferred no-hit 后第二本 hit。保留 structured 主结果、独立错误、AI 显式触发和多词典顺序。

执行 Agent 仅拥有本切片源码和测试，主 Agent 单写 state/证据并负责集成。独立审核只读，不写生产代码。验收命令与产物要求唯一登记于 state.json；所有 PASS 绑定准确候选与产物，合成 E2E 不冒称真实 Oxford 验收。

## 当前 main 能力校准

2026-10-13 通过 `git fetch origin` 与 GitHub commits/main API 核对 main；26 个 open Issue、1 个 open PR 已拉取。#325 仅 README 文档。读取 #313/#315/#319/#324 合入信息并沿当前源码核对，旧 Issue 顶部 d812663 不是当前实现基线。

| 能力 | 当前状态与证据边界 |
| --- | --- |
| Rich MDX/MDD、StarDict 导入 | 已合入；本轮只回归，不重写 |
| 多词典 enable/order/preferred | 已合入；现有 multi-dictionary E2E |
| Jitendex 原五文件导入、媒体与重启 | #313 历史真实 Chromium 定向 PASS；不冒充当前候选或 Oxford 证据 |
| AVIF/Opus、用户点击 sound、本词条 fragment | 已合入；安全/资源/取消回归 |
| Oxford 词头重复、badge、BrE/NAmE | #319 已合入，历史私有包定向证据；本轮不重做 |
| 长词条 210px 内部滚动移除、footer、发音 UI | #324 已合入；整体当前候选实机确认仍有未测边界 |
| 生词本 MVP、Reading 历史/回访 | 主体已合入；#229/#244 保持实际边界，不扩散本轮 |
| Selection Rich 查询空态 | 存在 cards 创建即 reset 的缺陷；本任务修复 |
| #270 | Stripkey 拼写兼容、派生 index 兼容和同键多 record 尚缺 |
| Rich index cache | 当前为无累计预算的 Map；后续唯一串行切片 |
| #271 | details/summary 已合入；radio/label、checked/兄弟选择器、必要伪元素、字体、静态 SVG 待完整核对与真实验收 |
| #272 | sound/fragment/alias 已合入；entry 跨词、history 与 Oxford 固定交互未闭合 |
| #273 | 多附件导入基础已有；restart 后附件恢复与失败旧版保护待收口 |
| #269/#274 | 私有六文件身份与同一产物全流程验收仍需实际运行，不以合成测试替代 |
| #122 | OPEN/BLOCKED；没有新的 approved source，用户导入 Oxford 不属于 Official |

当前 main 没有 check-runs/status 条目，main 无 branch protection 或生效 rules，仓库 Actions 为 workflow_dispatch。combined status 的 pending（0 statuses）不代表有 required CI 正在运行；旧成功结果绑定旧提交，本轮不复用为当前 head PASS。合并边界重新核对准确 head、base、checks 和 review threads。

容量核对（代码合同，不代表实测）：MDX source 128 MiB、MDX decoded 总记录流 512 MiB、单 record 1 MiB、展开文本 2 MiB、MDX index 8 MiB；MDD source 单/合计 4,000,000,000 bytes、decoded 总流 2 GiB、MDD index 单 16 MiB/合计 32 MiB；整包 source 合计 4,000,000,000 bytes；单媒体资源 8 MiB；sidecar 单 8 MiB/合计 64 MiB（32 个）；viewer 32,768 nodes/1,024 资源描述、活跃 Blob 32 MiB/16 Mi pixels。真实被测包大小后续与输入身份一起记录，不宣称单 MDX 支持 4GB。

Oxford 私有输入已沿既有本地验收脚本限定线索只读确认可访问；六文件总 1,533,010,812 bytes。MDX 38,807,694 bytes，两个 MDD 分别 30,900,438 / 1,463,189,889 bytes，CSS 61,996、PNG 35,943、JS 14,852 bytes。JS 仅作输入身份散列，不执行。#319 旧报告复用已有安装（reusedOwnedProfileInstall=true，install=null），可保留查询/重启结论，不能当作本轮六文件完整重新导入证据。私有路径、词条内容和媒体不进入仓库。

真实 MDX 只读核对：header 使用 `Stripkey="Yes"`，无 `StripKey`，`KeyCaseSensitive="No"`，当前 parser 错误得到 stripKey=false。当前 schema 1 compact index：133,571 keys、90 key blocks、5,607 record blocks、344,095,474 decoded bytes、607,436 serialized index bytes。完整 key 元数据扫描发现 5,185 个重复 display headword 组，均有 distinct offsets，7 组跨 key block；共享 offset 0；本包 record span 跨 record block 0。arch/go/come/get 各一个 span，原始 record bytes 分别 18,923/778,100/587,579/566,816。全 record/alias 扫描 NOT RUN；同 offset、跨 record block 等仍须合成回归。上述是后续 #270 设计输入，未实现或宣称其 PASS。

本切片还需由既有 `scripts/reading-content-classic.mjs` 再生 `src/content/reading-record.js`：该 legacy 投影入口直接引用 Popover/rich-details，源码变化后须保持可复现。仅生成输出更新，不修改 Reading 业务、存储或权限。旧注释字符串不再作为“主结果不替换”的证据，现有动态 outcome 测试与 multi-dictionary E2E 断言实际主结果。
