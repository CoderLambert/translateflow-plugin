# 页面右下角常驻翻译进度

基线 HEAD/origin/main：6a7e796adee07639b673d78907c3342ec946644b；branch：feat/ai-sdk-providers。未提交工作树，candidateHead=null。

用户澄清要在页面右下角看到提示，前轮只补 Popup 内部 UI 没有完整满足意图。临时浏览器的旧右下角纯文字 toast 可以显示，未复现用户实际页面上完全不出现的现象；确认旧实现只在正文扫描完成后通知、缺少数值进度条。增加独立页面任务提示，并验证原生 Popup 关闭后仍可见。

## 实现与边界

- src/content/ui/page-progress.js：classic/IIFE，通过已有 registry 的 tasks.subscribe 读取 page task，不创建任务或发请求。queued 阶段即挂载到既有 Shadow DOM UI host，展示阶段、done/total、进度条；auto/selection task 不展示。任务工作时无隐藏计时，终态3200ms后隐藏。旧计时器不能隐藏新任务，真实导航后旧提示不回写。页面重绘移除节点后，旧进度心跳能重新挂载；stylesheet不重复累积。
- src/entries/content.js/content.js：唯一模块图加载，新提示在locale就绪后启动。没有运行时module/React或额外权限。
- src/content/runtime.js/src/content/processor.js：旧提示附taskId，合并到同一任务卡，保留旧脚本环境的文字fallback；失败、取消、缓存警告照实显示。普通通知仍由 uiToast 负责，在任务卡上方显示。
- 卡片右下角为默认悬浮球预留空间，显示期间不抢焦点，支持暗色/减少动画。用户隐藏悬浮球不影响任务提示。

## 证据

日志均在 docs/task-execution/local/ai-sdk-providers/。

- baseline：page-progress-baseline.log，旧纯文字toast存在的真实浏览器结果PASS。
- RED：`TF_TEST_WORKERS=1 npm run test:e2e -- e2e/page-progress-notice.spec.mjs --retries=0`，旧包缺少右下角任务卡/进度条，page-progress-red.log。
- PASS：`node --test tests/page-progress-notice.test.mjs tests/reading-ui.test.mjs tests/cache-system-persistence-failure.test.mjs tests/tasks.test.mjs tests/constants.test.mjs`，45项，page-progress-unit.log。自查补节点重绘恢复后，新模块4项定向重验PASS，page-progress-review-unit.log。
- PASS：`npm run check`，page-progress-check.log；自查仅补同模块节点恢复，无依赖边界变化，最终构建再次解析通过。
- PASS：`npm run typecheck`，page-progress-types.log。
- PASS：`npm run build:extension:wxt`，page-progress-build-reviewed.log，147文件/5,085,142字节。SDK仅后台、无新权限或CSP。
- 浏览器初验3PASS/1FAIL：page-progress-e2e.log。失败因测试误以为Popup不会显示浮球，而现有ensureInjected会主动显示；修正fixture为用户明确隐藏浮球，未改变产品实现来通过测试。
- PASS：`TF_TEST_WORKERS=1 npm run test:e2e -- e2e/page-progress-notice.spec.mjs e2e/popup-progress.spec.mjs --retries=0`，最终4项，page-progress-e2e-final.log。覆盖原生Popup关闭后卡片持续可见、隐藏浮球仍可见、删除卡片后恢复、完成4/4、错误状态、与Popup/浮球取消同步、真实HTTP关闭、无新增请求，以及默认球与卡片不重叠。
- PASS：git diff --check，主Agent自查；不声称独立审核。
- NOT RUN：用户日常Chrome实际页面手工验收、真实付费厂商；本轮只用临时Chromium/MV3与mock。

最终包 treeSha256：f05b290f99575da97200c22c9b4736cc36cd0a2a5e2710ddbe86bc8ca4e23541。

截图已查看：test-results/run-1794478482809-8249f61e-0608-44d0-86f9-54e7ce78edb9/artifacts/page-progress-notice-toolb-2c475-ter-the-native-Popup-closes-functional/page-progress-working.png。

## 交付

已核验替换 ../translateflow-page-cancellation/dist/extension，147文件/5,085,142字节。先对比上轮receipt的完整清单，检查路径与symlink，staging核验，再备份旧包并rename，校验目标及备份；manifest字节一致。收据page-progress-installed-copy.json。未改来源worktree源码，未访问真实凭据，未提交/推送/合并。生效需要重新加载扩展并刷新目标网页。
