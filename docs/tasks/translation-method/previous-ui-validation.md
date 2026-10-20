# 翻译方式配置简化的本地验收与安装结果

2026-10-20；主 Agent 实现与自查，未启动子 Agent 或独立模型审核。
工作区：`translateflow-translation-method`；分支：`fix/simplify-translation-method-20261020`。
基线 `49fb4ed7dcbdc49684d79803e0640b2b9fa093c0`，继承原 free-mt-auto-routing 工作区的未提交 v2 实现。
未提交、推送、合并；candidateHead/syncHead/mergeHead 均无，不声称冻结候选或 local gate PASS。

## 用户可使用的行为

- Popup/Options 统一「翻译方式」，分别注明「仅对当前网站生效」「默认设置，网站可单独调整」。
- 首层只有 AI／浏览器本地和免费在线；自动选择推荐，手动服务以中文显示并可恢复自动。
  已固定的服务显示在折叠摘要中；开合不改变选择；源语言放在更多选项，冷却诊断仅相关错误后显示。
- 显示已保存方式与待应用草稿。Popup 删除卡片中的保存/翻译按钮，唯一主按钮有草稿时为应用并翻译。
  选择不写入；主按钮先请求授权、成功保存本站覆盖，才进入原翻译流程；失败保留草稿且零翻译。
  跟随默认设置独立成链接，提交后使用原 inherit 合同。重载/组件卸载后未提交草稿丢弃。
- Options 保存翻译方式和连接检查独立；其他设置保存注明不含独立保存区域。
  原 sticky 保存条改为正常文档流，390px 窄屏保存按钮可见且不被遮挡；暗色与焦点沿用现有 token。

主要改动：`src/options/TranslationMethodFields.tsx` 复用显示与服务名称；
`src/popup/useMachineTranslation.ts` 管理草稿及保存门槛；Popup App 接入唯一主按钮；
Options section/底部入口、共享样式和双语文案同步。此次不改后台、v2 schema、消息值、权限或缓存合同。

## 本轮实际验证

原始日志、输入清单、准确包 inventory、截图、范围差异补丁和交付记录位于
`docs/task-execution/local/translation-method/`（Git 忽略）。
测试输入清单 851 项，指纹 `77d40a41b0112a41213406bbfcf3cf02eb97bb540a87b43f25fbeda76078c85a`。

| 命令 | 最终结果 |
| --- | --- |
| `npx vitest run tests/unit/popup-react.test.tsx tests/unit/translation-method-options.test.tsx tests/unit/options-navigation.test.tsx` | PASS，3 files / 13 tests；自动/固定草稿、保存先于翻译、拒绝授权、保存失败、默认恢复、草稿卸载丢弃、迟到响应、加载禁用及设置披露状态。日志 unit-delivery.log。 |
| `npm run typecheck` | PASS，严格 TS。日志 typecheck-delivery.log。 |
| `npm run check` | PASS，796 个 JS/TS/TSX 文件的源码/架构检查及 1191 个 i18n keys。日志 check-delivery.log。 |
| `npm run build:extension:wxt` | PASS，实际 WXT MV3 构建与 Manifest/资源审计，chrome102 构建目标。日志 build-delivery.log。 |
| `npm run test:e2e -- e2e/translation-method.spec.mjs e2e/machine-translation.spec.mjs --grep 'sole primary\|closing abandons\|rejection preserves\|Options reads\|Options applies\|Popup can choose'` | PASS，8 tests / 8.1s，Google Chrome for Testing 153.0.8010.12，绑定本页下述最终包。日志 e2e-delivery.log。 |
| `git diff --check` | PASS。 |

浏览器 E2E 使用真实扩展文档、MV3 background、存储、权限申请入口和页面翻译，外部响应为合成 mock。
验证自动/腾讯固定方式先保存后翻译及重载状态、默认恢复后走原 AI 配置、折叠键盘 Space 操作、
拒绝授权、后台真实 storage.set 抛错、设置读/编辑/保存的零翻译、明确连接检查、AI 配置保持和无 AI 设置下免费翻译。
拒绝授权通过测试副本中的 permissions.request 返回 false 注入；未声称自动操作系统授权对话框。
草稿丢弃在 MV3 文档重载与组件卸载/重新挂载中验证；用户原工具栏 Popup 刷新尚未执行。

初次组件测试 5 FAIL：新测试错误地按 label 获取了 section；改用 combobox role 后通过。
初次类型检查的新增测试 FAIL：Testing Library 不接受 Playwright 的 exact 选项；已移除并通过严格编译。
初次新增 E2E 为 3 PASS / 3 FAIL：fixture 使用带端口站点键，而仓库 normalizeOrigin 按 hostname 建键；
改为复用仓库函数后 8 个涉及流程全部通过。原失败日志保留，没有削弱断言或把失败改写为 PASS。
安装预检曾误用仅允许临时目录测试副本的 helper，被拒绝且未写入；后续使用构建输出检查、
pathRelation 的 disjoint 包装及 canonicalPath 核对两个真实包目录后成功替换。

## 证据复用与自查

原 v2 任务 evidence.json 中 592 个后台、Content、shared、构建/依赖/manifest 和旧 Node 测试输入
与本轮逐文件 SHA-256 一致（reuse.json）。原报告及日志仍在原 free-mt-auto-routing 工作区，
保留原绑定：后台 55 项最终专项 PASS、原 12 项 MV3/缓存流程，以及原完整 validate 的初次失败与定向修复。
这些是复用结果，不宣称本轮重新执行了它们或完整 validate。相关 UI 流程本轮已另行重验。

主 Agent 按两个已读取的 Vercel React best-practices 技能自查实际 diff：React 仅在现有可信 UI owner，
共享显示不拥有网络/存储，显式点击触发权限，错误不进入翻译，未提交草稿不落盘，关闭后迟到保存不触发翻译；
保存中禁用操作并有加载文案。保留后台/缓存/Provider 合同，无新权限、持久化渠道或付费 fallback。
这是主 Agent 自查，不是独立审核。

已查看截图：popup-automatic.png、popup-restored.png、popup-permission-error.png、
options-viewport-light.png、options-viewport-dark.png、options-narrow-light.png。
最终界面无横向溢出；设置页主/次按钮分行，正常文档流保存条不会覆盖视口内容。

## 安装交付

实际 WXT 包：131 文件，3,007,216 bytes，无附带词典；
SHA-256 `6daf3974c287e4133b3f76ddd0fbbd292a1ecb1e76b6d3b7f93bebb191b7bac6`。
同一包精确复制到本工作区 `dist/extension`，以及原 Chrome 已登记安装路径：
`<local-install-directory>`。

原包完整备份（未删除）：
`<local-backup-directory>`。
备份指纹 `c08f1f6cf0b43e7aada4b58e6d240dd2e7be486afc3e8ca7d4bbccb2d97aed49`，与原 v2 验收包一致。
复制前后逐文件校验；路径和符号链接预检通过，备份和新安装包指纹均已核对。

Chrome 原扩展 ID `<local-extension-id>`，路径保持原值。原 profile 刷新 **NOT RUN**；
用户在 chrome://extensions 刷新原 TranslateFlow 后使用新包，不需要重新加载为另一个扩展。
本轮真实服务请求、实际 Chrome 102 运行、全量无关回归、商店发布均 **NOT RUN**。
本轮没有修改原 free-mt-auto-routing 源码工作区或原安装工作区的 Git 源码修改。

公开记录已移除个人 home 路径与本机扩展身份；准确安装路径、扩展 ID 和备份位置仅保存在 Git 忽略的本地安装记录中。
