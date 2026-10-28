# YouTube 字幕播放体验优化 — 验收与自查

## 实现与交付状态

基于 `origin/main` / `d5b0e411dbe0195fb6dd179a2c17af196a211f83`，工作区 `/home/lambert/githubRepos/lambert/translateflow-youtube-experience`，分支 `fix/youtube-playback-experience`。本地未提交预览；版本仍为 0.8.50，不代表已合入或发布。

- 当前活动字幕与未来字幕分批返回，重叠当前字幕仍按既有上限一起处理；当前句无需等待未来工作的 60ms 聚合延迟。
- 未来批次最多两条，仍只有一个真实在途请求。预译转当前句复用请求，seek/取消后等旧传输结束再启动后续执行。
- 队列满时先丢弃未来工作，防止未来字幕挤掉当前句。回归确认旧版存在该边界问题。
- 播放倍率贯穿 MAIN timedtext、TextTrack、snapshot 和预译筛选。1x 保持 12 秒/5条，2x 为24秒/10条；倍率限定0.25–4、未来最多10条。非法倍率回落1；重复规范化不会截回1x窗口。
- 按用户本轮追加要求，`scripts/source-boundaries.mjs` 中 `src/content/subtitles/pipeline.js` 的行数上限改为900；其余源码仍保留420行上限。
- 未修改 Provider、持久化/缓存身份、权限、MAIN网络获取或 Popup。snapshot 的倍率是 Content 内部字段，不进入 Provider/缓存合同，无数据迁移。

## FluentRead 核对

本轮查询 FluentRead HEAD 为 `a29d115688245d5ac5fa3e7ef2fe2a84e3e01102`。该提交的 `translationScheduler.ts` blob 为 `c7f0871d4db5499a29ec61793d6822d825aa7bbb`，`subtitleLogic.ts` 为 `f3c6f881e4fe7aedaf0814c416e2cfe3c422a9ba`，与仓库已有固定研究一致。复用当前句优先、倍率前看和过期窗口淘汰的行为思路；没有复制 GPL 生产源码，也没有照搬上游三并发。其余上游文件未做全面审查。

## 已执行

证据目录：`docs/task-execution/local/youtube-playback-experience/`（Git忽略）。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 旧版新增回归 | FAIL，3项均复现：混合批次、队列满丢当前句、缺倍率窗口 | `before.log` |
| 修改后首轮回归 | FAIL，旧测试仍假设混合批次/旧调用数，另有模拟计时器与异步完成断言需适配；保留原失败 | `first-after.log` |
| 7个字幕相关 Node 文件 | PASS，99项 | `node-final.log` |
| `npm run check` | 首两次 FAIL：pipeline 超过420行（检查将末尾换行计入行数）；用户明确授权调整后 PASS | `check.log`、`check-final.log`，后者为最终结果 |
| `npm run typecheck` | PASS | `types.log` |
| `npm run build:extension` | PASS | `build.log` |
| 4个相关 Chromium/MV3 文件 | PASS，17项，21.1秒，retries=0；首轮也是17项通过，最终重验中曾被外层60秒命令预算中断，随后独立重跑完成 | `browser.log` |
| `git diff --check` | PASS | 本地命令 |

浏览器覆盖真实构建包的当前句先返回（未来请求仍 pending）、短字幕三帧无空白、缓存零额外请求、倍速触发更远未来字幕、原文/双语/关闭、预设、DOM滚动、换视频及资源清理。合成播放器/字幕与 mock Provider 验证不等于真实 YouTube 播放。

本机 `agent-browser` 命令不可用，使用仓库现有 Playwright/Chromium 工具。未新装全局浏览器工具。

## 本地模型对照

`local-model-benchmark.mjs` 使用临时 profile、实际扩展包、四句合成英文字幕和已授权的局域网 LM Studio `hy-mt2-7b`。视频时钟保持在第一句，仅测首次可见译文；测得后关闭临时浏览器，终止剩余预译。不是实播吞吐量或长期平均性能测试。

| 包 | 当前译文可见时间 | 当前请求 HTTP 响应 |
| --- | --- | --- |
| 原0.8.50正式包 | 1402ms | HTTP200，1371ms |
| 本地优化预览包 | 392ms | HTTP200，374ms |

原包把4句一起等待；新包当前句先返回，截图中原文与中文译文正常。优化包截图时第二个预译请求已开始，本实验未将其算作完成。首轮包上的对照为1353ms/431ms（`model-*-first-pass.json`）。队列自查修正后的最终包复验中，一次探针未显式等待 Content/MAIN READY 就触发合成字幕响应，45秒内没有Provider请求、未出现译文；该 FAIL 保留为 `model-after-startup-failure.json`。探针补充显式启动就绪等待后，在最终包上取得上表结果。前后对照次数有限、顺序与冷热状态未随机控制，不能推广为所有视频、模型或平均提升。详见最终 `model-before.json` / `model-after.json` 和对应截图。

## 真实 YouTube 阻塞

访问公开视频 `https://www.youtube.com/watch?v=rfscVS0vtbw`，临时浏览器被 “Sign in to confirm you’re not a bot” 阻止播放。25次有界采样中视频时间始终为0，字幕源为DOM回退、无字幕，Provider请求0。截图已人工检查，不能将脚本exit0当作实播PASS。

证据：`live-youtube.json`、`live-youtube.png`。真实 YouTube 人工/自动轨道、长期连续播放、账户差异与真实倍速实播仍未验证；没有尝试绕过登录检查或使用私人浏览器资料。

## 主 Agent 自查

对照实际 diff 与 source → controller → pipeline → background 调用链检查：没有新建后台队列、存储、网络路径或并发；倍率在两层筛选间一致；重复预译及晋级保持同一 fingerprint；合法重叠字幕仍一起返回；config/track/video/seek 隔离沿用现有机制并由回归覆盖。自查不是独立模型审核。

队列容量自查额外发现按插入顺序丢弃未来项可能丢掉较近的新字幕，已改为比较开始时间、先丢较远未来项，并补充回归；99项Node及最终17项浏览器验证均通过。

代价与限制：分批会增加请求次数（四句合成场景从一个批次拆为当前一条、未来两条、未来一条）；正在执行的慢预译请求仍会阻塞后来出现的当前句，不能声称完全消除延迟。DOM只能观察已出现的字幕，窗口改进仅适用于已知时间线。全量validate及远端集成验收未执行，本轮交付为本地预览。

安装目录：`dist/extension/`。准确安装包与源码文件指纹见 `preview-binding.json`，不把基线HEAD冒充未提交修改的候选身份。
