# 验证记录：Popup 重试与字幕仅译文

基线 `2e7b5a3bdffabb5c20a26afa5797d13f3af5b171`；分支 `feat/unified-reading-polish`；本地交付版本 **0.8.54**。本次只本地提交和构建，未推送、合入或发布。主 Agent 自查，不标为独立审核。

## 已交付行为

- Popup 页面读取失败使用独立提示卡、错误说明、图标按钮、键盘焦点和明暗主题。重试时保留原因，显示加载反馈并禁用重复点击。恢复时刷新相关页面信息，保留已读出的翻译方式草稿；修正受保护页面误用“缩短划词”提示及重复错误文案。缓存重试按钮采用一致样式。
- 视频内显示菜单和 Options 设置页增加“仅译文 / Translation only”；默认仍为双语。仅译文模式隐藏扩展原文和原生字幕，等待、无译文或失败时不回退展示原文，失败提示可切换原字幕；译文字号仍可调整。
- 模式切换复用当前结果和已有请求/缓存，刷新记住模式。无时间戳的 DOM 字幕刷新后可能重建 cue 身份，不承诺跨文档必然命中字幕缓存。新增 `translated` 值贯穿后台校验、Options 读写、Content、MAIN bridge 白名单和渲染器；未知值仍拒绝或回退默认。
- 无权限扩大、Provider/缓存身份变更或数据库迁移。没有改变字幕串行占用、取消和视频/轨道 generation 隔离。

## 已执行

环境 Node 24.21.0 / npm 11.19.0。原始日志与截图保存在 Git 忽略目录 `docs/task-execution/local/popup-retry-subtitle-translation-only/`。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 相关 Node 测试：subtitles、controller-currentness、pipeline、playback-experience、request-lifecycle、youtube-bridge、settings-ia、popup-ux | 105 PASS | `node.log` |
| `npm run check` | PASS，含静态、边界和 i18n 检查 | `check-final.log` |
| `npm run typecheck` | PASS | `typecheck-final.log` |
| `npm run test:unit` | 14 文件 / 88 PASS | `unit-all-final.log` |
| `npm run commit:prepare` | PASS，准确暂存快照构建 0.8.54 | `build-final.log` |
| 最终包：Popup polish/native、translation-method、youtube-subtitles，`--retries=0` | 17 PASS，24.6 秒 | `browser-final.log`、`browser-final.exit` |
| 先前包：另含 subtitles、subtitle-pipeline、subtitle-resource-lifecycle | 21 PASS / 1 测试预期错误；失败场景修正后单独 PASS，最后包再次 PASS | `browser.log`、`translation-only-final.log` |
| `git diff --cached --check`；真实 diff/调用链自查 | PASS，无已知阻止本地交付的问题 | 本报告 |

浏览器命令使用 `TF_E2E_ARTIFACT=dist/extension TF_TEST_WORKERS=2 npm run test:e2e -- e2e/popup-polish.spec.mjs e2e/popup-native.spec.mjs e2e/translation-method.spec.mjs e2e/youtube-subtitles.spec.mjs --retries=0`。先前字幕管线/生命周期的有效 PASS 复用：后续生产变化仅为 Popup 及其设置客户端，字幕生产输入未再改变。

最终包 inventory SHA-256：`e0585b7f1d389c91956bf7ede92f843ecd59d1d7da5db0b639681eb35a648354`；构建暂存 tree：`97f62ca2e8c18205568ddff86add1e9e2e678e38`。后续变更只有本报告和任务状态/索引；提交 HEAD 和包绑定记录于本地 `delivery-binding.json`。

## 失败与修正

首次单测 34 PASS / 2 FAIL：Options fixture 缺少 `runtime.getManifest`，Popup 说明在提示卡和预设提示中同时存在导致查询歧义；首次类型检查还发现测试使用不支持的 `exact` 参数。修正 fixture 和查询后相关 36 PASS，再完成最终 88 PASS。

首次浏览器测试错误地要求无时间戳 DOM 字幕刷新后零新增请求；实际重建了 cue 身份。修改为验证模式持久化和至多一次新 cue 请求，保留**同一文档双语/仅译文切换零新增请求**的严格断言。修正后的失败提示、原文隐藏和切回原字幕均通过；未弱化生产校验或增加重试预算。

截图复核发现受保护页面错误使用文本安全提示，已修复并新增浏览器断言；完整状态恢复和草稿保留也已覆盖。最终复核 `retry-light.png`、`retry-dark.png`、`translation-only-caption.png`；菜单和失败状态另存 `translation-only-settings.png`、`translation-only-failure.png`。字幕画面是合成播放器及 mock 译文，不能代表真实模型翻译质量。

## 未验证及边界

本次未使用用户私人 profile、真实 Provider 或真实 YouTube 实播；此前真实 YouTube 受登录/机器人验证阻塞，本轮不把合成测试标作实播通过。未执行全量 Node、全量 E2E 或远端发布门禁。本地任务保留 reviewing，candidateHead / mergeHead 为 null；本报告不代表已合入 main。
