# 字幕性能与资源生命周期修复验收

**本地实现及定向验收 PASS；已替换原安装目录，尚未提交、推送或合并。真实 YouTube 播放性能验收 NOT RUN。** 本次解决前轮性能审查确认的 2 项 P1、1 项 P2，不作“所有页面永久零泄漏”的保证。

[打开带截图的 HTML 报告](../../task-execution/local/subtitle-resource-lifecycle/report.html)（自包含本地文件，截图明确标注合成播放器）。

## 候选与交付

- 分支：`feat/ollama-local-cloud-connections`；基线 HEAD / origin/main 均为 `d465e933cef10e2a6ae9320837b2925b816dc895`。本轮已 fetch，未合并其它提交。候选是该隔离工作树的**未提交文件**，不能用基线 SHA 冒充候选。
- 逐文件候选指纹：`docs/task-execution/local/subtitle-resource-lifecycle/inputs.json`；安全独审绑定见 [main-bridge-review.md](main-bridge-review.md)。已保留前序 Ollama 配置及“译”字居中改动。
- 实际验证/安装包：`dist/extension`，版本 **0.8.44**，131 文件 / 3,084,866 bytes，tree SHA-256 **`c282db163db380c6bc3a7faffcb9c0e1b5eeb1b3ff22253b1c954ec3c6a0e036`**。
- 已以暂存复制、指纹校验、旧目录备份和重命名替换交付至 `/home/lambert/githubRepos/lambert/translateflow-plugin-youtube-reliability-20261021/dist/extension`；安装后指纹一致。旧包 `d1205a2e…` 保存在同一 dist 下 `.extension-before-resource-fix-1792566337496`。安装日志为原始证据目录 `install.json`。

## 修复及证据

| 原问题 | 本次实现 | 回归位置 |
| --- | --- | --- |
| P1 资源 Observer 随 HELLO 累积 | `youtube-main-bridge.js:275` 单实例安装，`:379` 停止时 disconnect；排队回调检查 active | `tests/youtube-bridge.test.mjs:118`，100 次 HELLO；新增 MV3 lifecycle 场景 |
| P1 外部 DOM 引发 TRACKS/字幕整链刷新 | `youtube-main-bridge.js:141` 轨道/视频元数据签名去重；`:354` 过滤播放器外更新，保留播放器内缓存切轨检测；`sources/youtube.js` 不再强制刷新未变 TRACKS | `tests/youtube-bridge.test.mjs:135`、`:211`；40 次原生 Chromium DOM 更新探针；MV3 场景 |
| P2 off 仍采集/全轨扫描 | `sources/youtube.js:305`、`:345` off/stop 解绑采集事件、MO、视频事件、备用 TextTrack、边界 timer，清空 cue/轨道引用并恢复原字幕；`:134` MAIN 有效时停掉备用 TextTrack，失败可恢复；`source.js:110` 预建 cue 时间索引 | `tests/subtitles.test.mjs:437`、`:460`、`:494`、`:504`，重叠/空档/反向 seek/倍速及长轨道读取计数 |
| 迟到安装重新挂上资源或错误停止新实例 | `sources/youtube.js:313` 安装版本与文档 bridge owner 检查，过期完成只在没有新 owner 时清理 | `tests/subtitles.test.mjs:474`、`:484` |
| 未完成响应/XHR 异常保留自有资源 | `youtube-timedtext.js:182` 有界、可取消的响应副本 reader；MAIN 关闭、视频/轨道变化时取消自有读取；`youtube-main-bridge.js:216` 在 XHR 完成、open 重用、send 抛错、停止时解绑自有监听 | `tests/youtube-bridge.test.mjs:159`、`:175`、`:187`、`:199`、`:229`；独审另验证原始 Response 仍可完整读取 |

`source.js` 的索引复用既有 5 条/12 秒预翻译合同，保持 cue 原顺序和重叠语义；不改变 Provider、缓存、配置、取消合同或字幕调度策略。`sources/youtube-dom.js` 只拆出原生字幕 DOM 读取/可见性恢复，替换节点及时归还并释放引用，没有增加监听器。MAIN 辅助读取使用既有 2 MiB 上限，不主动请求 URL，不中止 YouTube 原始请求。未改权限、存储 schema、消息协议或引入 FluentRead/GPL 源码。

off 时字幕**采集**资源释放；播放器底部“译”入口与 renderer 的轻量控制栏重建观察继续存在，以便用户开启字幕。这是活动 UI 的必要绑定，停止 controller 时仍按现有 renderer 生命周期销毁，不能把 off 表述为整个扩展在该页面零监听器。

## 实际执行

| 命令 | 结果及边界 |
| --- | --- |
| `node --test tests/youtube-bridge.test.mjs tests/subtitles.test.mjs tests/subtitle-pipeline.test.mjs tests/subtitle-controller-currentness.test.mjs tests/subtitle-request-lifecycle.test.mjs tests/constants.test.mjs` | **PASS 101/101**，退出码 0。覆盖源、bridge、结果身份、取消、缓存准备、lookahead、错误恢复及模块顺序；非真实 YouTube |
| `npm run check` | **PASS**，退出码 0；827 源文件、架构及 i18n 检查 |
| `npm run typecheck` | **PASS**，退出码 0 |
| `npm run build:extension` | **PASS**，退出码 0；默认 WXT 包及安装包检查 |
| `TF_E2E_ARTIFACT=dist/extension TF_TEST_WORKERS=1 npm run test:e2e -- e2e/youtube-subtitles.spec.mjs e2e/subtitle-pipeline.spec.mjs e2e/subtitles.spec.mjs e2e/subtitle-resource-lifecycle.spec.mjs --retries=0` | **PASS 17/17**，退出码 0，26.2 秒；真实 Chromium/MV3、生产包测试副本、合成播放器/mock Provider，不使用账号或真实 key |
| `node docs/task-execution/local/subtitle-resource-lifecycle/probe.mjs` | **PASS**，退出码 0；隔离 Chromium 153.0.8010.12 运行实际源码模块，原生 PO/MO，合成轨道/播放器 |
| `git diff --check` | **PASS**，退出码 0 |

新资源 E2E 先对旧已交付包 `d1205a2e…` 执行，**RED：期望 PO=1，实际=2**；新包同一测试 GREEN。Node 回归也先复现 Observer 累积、off timer/监听残留、迟到安装、响应读取及缓存切轨问题，再修复。初次静态检查因源码长度和固定 MAIN 摘要失败，已拆分 DOM/纯 cue/响应读取职责，并按规则完成独审后静态登记摘要；未放宽门槛。

原始日志：`docs/task-execution/local/subtitle-resource-lifecycle/{node,check,typecheck,build,e2e,probe}.log`；当前 E2E 输出目录 `test-results/run-1792566262245-197d8ecb-3e24-4827-bb3c-b3c375734ce2`。源码及包输入未改变后，没有重复执行全仓库测试。既有 Ollama 真实浏览器 403 等前序限制没有被此次 PASS 覆盖。

## 隔离探针对比

原始旧结果保留于 `docs/task-execution/local/subtitle-performance-review/probe-result.json`；新结果另存本任务目录，包含逐文件源码指纹。

| 操作/指标 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 初次启动/20 次模式变化后的活动资源 PO | 2 / 22 | 1 / 1 |
| off 后外部更新引发字幕快照 | 1 | 0 |
| off 并 stop 后活动资源 PO | 22 | 0 |
| 40 次外部 DOM 更新：TRACKS / 字幕快照 / 业务 selector | 40 / 40 / 400 | 0 / 0 / 0 |
| 15,000 cues 的单次 refresh 平均 ms | 0.7675 | 0.0090 |
| 同规模 P95 ms | 1.0 | 0.1 |

每组 20 次预热、200 次刷新；只测源模块稳态，不含 UI、Provider、视频解码、索引首次构建。浏览器计时精度有限，小于 0.1 ms 的数字不可当精确 CPU 成本或倍数承诺。MV3 另验证 20 次原文/双语切换不增加 PO、5 轮关闭/开启后 PO 反复 0/1、关闭后原 fetch/XHR hooks 恢复、视频引用释放、原字幕可见，以及 off DOM 更新不调用 Provider。

## 使用与剩余边界

请在原扩展详情点一次“重新加载”，然后**刷新当前 YouTube 页面**再测试。旧版本已经失去引用的孤立 Observer 无法由新代码逐一找回；刷新会销毁旧页面上下文，保证实际运行的是新包。

**NOT RUN**：更新后真实已登录 YouTube 连续播放的 CPU/内存/FPS 对比、长时间堆快照与真实 DeepSeek/Chrome 本地翻译验收；本轮未操作用户当前播放进度或设置。单元测试、合成 MV3 和原生资源计数证明确认缺陷已修复，不等于所有真实视频的长期性能保证。任务状态为 reviewing，等待用户实际重载验收，不把本地未提交修复标为 main 已合入。
