# 右上角 Popup 与悬浮球共用页面翻译进度

基线 HEAD/origin/main：6a7e796adee07639b673d78907c3342ec946644b；branch：feat/ai-sdk-providers。未提交工作树，candidateHead=null。延续前序 SDK、页面兼容与推理预设工作，没有提交/推送/合并授权。

用户问题：右上角操作栏点击翻译后缺少与悬浮球一致的进度展示。回归发现：原 Popup 只有临时文字轮询，没有进度条；只知道本次打开时自己创建的 taskId，重开无法恢复 Content 里仍运行的任务。

## 实现

- content.js：TASK_STATUS 带ID继续查原任务；省略ID时返回当前页最新 page task；排除其他页面任务和划词任务。复用既有消息值与 tasks.getLatestTask，不启动新任务，不持久化进度。
- src/popup/client.ts：只读查询当前标签页任务，无脚本注入或 Provider 调用；补全公开状态类型。
- src/popup/usePopup.ts：复用 Content snapshot，展示阶段/done/total/机器服务切换；Popup 重开接续原任务，可确认取消。关闭只清理轮询，页面翻译继续。旧 startup snapshot、旧查询及旧 client scope 的翻译响应均不能覆盖新任务。最终状态优先使用 processor 返回的 task，缺失项不能伪装满进度。
- src/popup/App.tsx / popup.css：原固定操作区增加带无障碍属性的进度条；工作时禁止重复翻译，完成/失败/取消反馈继续复用任务结果。支持减少动画，未变更权限或 CSP。
- e2e mock 增加可显式释放的翻译响应 gate，真实请求/完成/关闭事件作为测试信号，不靠固定 sleep。

## 验证

原始日志位于 docs/task-execution/local/ai-sdk-providers/popup-progress-*.log。

- RED：`npm run test:unit -- tests/unit/popup-react.test.tsx -t 'toolbar Popup'`：2个针对进度条及重开恢复的场景在原实现失败，popup-progress-red.log。
- PASS：`npm run test:unit -- tests/unit/popup-react.test.tsx`，最终19项，popup-progress-unit-reviewed.log。中间补queued即时反馈后旧断言过早读取，改为等待真实done=2更新，未放宽预期。覆盖数字进度/服务、恢复/取消、终态、晚到查询与旧scope响应不回写。
- PASS：`node --test tests/tasks.test.mjs tests/translation-client-navigation.test.mjs`，18项，popup-progress-tasks.log。
- PASS：`npm run typecheck`，popup-progress-types-reviewed.log。
- PASS：`npm run check`，popup-progress-check.log；最终局部scope guard无新增依赖，严格类型和构建再次通过。
- PASS：`npm run build:extension:wxt`，popup-progress-build-final.log。147文件、5,081,294字节。
- PASS：`TF_TEST_WORKERS=1 npm run test:e2e -- e2e/popup-progress.spec.mjs e2e/popup-native.spec.mjs --retries=0`，3项，popup-progress-e2e.log。原生Chrome action.openPopup/getViews验证：尺寸与主操作可见、自己发起翻译的进度、关闭重开无新增请求、接续悬浮球任务并实际取消关闭HTTP。
- PASS：最后补scope guard后仅重验 `TF_TEST_WORKERS=1 npm run test:e2e -- e2e/popup-progress.spec.mjs --retries=0`，2项，popup-progress-e2e-final.log；尺寸场景复用原证据。
- 最后只为截图关闭过渡动画，视觉场景定向重验记录popup-progress-visual.log；fixture变化不重建生产包。
- PASS：git diff --check，主Agent自查。未调用第二审核Agent。
- NOT RUN：真实服务商调用及用户日常Chrome手工验收；全部浏览器验证为临时Chromium/MV3与本地mock。未重复无关全量回归。

最终浏览器产物 treeSha256：0486d3be0582c88c6d4da1ed757ce6de60991e877577f7c593ae7fa63c02968f。

## 交付

已替换 ../translateflow-page-cancellation/dist/extension，147文件/5,081,294字节。替换前与上轮交付逐文件清单核验，路径与symlink检查，staging复制校验后备份旧目录并rename，最后核验目标及备份；manifest字节一致。收据：popup-progress-installed-copy.json。来源worktree源码保留；没有访问用户真实凭据。重新加载扩展后刷新网页，使新的Content状态查询分支生效。
