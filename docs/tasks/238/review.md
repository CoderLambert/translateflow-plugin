# 238 主 Agent 自查

候选：`e02b7c070d269d6bb004de9fd8bcd1f56734c12a`；基线：`origin/main=c91f0e6d160e323f5a3a7504a919910107794885`。本记录为主 Agent 对合同、实际 diff、定位算法、生命周期和产物的自查，不宣称独立模型审核。

## 结果

PASS。目标 Content 对 237 handoff 的冻结 anchor 执行本地有界恢复：quote exact 必须逐字匹配，prefix/suffix/blockDigest 存在时必须一致，旧 position 不直接授权；只有一个去重 Range 时 resolved，重复为 ambiguous，完整无命中为 missing，预算耗尽为 not-loaded，不支持根为 unsupported。resolved 会滚动并在 Shadow layer 画临时 rect，不包装或修改网页正文；历史卡保留 quote、重试、关闭和准确学习中心记录入口。

## 自查重点

- 身份/隐私：resolver 只消费后台 handoff 的最小 `PageSummaryItem`；网页不能提交 record/page 身份。deep link 仅为固定 extension page 加 UUID hash，不接受 URL/正文。无 Provider、网络、DB、cache、Manifest 权限变化。
- 正确性：split inline、emoji/UTF-16 映射沿 #231 投影；block digest 每个投影只计算一次；多个可信候选立即 ambiguous，不 first-match/fuzzy。position 错误仍由现有 quote/context 重新证明。超大 Text node 先看 length，绝不整段读取。
- 预算/竞态：扫描每片沿 8ms/500 nodes/16k units，总计 250ms/25k/1M；crypto/candidate 时间计入总预算。DOM revision 改变最多 3 次、150ms debounce 重试；resolved 后节点替换由 MutationObserver 有界重建。
- 清理/体验：Escape/close/pagehide/popstate/hashchange 清除 AbortController、Range、rect、observer、timer、RAF、scroll/resize listener，并恢复先前焦点。ambiguous/missing/not-loaded/unsupported 都保留可读 quote 和学习中心退路。
- 包边界：首次构建因新增 raw Content 超出冻结 platform ceiling 14,798 bytes 而正确 FAIL。没有调高/排除门槛；改为沿既有 generated-contract 模式，从唯一可读 Reading owners 生成两个校验过的 minified classic bundle。最终 platform 1,574,841 ≤ 1,576,595，余量 1,754 bytes。

## 验收证据

- `npm run validate`：PASS；source/architecture check、1054 Node tests、strict typecheck、15 Vitest tests、默认 WXT build。
- `npm run build:extension:wxt`：PASS；162 files / 1,822,230 bytes；artifact fingerprint `d5e3d9d2c4ac36694ec88306424c7ac0da6890d6b76329c46270f08e19f874f6`。
- `npm run test:e2e -- e2e/reading-return-location.spec.mjs`：PASS，Chromium 153.0.8010.12，1/1。真实保存→回访→唯一定位/viewport overlay→节点替换重建→Escape 清理；重复/缺失退路；目标卡打开准确 `#record=<UUID>`；Provider calls 0。忽略目录保留截图和完整日志。

## 已修失败与未验证

开发期实际修复了：新 worktree 缺依赖、platform budget 超限、目标页测试 fixture 未覆盖 `tabs.create`、源 chip 未先滚入视口、旧 runtime-mapping 测试固定首个文件名。准确候选的三项正式检查均 0 FAIL。239、Chrome 102/其它浏览器、隐身与不支持页面类型的真实站点、商店/发布 NOT RUN；npm 未变化锁文件仍报告 1 low / 1 high audit 告警。

## 合入后核对

PR #289 已按准确远端 head `aa5064256964b47f9162cdf54f6e345e7eddc54d` squash 合入，mergeHead `7c97090284b1e06b038c13788f98da324ec4ed2f`。fetch 后 main 与 syncHead tree 均为 `45512f767344a786ab980ab4439435311516beda`；远端任务分支已删除，effective rules 为空且无人工 review 门槛。源码/合同/测试/构建输入未变，不重复验收；state completed，继续 239。
