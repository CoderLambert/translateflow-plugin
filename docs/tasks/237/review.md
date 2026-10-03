# 237 主 Agent 自查

候选：`8fa9e8a1a4c7bc3a0684424430ccdb59e0a79db2`；基线：`origin/main=c250ce91aff7eb84d1ad8acbe1d4155ad244dc24`。本记录是主 Agent 对任务合同、真实 diff 和调用链的自查，不宣称独立模型审核。

## 结果

PASS。学习中心现在可以从已保存记录发起受控回访；后台重新核对 record revision、safeReturnUrl、站点/页面/同意代际和有效 host access，只把一次性、≤60 秒、worker-memory handoff 绑定给实际新 tab 与 Content 文档。目标 Content 自动注册但只有后台已绑定 handoff 时才消费 4 字段 `PageSummaryItem`，不列举历史、读取正文、定位 DOM 或调用 Provider。站点 marker 意图按 scheme/host/effective-port 独立保存，权限撤销后保留意图，不覆盖记录排除、自动翻译、缓存恢复或 Quick Control。

## 自查重点

- 权限与隐私：Manifest/CSP/required/optional permissions 无变化；权限请求只在学习中心受信任点击同步发起，后台仅 `contains`。URL/token/正文不进入网页 URL、错误或日志。
- 身份与竞态：create 仅精确学习中心；consume 仅目标 Content。实际 Chromium 首轮暴露 Content 早于 `tabs.create()` Promise 返回的竞态，已改为仅存在真实 pending create 时对 REGISTER 做短暂有界等待，并新增确定性回归。redirect/额外导航/tab remove/权限撤销/删除/清空/暂停/排除/代际变化/超时/重复消费/worker restart 均失效。
- 数据边界：Reading DB version/store/index 未变；repository 只在 readonly transaction 投影目标元数据与最小摘要。`readingMemorySites` 使用 `chrome.storage.local` 的现有 auto-sites owner，更新串行化以免不同功能丢写。
- 产品诚实性：UI 有 loading、permission-required、unsupported、disabled/changed/error 与普通安全链接退路；成功只写“安全打开，精确定位尚未提供”。任务 238/239 能力没有提前宣称。
- 包边界：Content 仍为 classic 顺序；共享合同经生成脚本投影；React 仍只在 learning-center；测试、文档和截图未进入安装包。

## 验收证据

- `npm run validate`：PASS；source/architecture check、1046 Node tests、strict typecheck、15 Vitest tests、默认 WXT 构建。
- `npm run build:extension:wxt`：PASS；163 files，1,823,646 bytes；`.output/chrome-mv3` fingerprint `cc0eaeb24404dfff50e1f9d54549cf180894af7728715472b5734deba3953b17`。
- `npm run test:e2e -- e2e/reading-handoff.spec.mjs`：PASS，Chromium 153.0.8010.12，1/1。真实划词保存 → 学习中心 → 新 tab → ISOLATED Content 一次性消费最小摘要；marker 开关持久化；Provider calls 保持 0。忽略目录中保留了 UI 截图与完整命令日志。

## 未验证

任务 238/239、Chrome 102 与其它浏览器、真实站点控制 UI 的逐项拒绝/撤销操作、隐身窗口、商店/发布均 NOT RUN；这些不由本候选宣称通过。无已知任务内 FAIL/BLOCKED。

## 合入后核对

PR #288 已按远端准确 head `44d53e6fad5731d431eaa05983a19c2d4315b331` squash 合入；实际 mergeHead 为 `c91f0e6d160e323f5a3a7504a919910107794885`。fetch 后 `origin/main^{tree}` 与 syncHead tree 均为 `d8892d8b2ce6fb8ae03cbc6a270f105a945c53c7`，远端任务分支已删除。GitHub classic protection返回未保护且 effective rules 为空，没有必需人工审核门槛。源码、测试、任务合同与构建输入未变化，因此不重复完整验收；state 记录 completed，后续进入 238。
