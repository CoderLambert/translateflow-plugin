# Chrome 商店发布准备

本文件区分已落地的准备工作与仍需证据的发布条件。正式发布仍需要独立授权，不能把本地编译、测试或清单文本当作已通过商店审核。

## 本地材料与生成

- 隐私政策：[中文](PRIVACY.zh-CN.md)、[English](PRIVACY.md)。支持：[帮助与反馈](SUPPORT.md)。设置 → 关于可离线打开这三份文档和第三方许可。
- `node scripts/legal-assets.mjs --generate` 将唯一 Markdown 文档源投影成静态 HTML，并从安装的运行依赖生成许可。生成的精确文件进入安装包，不把 docs/scripts/node_modules 整个目录放入包。
- `node scripts/legal-assets.mjs --check` 检查内容与安装依赖版本一致；正式构建同时检查实际编译模块的许可覆盖。WXT npm 包未带 LICENSE 文件，随脚本保存其上游 MIT 原文与来源；这不替代品牌图标或用户词典的权利证明。
- 公开 Manifest 不声明 Native Messaging，开发版单独增加可选权限。开发版和公开版保留相同版本/数据结构；公开版继续拒绝 ChatGPT 订阅实验操作，不删除既有配置。

## 商店用途与权限说明草稿

单一用途：帮助用户翻译、理解和回顾外语网页及相关文本，支持用户自选翻译服务、本地词典和本机学习记录。

Single purpose: Help users translate, understand and revisit foreign-language web content and related text, using their chosen translation services, local dictionaries and on-device learning records.

| 权限 | 当前实际用途 |
| --- | --- |
| storage | 本机配置、服务凭据和会话状态；具体保留和删除见政策 |
| activeTab | 用户主动操作当前网页 |
| scripting | 按功能需要注入/执行扩展页面脚本与 YouTube 桥接 |
| http://*/*、https://*/* | 普通网页上自动启动划词和悬浮控件，以及用户开启的网页翻译。确实是广泛网站访问，不能称为仅访问当前标签页 |
| declarativeNetRequestWithHostAccess | 仅调整扩展发往 Bilibili 指定翻译端点的 Origin 请求头；是否保留该服务应在其使用条件核实后决定 |
| nativeMessaging | 仅独立开发版；公开商店版不声明 |

数据声明应覆盖实际处理的网站内容、网址/浏览活动关联、用户输入、保存内容和认证信息。不能因“无自营服务器”或“只存本机”而填写为不处理任何数据。是否勾选后台每一个分类，须按提交时的字段定义与最终包核对。AI 返回的是数据，不能笼统把调用云端 API 申报为执行远程代码；也不能跳过实际包的远程代码检查。

## 版本与提交规则

- 提交包只来自 `main`，与 `npm run release` 产出的版本同源；不在工作区里临时改代码另打一版。
- 审核期间不因为仓库版本更高而替换上传包：版本号只需相对已发布版本单调递增，文档或工具类提交造成的版本差不需要追平。
- 只有这些情况才立即替换已上传的包：包内缺少文件、`manifest` 声明与实际不符、权限或隐私描述错误、审核方明确要求补交。
- 审核通过并上线后，正常功能更新走新的版本，不必"对齐"已发布版本；上架链接补进中英 README 的「安装」与 Release 说明。
- 本文件与 `docs/store/` 属于仓库材料；对应的商店后台字段（权限理由、隐私声明、测试指引）需要同步更新，但不触发重新打包。
- 下载与镜像的版本一致性规则见 `docs/MIRROR.md` 与 `AGENTS.md` 第 11 节。

## 提交前尚未完成

| 工作 | 完成条件 |
| --- | --- |
| 公开政策 URL | 已发布至 [GitHub Pages](https://coderlambert.github.io/translateflow-plugin/)，中英文政策、支持与许可实际 HTTPS 响应已核对；维护见 [PAGES](PAGES.md) |
| 维护者/账号信息 | 维护者已明确确认完成；代理未读取商店账号，按维护者确认记录，不重复列为待办 |
| 免费网页服务 | 对 Microsoft/Bilibili/Google/Volcengine/Youdao/Tencent 逐项确认用途许可、政策、限流和目标网络稳定性；选择器可用和开源客户端许可不能替代服务方许可。不自动宣称已获准，不擅自删除用户现有选择 |
| 供应商品牌和图标 | 维护者确认图标为 AI 生成；保留生成来源和适用工具条款即可，不因 AI 生成新增认证要求。服务名称不得暗示官方合作 |
| 最低版本 | 当前声明 Chrome 102；补实际最低版本兼容证据或按测试结论调整声明。Chrome 本地模型另有浏览器/硬件/语言要求，不能将 Chrome 102 声明理解为所有模型能力可用 |
| 发布候选验收 | 冻结准确候选，完成一次现有完整检查与核心流程浏览器验收，确认原生/自定义选择器测试已随真实 UI 更新；本轮针对性回归不是完整发布 gate |
| 真实服务与页面 | 维护者已确认功能本地测试完成，记为维护者人工验收。代理历史真实 YouTube 登录阻塞保留原记录，不重复要求维护者逐项证明，也不改写为代理实测 PASS |
| 安装与升级 | 干净 profile 完成首次成功；同一扩展 ID 的版本升级保留配置、凭据、词典、缓存和学习数据。商店与原 unpacked ID 不同则不能假定数据自动转移 |
| 商店图文 | 中英文文案、后台填写说明见 [docs/store](store/listing.md)；实际 UI 截图、候选 ZIP/hash 在本地 dist/store。发布前按最终包与后台要求复核 |
| 发布包 | `python3 scripts/package-store.py` 从已构建公开包生成 ZIP、逐文件 hash 与 SHA256SUMS，不重建或附带源码；候选不等于可跳过剩余条件直接上传 |

## 审核说明准备

1. 指明公开版不需要 Native Host、ChatGPT 账号、命令行或开发者模式。
2. 从全新安装演示一种可用路径：打开设置，选择翻译方式；AI 路径配置服务并测试，在线路径明确同意；浏览公开示例文章，主动翻译，演示显隐和取消。
3. 说明 AI 文本翻译及字幕的服务依赖；不要让审核员以为免费网页方式自动覆盖这些功能。
4. 核对缓存命中零服务请求、缺失不自动补翻、失败有恢复入口；检查权限拒绝或撤销时不会误显示成功。
5. 审核所需凭据只通过商店专用测试说明渠道提供受限测试凭据，不写进包、仓库或公开文档；是否提供由维护者决定。现阶段不虚构测试账号。
6. 初始采用 Private/Unlisted 的小范围验证可控制曝光，但仍必须满足正常商店审核。公开推广前补反馈渠道和保留数据的向前修复预案。

## 官方依据

- [隐私字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [用户数据 FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [最小权限](https://developer.chrome.com/docs/webstore/program-policies/permissions)
- [商店图片](https://developer.chrome.com/docs/webstore/images)
- [发布流程](https://developer.chrome.com/docs/webstore/publish)
- [分发与测试](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
