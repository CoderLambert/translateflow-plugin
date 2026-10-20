# YouTube 字幕修复测试报告

日期：2026-10-21。结论：**仓库校验及合成 Chromium/MV3 流程 PASS；已登录 Chrome 用户配置的真实 YouTube 播放及原字幕路径 PARTIAL PASS；本次候选包在隔离真实页面中加载 PASS，但该 profile 未播放、无字幕，因此候选包的真实字幕路径仍 NOT VERIFIED。**

测试针对用户手测包，使用 branch `fix/youtube-subtitle-reuse-20261021` 的未提交工作树；Git HEAD 仍是基线 `bf37935f04ef6271ef8d3b5780142ac8d65c3600`。本次没有建立新提交或声称有冻结 candidate。

## 测试对象

- Manifest V3 解压目录：[dist/extension](../../../dist/extension)（生成产物，未入库）
- 版本：0.8.43
- 文件：131 个，3,067,635 字节，无内置词典资源
- E2E 文件清单摘要：`520fc1aaf15e6eac1c6953448d17817eb135f153e3e76a97218cef9fe7ab6eff`
- E2E 启动日志为每个场景打印相同目录及摘要；运行后重新扫描的文件清单摘要一致。
- 工作树源码/测试输入摘要：`d953084baa69d26f58ba464d4e1ce4cb34b51a32f1695ea85567e2fcc9318dea`（23 个文件；详情在本地忽略文件 `docs/task-execution/local/youtube-subtitle-reuse-v1/working-tree-evidence.json`）
- 环境：Node `v24.22.0`，npm `11.19.1`，Playwright Chromium `153.0.8010.12`

## 执行命令和结果

| 命令 | 结果 | 记录 |
| --- | --- | --- |
| `npm run validate` | PASS，退出码 0；静态检查通过、Node 测试 **2025/2025**、严格类型检查通过、Vitest **14 个文件 / 80 项通过**，默认 WXT 安装包重建成功 | 本地忽略日志 `validate-user-requested.log` |
| `TF_TEST_WORKERS=1 TF_E2E_ARTIFACT=dist/extension npm run test:e2e -- e2e/youtube-subtitles.spec.mjs e2e/subtitle-pipeline.spec.mjs e2e/browser-basic-translation.spec.mjs --retries=0` | PASS，**16/16**，退出码 0；1 个 Chromium worker、0 retries；全部场景使用上表安装包摘要 | 本地忽略日志 `e2e-user-requested.log` |
| `inventoryArtifact('dist/extension')` | PASS；运行后重新计算摘要、文件数、总字节与 E2E 载入前一致 | 本地忽略文件 `manual-test-artifact.json` |
| 隔离 Chromium 访问真实 `https://www.youtube.com/watch?v=qp0HIF3SfI4` 并启动播放/字幕 | BLOCKED；扩展、页面、播放器和字幕按钮已加载，TranslateFlow 字幕 host 已挂载；但播放未开始、播放器 caption track metadata 不可读、timedtext 请求为 0，未观察到原生字幕或 TranslateFlow 原文 | 本地忽略日志 `live-youtube-user-requested.log`、`live-youtube-diagnostics.log` |
| 有头 Playwright Chromium 加载候选包 `dist/extension`，访问真实 `https://www.youtube.com/watch?v=qp0HIF3SfI4` | PARTIAL PASS；候选包确实加载到真实 YouTube 页面且字幕 host 已挂载，但无登录态的隔离 profile 中视频 `readyState=0`、`currentTime=0`、`paused=true`，状态为“字幕不可用”，原文/译文为空；字幕获取 NOT VERIFIED。此 profile 的 UI 最终报告模式 `bilingual`，预置 `chrome.storage.local.youtubeSubtitleMode=original` 未反映到 UI，属于测试准备未成功。未记录 Provider 请求计数 | 临时 profile 有头 Playwright 会话输出；profile 已关闭并清理 |
| 当前已登录 Chrome 用户配置打开同一真实 YouTube 视频并播放 | PARTIAL PASS；页面真实播放中（当前探针 `paused=false`、`currentTime=462.73s`、`playbackRate=1`）；TranslateFlow host 已挂载、模式为 `original`，当前原字幕 cue 为 `to vote for you, or buy something from you,`，译文节点为空，状态提示“翻译不可用——原字幕仍保持可见”。此前截图中出现的中文行来源不明，且同页有 `fluent-read-selection-translator-container` 元素，不作为 TranslateFlow 译文通过。活动扩展版本无法核对，因此此证据绑定当前已登录配置，不绑定候选包 | 本会话 CUA 页面 DOM/辅助树快照及播放器截图；没有持久化原始浏览器日志 |

Chromium 测试使用隔离的临时 profile 和扩展副本。YouTube 流程在本地合成页面验证双语字幕、Provider 失败保留原文、配置变化更新目标语言、清缓存撤销旧译文且不主动重译、字幕回看与缓存身份；Provider 为仓库 mock。其他 11 项覆盖现有浏览器基础翻译/本地词典路径。页面和翻译服务均不是在线真实服务。

## 真实 YouTube 页面跟进与证据边界

用户指出应使用真实页面验收后，本轮在当前已登录 Chrome 用户配置中直接打开并播放了 YouTube 页面，而不是继续把合成 Chromium 结果当作真实站点验证。页面标题为“西蒙·斯涅克：伟大的领袖如何激励行动”，地址为上表视频 URL。最新 DOM 探针观察到 `currentTime=462.73s`、`paused=false`、TranslateFlow host 已挂载、模式为 `original`，并读取到当前原字幕 cue；译文为空。随后也用有头 Playwright 临时 profile 加载了准确 `dist/extension` 并访问同一真实 URL，证明候选包能注入页面，但该 profile 没有登录态且视频未开始，未获得字幕。

已登录配置的实播结果证明该配置中活动实例的播放器接入、播放期间原字幕路径有现场证据；它不绑定到本报告构建的 `0.8.43` 包：浏览器不允许自动化打开 `chrome://extensions`，所以无法核对扩展版本或包指纹。候选包虽在另一个有头真实浏览器中加载成功，但该临时 profile 无登录态，视频保持 `readyState=0`；用户也指出该视频可能需要登录。现有证据不能把“未播放”的唯一原因归结为登录要求。该临时测试试图预置原字幕模式但 UI 仍显示双语，因此没有把它当作 Provider 零调用证明。

已登录页面截图出现中英两行，但当前 TranslateFlow 模式为“原字幕”、译文节点为空，且同一页面检测到 FluentRead 的 DOM 元素，故不能将中文行作为 TranslateFlow 实际翻译结果。页面外后台请求未被仪器化记录，不能断言 Provider 请求计数为零。已登录页面保持播放，字幕模式保持“原字幕”供用户检查。

本次真实站点证据为会话内 CUA 页面状态和播放器截图，未另存为仓库文件。前一次隔离/headless 浏览器未播放成功的阻断记录仍有效，但已由上述当前 Chrome 实播观察补充，不再代表唯一真实页面证据。

## 未覆盖内容

- 当前已登录 Chrome 用户配置的真实 YouTube 页面已观察到播放、TranslateFlow 控件及原字幕 cue，但扩展版本未绑定到候选包；隔离候选包的真实页面加载通过但未播放。真实轨道切换、SPA 连续切视频、倍速/seek/暂停和全屏/控制栏重建：**NOT VERIFIED**。
- 真实 AI Provider、Chrome Translator API 的真实翻译结果：**NOT RUN**；本次没有主动切到双语模式，自动化浏览器用例使用 mock/fixture。截图中的中文行来源未确认，不能作为翻译通过证据。
- 刷新或重启浏览器后的真实账户配置、缓存和授权状态：**NOT RUN**。
- `npm run validate` 中的体积审计报告 #245 平台代码 advisory：2,257,401 / 1,576,595 字节，超过 advisory 预算 680,806 字节；命令仍以退出码 0 完成。该告警需要作为现有体积状态看待，不能算作功能测试失败，也没有在本任务中修改预算。

这份报告证明的是当前源码构建出的包通过仓库自动化回归。发布或声称真实 YouTube 兼容之前，仍需针对真实站点验收字幕获取、切轨、seek、倍速和全屏行为。
