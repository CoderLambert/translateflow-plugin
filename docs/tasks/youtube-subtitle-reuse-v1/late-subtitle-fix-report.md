# YouTube 字幕迟到、闪现与底部入口修复报告

日期：2026-10-21。结论：PASS WITH LIMITS。针对用户反馈的视频片段已有真实页面字幕恢复证据；完整产品升级与发布验收仍未完成。

## 候选与授权

- 分支：fix/youtube-subtitle-reuse-20261021；Git HEAD：bf37935f04ef6271ef8d3b5780142ac8d65c3600，另有未提交工作树修改。没有提交、推送、改 PR 状态或发布。
- 版本：0.8.43。版本号不区分本地未提交包，安装目录为 dist/extension/。
- 最终包 treeSha256：0bae631105e29b4ca83ad83e35f36d97680fc7ee21eb9272419c21e5f6e18e98；131 个文件；3073059 字节。源码 SHA-256 见本地 late-subtitle-candidate.json。
- 保留用户已有 Provider、凭据、本地翻译、DB4、配置和 MAIN 只观察播放器 timedtext 的边界。本轮未扩大权限、复制 FluentRead GPL 源码或新增 ASR。

## 已证实原因与修改

1. 原来只翻译正在显示的定时 cue，额外稳定等待和 Provider 延迟消耗了短 cue 的显示时间。source.js:100 提供未来 12 秒最多 5 条已知 cue；pipeline.js:64 沿用同一队列，当前优先，定时 cue 立即入队。src/content/subtitles/sources/text-track.js:85 保持预取与当前 cue 的 ID 一致。
2. youtube.js:206 曾同时收集字幕 segment 及其 visual-line 父节点，真实页面原文重复。现在按优先级选择首个非空选择器结果。
3. 连续追加 DOM 文字会不断延后请求，完整缓冲区精确匹配又丢弃仍可见的短语译文。pipeline.js:18/55 限制连续追加等待最多 800ms；controller.js:90/126 仅在完整原文短语仍可见时接受、保留译文，滚出后清空。定时 cue 的时间/身份检查不放宽。
4. seek 取消沿用既有 transport 所有权，结束前不启动替代执行；配置/模式/视频/轨道变化继续撤销旧结果。未另建 scheduler、缓存或并发预取执行器。
5. 用户否决顶部设置条。renderer.js:82/99 改为底部齿轮旁单个“译”按钮，点击展开紧凑设置；支持 Escape、外点关闭、焦点恢复和控制栏重建。preset 选项在挂载时复用 rebuildPresetSelect 正确本地化。
6. 真实新版 YouTube 的齿轮位于 ytp-right-controls-left 内层。初版按钮插入产生 NotFoundError，导致字幕初始化撤销；已改为插入齿轮的直接父容器，并把真实嵌套结构加入失败回归。顶部 sticky 被 overflow:hidden 裁切的方案已撤回。

## 真实页面结果

使用用户已登录的 Chrome，直接操作 https://www.youtube.com/watch?v=I_oMJk6barY ，没有用隔离 profile 的登录失败代替真实验收。用户截图显示配置为 DeepSeek / deepseek-flash；本轮沿用设置，不读取或输出凭据。

| 观察 | 结果 | 边界 |
| --- | --- | --- |
| 第一轮预取包，11.78–21.51s | FAIL：77 次有原文采样，0 次有译文 | 当时仍走 DOM 回退；这次失败触发后续修复 |
| 核心修复包，210.35–222.43s | 120 次采样，109 次有译文；5 次换句 | 开头约 1.1s 有翻译失败提示，随后恢复；不报告全程零空白 |
| 核心修复包，0.01–21.82s | PASS：196 次有原文采样全部有译文，9 次原文变化 | 另 20 次为空档；无错误提示 |
| 核心修复包，45.02–54.85s | PASS：91/91 次原文采样有译文，4 次换句 | 对应用户截图附近的问题片段 |
| 最终底部入口包 | PASS：唯一原生按钮、开合、Escape、焦点恢复、中文 preset 与译文 | 实测暂停在 183.98s，来源 youtube-timedtext；详见本地 live-chrome-native-result.json 与截图 |

上述核心修复包指 410191967b436747e54a76d7c2e2455b6a331326dbc2fba018f5cb2eba89691f。后续仅修改 renderer/i18n 与相应测试，source/pipeline/controller 输入未变。约 100ms 的 DOM 采样不能排除更短的闪帧。不能从 DOM 区分每句是否 DB4 命中；真实 Provider 请求次数为 UNKNOWN，未宣称逐句均为新联网调用。最终入口包的真实证据单独绑定最终包。

## 自动验证

| 命令 / 范围 | 结果 |
| --- | --- |
| npm test（字幕核心修复后） | PASS 2036/2036；后续 renderer 改动不冒称重跑了全量 |
| node --test tests/i18n*.test.mjs（新文案） | PASS 11/11 |
| npm run check（最终包） | PASS：语法、架构、1253 项 i18n |
| npm run build:extension（最终包） | PASS；保留现有体积预算 advisory |
| TF_TEST_WORKERS=1 TF_E2E_ARTIFACT=dist/extension npm run test:e2e -- e2e/youtube-subtitles.spec.mjs e2e/subtitle-pipeline.spec.mjs e2e/subtitles.spec.mjs e2e/browser-basic-translation.spec.mjs --retries=0 | 见 native-ui-e2e-final.log，PASS：最终包 27/27 项回归 |
| git diff --check | PASS |

生产包回归包含：1.4 秒慢响应与连续追加 DOM 文本、短 cue 开始前准备完成且三次绘制帧非空、当前优先及单执行所有权、seek/配置失效、缓存恢复、本地翻译、原生控制栏嵌套与重建、单按钮入口和键盘关闭/焦点恢复。新回归先失败再通过；日志分别为 rolling-dom-red.log、subtitle-ui-red.log、native-ui-red.log、native-ui-nested-red.log。测试副本仅修改 manifest 用于 fixture，不替换产品 JS。

## 效果判断与限制

- 显示可靠性：用户视频的两个关键片段已看到持续中文字幕，修复前后有可核对的失败和成功证据。最终按钮的真实结果如上，不能用 fixture 成功代替。
- 翻译质量：可阅读，但逐 cue 翻译仍有半句、重复、术语和语义不顺；未经过专业译文质量验收，不能据此宣称成熟产品水平。
- 真实新包测试时捕获到 youtube-timedtext。修复后的纯 DOM 回退有模块/生产包集成证据，本次没有持续停留在纯 DOM 来源的真实复验；极慢 Provider 晚于可见短语生命周期时仍可能没有译文。
- 真实跨账号/地区、长时间播放、连续 SPA 切换、人工/自动轨切换与 Chrome 本地模型完整验收未完成；不由 Node、mock 或单视频结果替代。没有新鲜的完整 npm run validate / 发布认证声明。
- 主 Agent 已按实际 diff 自查；这不是第二轮独立模型审核。GPL 源码接入继续暂缓，不阻塞本次自有缺陷修复。用户验收和后续正式候选/发布流程保留。

## 证据位置

本地原始日志、采样（仅布尔状态与时间，未存完整字幕）、候选文件指纹和真实截图：docs/task-execution/local/youtube-subtitle-reuse-v1/。最终 HTML 内嵌截图，可独立打开；截图标题区分真实 Chrome 与合成播放器。此前 test-report/validation-report 保留原候选含义，不被本报告覆盖。
