# 已确认发布问题修复：0.8.60

基线 `0ea6f905dc2e8fdb0330e0cb0d7d7f1e5db1e1ba`，分支 `feat/unified-reading-polish`。用户授权修复此前 readiness 检查发现的问题。本轮完成代码、依赖、公开权限、许可与本地政策/支持入口，不推送、合入、部署网页或提交商店。

## 实现与兼容

- `PopupSelect` 的 describedBy/title/disabled 可选属性显式兼容来自 DOM props 的 undefined，解决 StyledSelect 的 TS2375；不改变配置值、onChange 和保存协议。
- markdown-it 15.0.2 → 15.0.3；Vite 7.3.1 → 7.3.7；锁文件内 esbuild 更新到允许范围内的修复版本。无框架主版本迁移。更新后的完整 npm audit 和生产依赖 audit 均为 0 个已知漏洞。漏洞审计不等于无未知漏洞或整体安全认证。
- 根 Manifest 作为公开合同移除 nativeMessaging；开发版 manifest projection 单独增加可选权限。公开/开发版保留相同版本、数据结构和网站权限，已有配置不被清理。
- 新增中英文隐私政策、双语支持说明及设置 → 关于入口；生成本地静态 HTML，无脚本、嵌入第三方资源或自动反馈。包含真实数据类别、在线服务接收方、自动路由、独立阅读记录控制、session 保留、清理、权限、Limited Use 和公开反馈脱敏提醒。用户主动点击外部链接才打开对应网站。
- 第三方许可从安装的运行依赖族生成完整文本，覆盖 React/ReactDOM/scheduler、Markdown 依赖、css-tree/mdn-data/source-map-js、请求控制依赖与 WXT runtime 等。WXT npm 包缺 LICENSE，保存上游仓库 MIT 原文和来源；不伪称 npm 包自带或供应商授权。
- `legal-assets.mjs` 将文档单源生成到精确 legal 资产，并核对安装版本许可；构建审核检查实际 compiled modules 的包均有许可。旧 free-mt.txt 源文件保留供历史文档引用，生产包改用完整第三方声明。
- `docs/STORE_READINESS.md` 写清本地成果、权限理由、用途草稿、审核步骤和剩余发布条件；README 与开发版说明同步。

## 实际验证

原始日志在 Git 忽略目录 `docs/task-execution/local/store-readiness-fixes/`。

| 命令/检查 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS，原 TS2375 消失，未放宽 tsconfig |
| `npm run check` | PASS，869 个源码文件及 1580 个 i18n keys |
| `npm audit --omit=dev` | PASS，0 告警 |
| `npm audit` / `npm audit --json` | PASS，含开发工具 0 告警；最终 audit.json 留档 |
| `node --test tests/wxt-assets.test.mjs tests/release-gate.test.mjs tests/selection-markdown-renderer.test.mjs tests/legal-assets.test.mjs tests/i18n-locales.test.mjs` | 15 PASS：权限隔离/负例、资源映射、Markdown 安全 DOM、文档一致性/无远程嵌入、许可缺失拒绝、i18n |
| `npx vitest run tests/unit/styled-select.test.tsx` | 2 PASS：用户选择改变受控草稿/提交值、禁用项、键盘选择/Escape、异步选项与锁定 |
| `node scripts/legal-assets.mjs --generate` / 文档一致性复核 | PASS |
| `npm run commit:prepare` 最终执行 | PASS，准确暂存快照构建 0.8.60，公开 Manifest/资产/实际依赖许可审核通过 |
| `node scripts/build-extension.mjs --developer --out dist/store-readiness-developer` | PASS，使用独立输出，不覆盖已有开发版目录 |
| 实际两包 Manifest 与文件核对 | PASS：公开包无 nativeMessaging、无 version_name；开发包有可选 nativeMessaging 和 0.8.60-dev；两包均含三个本地文档及第三方声明 |
| Git diff / staged diff 空白检查 | PASS |

首次公开构建被新增的实际许可覆盖检查拦截：css-tree 缺失。确认它用于富文本词典 CSS 处理后，补齐该依赖族许可；只重验 legal-assets 测试和构建，最终成功。首次失败日志保留在 build-public.log，最终日志为 build-public-final.log，不以删断言方式放行。补许可后没有改变 UI、权限或 Markdown 代码，复用此前对应 PASS。

最终公开构建 tree：`af4ae8b4a0126427bfee3719dd20f76750c857c1`。其后只补本报告与任务状态/索引，不改变构建输入。

- 公开包：145 文件，inventory SHA-256 `96eda863eae508181079e45626f9245a1f4182d0fa3b25cebe6cd82e7725a36d`。
- 开发验收包：145 文件，inventory SHA-256 `2b85af5c33d13e73c446de9ae0adc50d47b5672acb5b077eb4bdd572a64c04e9`。
- 这些 hash 是按排序后的 path/bytes/file SHA-256 inventory JSON 计算，不是 ZIP hash；算法及结果在本地 package-verification.json 对应工具记录中。

## 自查与剩余边界

主 Agent 对照实际 diff、调用路径、政策内容和两种产物自查；这是主 Agent 自查，不是独立安全审核。未扩大网站权限、增加翻译调用、导出密钥或迁移/清空数据库。新政策静态资产只供扩展页面使用，未加入网页可访问资源。

未执行全量 validate、完整浏览器 E2E、当前视觉截图、真实付费 Provider、真实 YouTube、Chrome 102、干净商店安装/升级。按用户不反复全量测试的偏好，只复验此次修复及受影响构建。最低版本和旧交互测试的全量适配仍应在正式候选验收完成，不将这次定向通过写成整个产品已可发布。

正式隐私 URL 仍需公开部署或随正式分支发布；本地扩展地址不能填写成商店 URL。免费网页服务条款、用户提供图标权利、开发者账号、商店截图/说明、真实环境和更新验收仍需外部证据，本轮未冒充完成。详见 STORE_READINESS.md。任务保持 reviewing，candidateHead/mergeHead 为 null。

## 试用

重新加载 `dist/extension/` 后重新打开设置页 → 关于：可离线查看隐私政策、帮助与反馈、第三方许可。原有选择框按原设置区域保存。无需卸载扩展或清除数据。
