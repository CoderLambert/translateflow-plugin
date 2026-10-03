# Release A 候选主 Agent 自查

候选 `d6cf346bdd7b7f06db784d61c6edc225ed8e52f5`，基线 main `b606cfd556792d9764d0b15461b7a142fcd99575`。主 Agent 自查，不标为独立终审。本地 ready_to_sync；#236 未推送/PR/合并/发布。主线整合前不记录 READING_LOOP_A_PASS 或 completed。

## 本轮改动与结论

仅修复物理 quota 用例的浏览器生命周期，并同步验收说明。生产源码、fixture、构建输入、其余场景未变，包 fingerprint 保持 `a4348aaa4e4775eb163fdb3cf55d6f55f7d960f1dbbda229f54da6c368d04eb9`。旧原生拒写断言没有放宽：仍要求 512KiB随机不可压缩 native IDB transaction abort/QuotaExceededError，且现在追加真实collector→compiled Reading 的原生 READING_QUOTA/恢复空间/显式重试路径（实际错误code为READING_QUOTA）。未覆盖IDB原型、未注入DOMException、未扩大权限或填宿主磁盘。

精确153.0.8010.12 Chromium源码显示 BucketContext 可先消耗额度缓存，再询问quota manager；renderer/worker结束不保证重建该原生上下文。完整浏览器/profile重启后同额度/数据的事务发生实际QuotaExceededError。源码和重启对照支持这个解释，没有声称直接观测内部cache值；旧失败和初始NO-GO证据保留原head/hash。

## 验收与证据复用

当前冻结候选执行 `npm run test:e2e -- e2e/reading-loop-release-a.spec.mjs --grep 'extension-origin physical quota' --workers=1`：PASS（1项）。实际原生拒写后旧记录可读、可导出、可删除。quota=1阶段，真实Selection点击导致后台reading.begin-query返回READING_QUOTA，卡显示not-saved；原记录数1保持。恢复空间后点重试保存变成2条记录，Provider调用0，编译后台文件不变。

保留 `215759f8a050448287140efccd1f1f6918fb5141` 的 check/TS/11项Vitest/WXT PASS 与完整E2E **148 PASS / 1 FAIL / 6 SKIP**；本次通过替代其唯一失败，汇总证据为 **149 PASS / 0 未解决 FAIL / 6 SKIP**，不宣称当前head重新执行完整155项。完整validate（1034 Node/15Vitest）保留8a972fc原head/log。实际diff证明src/entrypoints/package/manifest/scripts/tests完全未变，只有quota场景和验收文档变化；其它PASS仍有效。gate配置只重验改变/失败项，没有把旧FAIL改成PASS或降低验收条件。

既有真实创建/重启、词典卸载/断网/Provider未配置零历史调用、1,439条/67,092,027B/256chunk近预算导出、单消息342,508B、worker/页面退出、10k容量恢复、source/Unicode/安全/键盘/双语/缩放和DOM计时证据保持原绑定，详见acceptance.json的reused及supplementary字段。

## 授权与限制

6 skip及实际桌面IME/Chrome102/其它浏览器/付费模型/文件保存结局/商店发布的未验证状态保持。没有下载或重新认证词典；没有第二次模型审核。Focus修复215759f与本次测试修复均在本地236分支；实际main交付需下一次明确同步/合并授权。无待解决的本地验收阻断，但不在当前授权外继续发布或后续任务。
