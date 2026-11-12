# 推理设置默认可用

基线 HEAD：6a7e796adee07639b673d78907c3342ec946644b，branch：feat/ai-sdk-providers；未提交工作树，未冻结 candidate。延续已交付 SDK 与页面回归修复。

默认 `{mode:"default"}` 不发送额外推理参数，由服务商决定模型推理行为，不统一强制某个强度。设置页默认折叠；用户主动自定义时，未知模型的 advanced 标志由编辑器记录，无额外确认步骤。未知能力提示只在自定义时显示。已有配置保留，恢复默认清除强度/预算/advanced。旧配置未具高级标志时的错误提示改为可操作的恢复方式。

## 验证

- PASS `npm run check`：静态、架构及双语 key 检查。
- PASS `npm run typecheck`。
- PASS `node --test tests/provider-reasoning.test.mjs tests/ai-sdk-providers.test.mjs`：48 项。
- PASS `npm run test:unit -- tests/unit/options-react.test.tsx`：23 项。
- PASS `npm run build:extension:wxt`：147 文件，5,074,043 字节。
- PASS `TF_TEST_WORKERS=1 npm run test:e2e -- e2e/provider-connections.spec.mjs --grep 'reasoning settings' --retries=0`：1 个真实 Chromium/MV3 流程覆盖默认隐藏、无确认勾选、自定义保存、重载及浏览器重启、恢复默认再次重载。使用本地 mock Provider。截图已人工检查。
- PASS `git diff --check`，主 Agent 自查：无权限/存储迁移/清空数据；不修改旧页面修复；按已保存配置处理，不静默覆盖。
- NOT RUN 真实厂商调用；本轮不重复无关全文提取或全量回归。

原始日志位于 `docs/task-execution/local/ai-sdk-providers/reasoning-ux-*.log`。浏览器测试树指纹：`df956d4a5ada0d3958b3258dd5b524e2dcc16dfbff02c460c29d46ce4e2b9604`。

## 本地交付

包已直接替换 `../translateflow-page-cancellation/dist/extension`。替换前按前次交付清单核验原包，路径及 symlink 检查通过；新包 staging 与 source 对比一致，再备份旧目录并 rename 替换，最后逐文件 SHA256 核验。收据为 `docs/task-execution/local/ai-sdk-providers/reasoning-ux-installed-copy.json`。未修改加载目录所属 worktree 源码，未访问真实 Key，未提交/推送/合并。用户实际 Chrome 尚需重新加载扩展并刷新设置页。
