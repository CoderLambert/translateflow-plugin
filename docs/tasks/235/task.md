# [Reading Loop][RL-05][P1] React 学习中心、历史详情与记录授权/删除/导出界面

历史引用：[#235](https://github.com/CoderLambert/translateflow-plugin/issues/235)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

历史有限组件准备 a4527dae082bbb04d46e0f7caa6e64c83ddeb759 未推送；当前 Git 对象库找不到此对象，恢复来源 UNVERIFIED，不宣称已经可用。#233/#248/#249 已合入 main；2026-10-03 用户授权开始本地实现与验收。历史组件对象不作为实现输入。

## 执行卡
产品Parent #229；平台依赖#191；Release A。完成硬依赖：**#233 + #248 + #249**。L2 UI实现；授权/导出/异步一致性由L3独立reviewer审核。主写rl-ui，L1仅限定文案/合成fixture。保留真实执行状态。

2026-10-02修订：直接WXT+React+TypeScript，不先写原生学习中心；消费#232.C1–C8修订后的protocolVersion=2和#233真实repository。有限组件准备仅在#232新DTO及#246/#247/#249工具/语言基础就绪后由coordinator分配；未满足全部完成依赖不能标整卡ready/完成、不能用mock替代产品验收。可与#234隔离并行，无相互代码硬依赖。

## 用户结果
从Popup或查询卡进入独立学习中心，按最近/页面/基本搜索找回真正查过的词、译文和问题/答案；可开启/暂停、排除站点、删除、导出，不需要理解数据库。

## 实现步骤
1. 入口：entrypoints/learning-center/index.html → 唯一运行时路径learning-center.html；src/learning-center/按client/views/components拆分。普通unlisted扩展标签页，不覆盖history/newtab，不新增sidePanel权限。Popup只打开该页，不接收完整历史。
2. UI：复用sage/beige变量和#249 en/zh_CN、必要Button/Form/Empty/Error组件；从真实界面提取，不先建空组件库/路由平台/全局Store。React不进入Content/MAIN/Worker/后台；纯record-view格式化可共享，React组件不可跨入Content。
3. 列表：消费#233有界RecordListItem，一次分页得到预览/短上下文/问答数/时间，不为每条发get-record，不下载全部历史再搜索/分组。最近/按页/基本literal搜索使用后台稳定cursor；旧搜索响应按request generation丢弃，cursor失效刷新有提示。
4. 详情：用户打开后才按需get-record，显示当时原问题/完整完成答案/词义或译文/来源/对应source，标明历史快照。模型/pack诊断折叠。断网、词典卸载、Provider未配置仍可读；不重查词典/取MDD/发AI。大detail分批展开/渲染，不因列表滚动加载所有问答。
5. 页面导航：刷新/后退/深链仅使用非敏感recordId；ID不是权限，后台仍检查。无效/已删除ID有返回列表退路。A的“打开页面”仅使用safeReturnUrl，不伪称精确定位；#238接通后才启用精确回访。

## 记录授权与站点控制（必须接真实接口）
- 首次从真实查询进入或主动访问学习中心，展示Enable/Not now；明确本地保存范围和可删除/导出。只有本页受信任事件调用set-recording，Content没有修改全局授权权限。
- 开启成功后说明“之后的查询会记录；原网页有效结果卡可点保存本次结果”。不承诺返回前的所有查询已保存、不在本页重新抓原网页。当前卡的保留/失效/保存完全归#234；不得将Selection controller导入React页面。
- 暂不不影响查词；暂停保留历史并作废在途旧写token；恢复不补写旧操作。授权状态依commit ack，不在mount/useEffect中自动开启。
- 不记录本站使用get/set-site-recording与list-recording-exclusions，单origin patch和expected revision。safeReturnUrl=null也能按repository提供siteKey设置；清空记录后仍能管理排除列表。不要复制到chrome.storage另一份设置，不请求新host permission。
- 单条/按页/全部删除明确范围；批量删除需确认。清记录不清cache/词典/排除配置；暂停/本站标记开关也不等于删除。#237负责标记授权，不在A画可用的假标记开关。

## 分块导出UI
- 用户主动点击后调用#232.C3的export-start→有背压逐块next→EOF→finish。按sequence去重，错误/缺片/版本变化/页面退出时cancel并丢弃临时片段，不重新调用Provider。
- 单块完整消息≤1 MiB；最终仍是版本化JSON。收集有界文件片段生成Blob，不再JSON.parse/stringify一份完整巨大对象；不将整包数据塞到React state。记录文件字节/进度，用户可取消，忙碌期间避免自身自动详情读取更新viewed造成无意义导出失效。
- 只有finish确认后发起本地下载并及时revoke Object URL。显示“已生成/已发起下载”，没有downloads权限/文件系统确认时不能宣称用户已成功保存文件。浏览器保存对话框被取消与应用导出取消不是同一可观测状态。
- 导出期间记录变更提示“内容已变化，请重试”，不擅自暂停所有记录、不锁死其他标签。不承诺删除已下载的副本；导出含私人内容要警示。无后台临时文件/云上传/新增downloads权限。

## 异步、安全与可访问性
薄类型化client消费唯一validator，不复制schema，不直接IDB/Provider。监听受限invalidate，React StrictMode重复mount/unmount正确清理订阅/请求，不能重复授权/保存/导出。删除后的迟到detail/list不能恢复已删除内容；后台断线时旧详情标不可确认，恢复后重新授权读取。

所有网页/词典/AI内容按不可信文本或受限安全格式渲染；禁未净化innerHTML、危险scheme、远程favicon/图片自动加载。private上下文后台拒绝普通历史，不只遮UI；凭据不进入URL/state/截图。

必须有loading/empty/no-results/error/quota/paused/excluded/not-saved状态和可操作退路；键盘、Escape/焦点返回、IME、窄屏/缩放、暗色/reduced-motion与双语实际测试。uiLocale不改变targetLanguage/cache/prompt/已存artifact。

## 文件所有权与生产接线
组件/页面/client/专测由本任务拥有；package/lock、WXT module、Popup入口、router/constants、产物映射、global tokens由coordinator单写随PR交付。#248实际WXT产物包含页面/chunk，不能仅源码里存在入口。禁止第二套LearningRecord/workbench服务、SRS/收藏/完整chat/全量旧UI迁移。

## 验收
- Popup/查询卡→学习中心，真实查询创建记录，重开/刷新/回退、最近/按页/搜索/详情均可用。
- 列表请求计数证明无N+1；预览与context同source，同词不同语境不合并，历史只读零Provider/零词典资产读取。
- Enable/Not now、返回原网页显式保存、原卡已关闭、暂停/排除/恢复、单条/页面/全部删除全部接真实后端。
- 大导出、超过1 MiB单record、Unicode/转义、重复块、变更/取消/worker退出/finish交付边界可操作且不假成功。
- 跨页/private/恶意文本、搜索竞态/StrictMode/删除迟到响应不泄漏或重复写入。
- 实际WXT包和React依赖闭包审计，不带fixture/docs/私有语料，React不进入非UI入口。

运行当前npm run validate（含已落地TS/Vitest与原Node）、组件交互测试、加载真实WXT包的Chromium E2E；合成截图/命令/请求计数/产物hash绑定准确head。纯seed/mock不可代替全部创建链路。独立review后按CONTRIBUTING更新，Release A由#236认定。
