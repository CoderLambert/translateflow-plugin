# Rich MDX index cache 累计预算

目标：收口 #270 剩余的无界 parsed MDX index Map。`a778a24f762c97933dd339c7a50bc39d99bd1610` 是任务最初建立时的历史 main 基线；本轮按用户授权，从当时最新的 `origin/main` 恢复同一任务，不改变原范围。WIP=1；不重新实现 parser/viewer/导入器，不修改权限、CSP、消息、数据 schema 或原 MDX/MDD。

先以合法合成 index 测量 20 installed / 20 enabled、顺序打开、连续查询和 preferred 热查询的 entry count、serialized index bytes、OPFS index read count、cold/warm latency；比较候选预算的保留/淘汰，再选择初始默认值。真实 Oxford 的已验证 index serialized bytes 607,164 仅作输入规模参考，不能代替多词典测量。heap/RSS 无可靠峰值则 NOT_MEASURED。

实现聚焦 LRU + 累计 serialized index weight 预算（不是实际 heap 上限），复用已有 loader/pack serialization/cache identity。持有中的 lookup 以明确 lease/引用保护：缓存容量压力不能驱逐正在缓存中的 active lookup 对象；没有可淘汰空间时跳过 admission/临时持有，不能越过缓存累计上限或阻塞 lookup。release 在成功/错误/取消 finally，显式 uninstall/replace/migration 必须失效旧 identity，但已持有引用不被破坏。worker restart 无 cache 时从 OPFS 校验恢复；eviction 后查询结果与冷加载一致。

主 Agent 单写任务/状态/证据/GitHub，执行 Agent 仅实现一个切片并拥有 cache helper、rich-mdict manager/loader/controller/catalog replacement 所需最小改动及对应 Node/MV3 fixtures/tests。读探索只在 /tmp 测量，不写 repo/用户 OPFS；审核只读不写生产代码。共享 contract 不改上限，默认总缓存预算必须有测量依据。

验收：LRU 访问更新/累计边界/active lease/所有 pinned admission bypass/release once/取消与异常/uninstall/replace/migration/restart；20 词典真实 isolated OPFS 或 manager 仿存储计数、preferred 热查询、淘汰后重读、一致性；现有 multi-dictionary、index migration、lookup cancellation、storage 和安全回归。每个 PR npm validate、显式 WXT、smoke、相关 Chromium、diff check，准确 candidate 与 artifact；独审无 blocker 后 guarded squash merge 与 actual main 复验。合成测量不宣称真实 Oxford 浏览器 #274 完成。

历史优先级校准（2026-10-13）：真实 Oxford index 约 0.6 MiB，没有证据表明 cache 占用导致当前用户问题。根据当时关于尚不清楚安装数量的反馈，该切片曾后移到 #271–#273 产品问题之后。此前 16 MiB 只有候选结论，没有可复核的原始测量记录，因此恢复任务后重新测量；合成压力序列不作为用户安装数量预测，也不宣称真实 Oxford 词典或浏览器性能。

验证范围合并：`npm run validate` 的 `npm test` 会运行 `tests/*.test.mjs`，其中已包含 rich MDict security、lookup cancellation、storage、migration、records 和本任务新增 Node 测试。因此 state.json 不再重复记录这些 Node 子集脚本；仍单独执行显式 WXT 构建、WXT smoke 和本任务涉及的 Chromium E2E。
