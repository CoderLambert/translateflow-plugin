# 交付记录：Pages、商店材料与候选包（0.8.61）

基线 `7559d9dfe5f41ddc5b9d51e9b3a21dd131fdea19`，分支 `feat/unified-reading-polish`。用户要求完成可代理的发布准备，并明确授权将公开隐私与支持页面放 GitHub Pages。本轮只推送专用站点分支；没有推送产品分支、合入 main、创建软件 Release 或上传商店。

## 已交付

- 公开站点：https://coderlambert.github.io/translateflow-plugin/；英文政策 privacy.html、中文政策 privacy-zh-CN.html、支持 support.html、完整许可 third-party.txt、自写公开阅读示例 demo.html。
- 专用 `gh-pages` 部署提交 `676a2dff102c15baa46dc5cfaf08c060da2cc4f2`；Pages 源为该分支根，built、HTTPS enforcement true。8 个公开文件/资源 HTTP 200，字节 SHA-256 与本地生成文件逐一相同；桌面/手机实际浏览确认链接和无横向溢出。网站没有分析脚本、表单或外部嵌入资源，单独披露 GitHub 托管请求处理。
- 可维护的 `build-pages.mjs` / 显式 `publish-pages.mjs --publish`；源复用既有政策 Markdown，不上传整个 docs 或开发目录。Pages 本身使用 GitHub 内建部署，不改变日常手动质量工作流。
- `docs/store/listing.md`：中英文名称、简介、详细介绍、费用/兼容边界与可填写链接。
- `docs/store/dashboard.md`：用途、权限理由、数据分类解释、远程代码说明和审核操作；不伪造审核账号，不把 LAN 模型当审核员可访问服务器。
- `docs/store/service-scope.md`：六个现有网页服务的实际端点、自动池、需核实条款。第一方 API 资料工具访问受网络地址保护阻塞，未绕过；没有凭客户端许可或请求成功宣称已获服务方公开使用授权。
- `docs/store/owner-checklist.md`：账号验证、图标权利、服务范围、审核服务/凭据和最终提交等仅剩维护者事项。
- `dist/store/`：约 1 MB 的公开候选 ZIP、SHA256SUMS、逐文件 package-manifest.json、128px 商店图标、中英文材料副本、8 张真实 UI PNG（每种语言4张，1280×800）、截图来源 JSON 与 HTML 浏览页。

截图中的网页和文本译文来自此前获用户授权的本地 LM Studio / hy-mt2-7b 与公开演示文字；没有付费 Provider、私人页面或私有浏览器数据。设置截图是实际界面与隔离演示配置，不冒充已连接某云账号。主 Agent 复核网页译文、文本结果、指南与配置截图，未使用模型生成的伪 UI。截图本身不证明所有模型/所有网页质量。

## 验收发现与修复

1. 完整检查发现4项 Node 失败：一个真实的旧注册列表/新源码启动兼容问题，以及主题断言、生成副本、资源顺序的过期假设。旧标签页缺新 Quick Control helper 时改为明确提示刷新，不再让 Content 根初始化因缺模块抛错；不假装旧页可运行新完整 UI。校验未绕过旧 immutable script mapping，旧脚本列表仍冻结不变。
2. 正式构建工具升级后，旧 Reading classic 副本需要按唯一源码重新生成。按现有生成脚本更新，没有直接手补 minified 副本。它们不是现代 WXT 的第二套 owner。
3. 19项 Vitest失败涉及原生 select 操作和旧文案。改为点击实际 combobox/menu，保留草稿、保存、取消、权限、晚返回与请求次数断言；隐藏模型移除重复 aria-label，使名称由可见控件负责。独立 helper 只用原生 option 值寻找用户可见选项，不通过隐藏赋值绕过 UI。
4. 真实浏览器发现长设置页菜单被滚动关闭：原 scrollIntoView 会影响页面，点击前浏览器自动滚动也可能触发关闭。改为只滚动菜单内部，滚动时让 portal 跟随仍在视口内的控制器，控制器离开视口才关闭。实际平台保存、测试、默认切换、重载及选中同项均已通过；不靠 force-click 或 sleep 放行。
5. 悬浮球主按钮使用语义前景色；卡片触发器按当前主题的卡片背景/正文色成对校验，避免测试强制旧外观。

## 实际执行与证据复用

原始日志：Git 忽略目录 `docs/task-execution/local/store-launch-preparation/`。

- `npm run validate` 首次执行 **FAIL**：Node 2138 中 2134 PASS / 4 FAIL，链停在 Node。不是“一次 validate 全绿”。首轮 check/i18n PASS。
- 随后补完未到达的阶段：typecheck 初次 PASS；Vitest 首次93中74 PASS /19 FAIL。针对失败文件适配后，5文件43 PASS，其中包括此前失败项；最终菜单实现变化后相关2文件16 PASS。未改的其它文件沿用首次 PASS。合计93个现有 Vitest 用例的有效结果已收口，不把失败日志改成 PASS。
- 4项 Node失败在相关8用例中复验；最后生成 classic 副本后该单项再次 PASS。其余2134有效 PASS不重复执行。
- 最终 `npm run check` PASS：874 JS/TS/TSX、1580 i18n keys；最终 `npm run typecheck` PASS。后续只增加自包含浏览器验收步骤、打包脚本和文档；`node --check e2e/store-preparation.spec.mjs`、Python源码 compile 与实际打包成功，未改变产品逻辑。
- `npm run commit:prepare` 最终 PASS，0.8.61 公开包145文件，构建内置 Manifest/资源/许可覆盖审核通过。准确构建 tree `eb8e72bbcc639855f2a4dfff01ba46d642e5d869`。
- 最新实际包 E2E fingerprint：`e86568f6575437361184518fcd7b22778215b4137095671ce5d85f168df86dc8`，145文件、3,409,336字节。
- 核心浏览器证据：最终菜单/Provider/Popup 7 PASS（browser-menu-accepted.log）；最终指南、政策入口和双语截图1 PASS（browser-guide-final.log）；最终新安装/配置/首次翻译/重启/缓存零新请求1 PASS（browser-fresh-install-accepted.log）。
- 输入翻译三场景在本轮初始包已 PASS，后续变化只触及 Popup/Options 菜单及旧注册兼容，不改变输入窗口合同。复用其输入/复制/调整/取消/会话/IME/窄屏结果，不重复跑。
- 真实本地模型1 PASS（browser-real-final.log）：公开自写 demo 页可见中文译文，恢复缓存无新增真实 Provider fetch；邮件场景文本翻译完成、双语UI会话恢复、mock调用0。该证据绑定同版本前一个菜单修复包 `c34a124e7dff6e8307cc8f63ed6ed1a106dbc86644a223368262dfca46b6a33c`；随后只改独立PopupSelect，页面Content与原生输入窗口实现未变，沿用相关结果；不改写历史包绑定。
- 首轮浏览器12场景5 PASS /7 FAIL，菜单修复中间也有未通过尝试，全部日志保留。新安装测试最初遗漏“通用设置选择/保存AI方式”，后按真实新用户路径完成，不将选默认服务误当自动切换翻译方式；第二次步骤定位用错 radio value，改为实际可访问名称后通过。这些失败没有通过放宽业务断言掩盖。
- 完整依赖审计的0告警结果复用上一轮；此次仅改版本字段，依赖版本/锁定解析未改变。

本轮为主 Agent 自查，没有自动启动独立模型审核。全量 validate 结果以分阶段修复和有效证据组合归档，不声称重新跑过单命令全绿，也不声称所有E2E/真实YouTube/Chrome102/商店升级已完成。

## 候选包

`python3 scripts/package-store.py` 从已测试 dist/extension 原样打包，逐文件拒绝symlink/私有路径并核对ZIP读取字节，不重新编译；不是把仓库压缩上传。

- `translateflow-0.8.61-candidate.zip`
- 1,027,968 bytes；145 files
- ZIP SHA-256：`06a5e43f4a4070051c8ac2bb34600ae952961cf2d34e0094a4acd571cbf1f518`

提交本轮源码后重新执行同一打包器，更新 package-manifest 的源码HEAD与staged tree绑定；ZIP为确定性打包，同样字节得到同样hash。构建之后新增的站点/文案/测试/打包工具不属于扩展编译输入，不以文档归档触发另一轮构建或测试。

## 仍未完成／授权边界

没有商店身份、支付或公开分发授权的替代能力。没有申请第三方网页服务许可；其适用条件仍待核实。提供的图标权利来源需维护者确认。真实YouTube受先前登录/反机器人限制的证据不变；Chrome102最低版本和商店同ID版本升级仍未验证。浏览器重启数据保留不等于商店更新验收。未使用真实付费服务或审核账号。

本任务保持 reviewing，未冻结 main候选、未合入main；Pages部署单独完成。候选ZIP是可审核的准备产物，不是已获批准的正式发行版。最终维护者可依 owner-checklist.md 完成其本人事项后决定 Unlisted 提交。
