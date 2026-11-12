# 合入候选验收

最终实现候选：0a6924f3a3569be21aa6941a3e7282339863e846；branch feat/ai-sdk-providers；版本0.8.72。

- 初次 `npm run validate`：静态/i18n通过；2320项Node中2316PASS、4FAIL，原始记录main-sync-validate.log。4项旧fixture在tests/i18n-locales.test.mjs、native-client.test.mjs、native-selection-improvements.test.mjs中修复；生产代码未变，版本按提交规则递增。
- 当前候选 `node --test tests/i18n-locales.test.mjs tests/native-client.test.mjs tests/native-selection-improvements.test.mjs`：30PASS，正式local-task记录绑定当前候选。此前其余2316项有效结果复用，未宣称首次validate命令返回0。
- 当前候选 `npm run typecheck`：PASS。
- 当前候选 `npm run test:unit`：16文件/99项PASS。
- 当前候选 `npm run build:extension`：PASS；真实dist/extension已通过local-task artifact记录。
- 相关真实Chromium/MV3和页面用户URL mock证据见page-regression-report.md、reasoning-presets-report.md、popup-progress-report.md、page-progress-report.md。当前候选版本与已测试0.8.70包的产品代码相同，逐文件核验确认147文件中仅manifest.json的version字段变化，其余146文件与已通过浏览器验收的包字节完全一致，证据main-sync-artifact-equivalence.json。
- 非版本产品代码从6765d1fa至当前候选没有变化，仅3个旧fixture、版本四文件和任务状态变化。
- 真实付费服务商调用、速度/费用/质量：NOT RUN。用户真实Chrome手工验收：未签收。

原始日志与机器checks：docs/task-execution/local/ai-sdk-providers/、本目录acceptance.json。完整日志和用户安装包不进入Git。各历史阶段报告保留其当时绑定，不能替代当前机器结果。主Agent自查见review.md。

## 合并与版本化归档

PR #380 已于2026-11-12T11:01:51Z squash合入main：be0b4a2eb7cddfc56fdf437e7251150b6ec99e1b，实际tree与syncHead 0a6924f3a3569be21aa6941a3e7282339863e846相同。本地gate PASS保留在main-sync-gate.json；原候选checks与原始FAIL/PASS均不改绑。

每次commit更新版本的用户约定与“纯元数据保持全部构建输入不变”的归档条件不同时成立，因此本次不宣称纯元数据同inputTree复用：归档保留原实现candidate/sync/merge绑定，版本四文件单独递增至0.8.73并实际构建，提交前核对除manifest版本外全部运行资产字节一致。无需重复产品代码未变的Node、Vitest或浏览器流程。
