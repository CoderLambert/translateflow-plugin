# 网页右键翻译当前页面（0.8.65）

主Agent实现与自查，未委派独立审核。入口沿用既有 `translate-page` 命令，不建立第二套翻译编排。

## 实现

- 新增 `src/background/context-menu.js`：只在普通 HTTP/HTTPS 文档上创建单项「翻译或更新当前页面」，覆盖页面、选中文字、链接、图片、音视频、输入框和框架区域；不进入工具栏图标菜单。标题来自 Manifest 本地化文案，上下文失效时回退英文，不因旧页面报错阻断菜单。
- 重复注册按 Chrome 的 duplicate 错误视为已存在；其它创建失败只报不含页面内容的诊断。点击时只处理本扩展 ID，并把 Chrome 报告的被点击 tab 传给既有命令路由；无 tab 的点击忽略。
- `createCommandRouter` 支持显式 tab，键盘命令仍查当前活动标签页；因此后台窗口或别处焦点不会让右键翻译跑到错误页面。受保护页面在发送/注入前拒绝，首次缺少 Content 时仍按既有路径注入一次并重试。
- Manifest 新增必需的 `contextMenus` 权限；它只创建菜单项，不扩大站点或主机权限，不读选中文字，不新增 Provider、存储或网络。中英隐私说明同步。设置快捷键区与内置使用文档补充右键入口；README 补充操作说明。
- 版本 0.8.64 → 0.8.65，Manifest/package/lock/README/关于页一致。

## 检查

- `node --test tests/context-menu.test.mjs tests/commands.test.mjs tests/release-gate.test.mjs`：16/16 PASS。覆盖权限清单、菜单属性与本地化标题、重复/异常创建、失效上下文回退、只路由被点击 tab（不查活动页）、显式 tab 与原键盘路由、受保护页拒绝、失败上报；原有命令测试保持通过。
- `npm run typecheck` PASS。
- 本地化生成 1596 键；`node scripts/legal-assets.mjs --generate` 后隐私页与 Markdown 一致（首次构建因未重新生成而失败，生成后通过，未放宽审核）。
- `npm run commit:prepare`：0.8.65，暂存构建 tree `9ff879722b80ce5185b09b7bf00ee6c85a7ae24d`，146 文件，资源与许可审核通过。
- 实际安装包临时 Chromium smoke：0.8.65 加载成功，构建包声明 `contextMenus`，设置页右键提示可见，后台 `runtimeErrors` 为空。截图与 JSON 在忽略目录。

## 未验证与边界

- **原生右键菜单外观与实际点击为 NOT RUN**：headless Chrome 不渲染系统菜单，无法用真实鼠标选择该项；单元测试覆盖菜单属性、点击路由和翻译命令，真机点击仍需人工或在有界面环境复核。
- 未运行完整 `validate`、全部 E2E 或真实 Provider；本次改动只触及后台注册/路由和文案，已有 Content/Provider 行为未改。
- 新增权限会改变商店权限清单，需在下次上传时同步审核说明；本轮未操作商店。用户已有未提交的商店文档未覆盖。

自查：没有自动授予站点权限；右键只在用户点击后走既有翻译，遇到未授权站点仍由原有流程请求访问；不记录页面文字；失败不产生未处理 rejection；版本和隐私/权限描述与实际包一致。
