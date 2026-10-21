# 当前字幕翻译的性能审查

结论：**存在 2 项 P1 和 1 项 P2 性能问题，建议修复。尚无证据证明正常播放会立即卡死，但也不能宣布长时间观看的性能已经达标。** 问题主要在监听和重复刷新，而非无界翻译请求。本轮只读审查，没有修改产品源码、测试源码、配置或安装包。

## 审查对象与证据边界

- 基线：`d465e933cef10e2a6ae9320837b2925b816dc895`；本地分支 `feat/ollama-local-cloud-connections` 尚有前序未提交改动。
- 本次涉及的字幕源、MAIN bridge、controller、pipeline 与上述提交一致；renderer 仅有此前“译”字居中的一行样式改动。本轮没有重建或覆盖安装包。
- 原安装目录的上一交付包指纹是 `d1205a2e02ca171c3169e9f27ff272fa84d75ea8e6b159268f44c22af77b7d5d`。不能把磁盘上的包与用户页面正在执行的脚本视作已证明完全一致。
- 性能探针使用 **Chrome for Testing 153.0.8010.12**、实际未修改的字幕源/bridge 模块和合成播放器。只在一次性浏览器中计数查询与 Observer 注册；不访问用户账户，不调用真实 Provider，不解码视频。
- 真实已登录 Chrome 页面只读检查：播放器暂停在约 16:56、一个字幕入口、译文可见。没有恢复播放、切换模式或更改配置。**真实播放帧率、CPU、GPU、长任务、堆内存和开关扩展 A/B 均 NOT RUN。**
- 原始探针：`docs/task-execution/local/subtitle-performance-review/probe.mjs`；结果：同目录 `probe-result.json`，包含逐文件 SHA-256。命令：`node docs/task-execution/local/subtitle-performance-review/probe.mjs`。

## P1-01：资源 Observer 重复安装，停止时不能清理旧实例

位置：`src/content/subtitles/youtube-main-bridge.js:255`、`:302`、`:354`、`:374`。

`start()` 调用 `installResourceTiming()`；收到每次 `HELLO` 又调用一次。函数每次创建新的 `PerformanceObserver` 并覆盖 `state.performanceObserver`，未复用或断开旧实例。`teardown()` 只断开最后保存的那个实例。`observeResources()` 也没有 inactive 状态的提前退出。

实测 Observer 注册计数：

| 阶段 | 已创建 | 仍处于 observe 状态 |
| --- | ---: | ---: |
| 初次启动并 HELLO | 2 | 2 |
| 切换模式 20 次后 | 22 | 22 |
| 再切到 off 并 stop 后 | 23 | 22 |

这是可复现的生命周期清理缺陷；上述计数不代表已测得泄漏多少 MB。触发条件是反复切换双语/原文/关闭，或同一 SPA 文档内重新初始化。一直播放、完全不切换模式时，不能据此声称监听器会每分钟自动增长；整页刷新也会销毁旧文档。

影响：每个 Observer 都订阅资源事件，且新建时读取 buffered entries。切换越多，重复处理的可能越大；视频页资源较多时尤其不该保留这些重复订阅。

最小修正：活动 bridge 只保留一个资源 Observer，HELLO 不重复安装；stop 后为零，并让迟到回调检查 active。无需新增调度系统。

## P1-02：播放器外的 DOM 更新会被放大为完整字幕刷新

位置与调用链：

1. `src/content/subtitles/youtube-main-bridge.js:322` 观察整个 `document.documentElement` 的所有子节点变化。
2. `:289` 的零延时计时器只能合并短时间内的调用；不同事件循环中的评论等更新仍反复执行 `resolveState()`。
3. `:135` 只要字幕轨道非空便 `publishTracks()`，即使轨道完全没变。
4. `src/content/subtitles/sources/youtube.js:311` 收到 TRACKS 后 `refresh(..., true)`，绕过相同字幕快照去重。
5. `controller.js:98`、`:111`、`:113`、`:116` 接着重新查播放器、写原文、更新译文并进入 pipeline。

在字幕、视频时间和轨道都不变的情况下，探针对**播放器外**区域分 40 个任务修改 DOM，得到 **40 条 TRACKS 消息、40 次字幕快照、400 次业务 querySelector 调用**。这不是自然播放的每秒频率，而是证明无关变化可以触发这条链路。探针本身定位用于修改的节点在计数前完成，没有计入这 400 次。

影响：评论加载、页面其它模块更新会给字幕增加工作；暂停视频时也可能发生。重复快照会带来额外 JS 和 UI 更新，但已完成结果和 in-flight 去重意味着不能把 40 次快照说成 40 次 Provider 请求。

最小修正：先让 TRACKS 只在实际视频/轨道元数据变化时发布；缩小或过滤 MAIN 的 DOM 观察。保留已有 SPA 事件和播放器替换恢复机制，不要为了限流破坏换视频、换轨与控制栏重建。

## P2-01：关闭字幕后仍有重计算，长轨道还会反复全量扫描

位置：`src/content/subtitles/sources/youtube.js:161`、`:169`、`:239`、`:364`；`source.js:100`；`sources/text-track.js:85`。

`setMode('off')` 恢复原生字幕，但不停止字幕源监听；`scheduleNextBoundary()` 没检查 off。`controller.js:112` 的 off 判断发生在源已经生成快照之后。探针切换 off 后再修改一次外部 DOM，仍收到一次字幕快照。关闭翻译已经阻止 Provider 工作，**不等于关闭了采集与计算开销**。

Timedtext 每次刷新分别全量过滤 active / upcoming cues，再 `flatMap` 所有起止时间、过滤并 `Math.min(...boundaries)`，同时反复取消和建立边界计时器。TextTrack 路径也在媒体更新中复制并规范化整条 cues；即使 MAIN timedtext 已接管，TextTrack 自身的 timeupdate 监听仍存在，外层回调只是丢弃结果。

隔离 Chromium 中，每个规模预热 20 次后测量 200 次实际 `source.refresh()`：

| 整条轨道 cue 数 | 平均单次 ms | P95 ms |
| ---: | ---: | ---: |
| 1,000 | 0.065 | 0.10 |
| 5,000 | 0.260 | 0.40 |
| 15,000 | 0.768 | 1.00 |

这些数字说明测量环境下单次源刷新不算重，但开销随整条轨道规模增长，且会被 P1-02 的重复触发放大。测量不包含 controller、UI、翻译、视频解码，连续调用样本也不能当作真实播放 CPU 占比或帧率保证。

最小修正：off 时暂停重采集和边界计时器，仅保留恢复入口必要的轻量绑定。先修重复触发；全量扫描的索引优化可后置，不必立即重写字幕调度算法。若后续优化索引，必须保留重叠字幕、空档、seek 和倍速语义。

## 已有的保护措施

| 部分 | 当前实际边界 | 源码 |
| --- | --- | --- |
| 翻译请求 | 单 pipeline 串行处理，单批默认 6 条 | `pipeline.js:16`、`:261` |
| 等待队列 | 默认最多 24 条 | `pipeline.js:17`、`:188` |
| 预翻译 | 仅未来 12 秒、最多 5 条已知 cue | `source.js:100` |
| 完成结果 | 最多 160 条，并有 2 MiB 字符计数预算；不是整个功能的总内存上限 | `pipeline.js:335` |
| 失败记录 | 最多 160 项，退避 2/5/15/30 秒 | `pipeline.js:233` |
| 缓存维护 | Provider 有新增译文时至多每 5 分钟发起 prune | `pipeline.js:240` |
| 网络和缓存 | Provider、缓存读写走 Background；缓存命中不调用 Provider | `src/background/subtitle-requests.js:35`、`:59` |
| 一般生命周期 | video listener、源 MutationObserver、cue timer、renderer observer 都有对应 stop/unmount 清理 | `sources/youtube.js:345`、`renderer.js:198` |

没有发现每帧发起网络请求、一次性翻译整部视频，或可由当前调用链证明的无限 DOM 自触发循环。不能把这些保护措施解释成无性能风险：它们没有覆盖前述资源 Observer 和跨页面 DOM 的重复刷新。

真实本地模型运行时的机器 CPU/GPU/显存竞争本轮未测；不能将外部 Ollama 或 Chrome 本地模型的推理资源需求混同于页面字幕脚本的主线程开销。

## 应补的回归与实施优先级

1. Observer 生命周期：重复 HELLO / 切模式 100 次仍只保留一个；stop 后零；重新启动恢复为一个。现有 `tests/youtube-bridge.test.mjs:78` 将 PerformanceObserver 设为 undefined，覆盖不到本缺陷。
2. 无关 DOM：评论区域变化不发布相同 TRACKS，不强制重新绘制字幕；真实轨道、videoId、播放器节点变化仍正确恢复。
3. off / pause：off 后无 cue 边界重算和翻译任务；重新开启能恢复。暂停时必要的 seek/轨道变化保留，普通无关 DOM 不触发字幕工作。
4. 再做真实 YouTube 连续播放、倍速、seek、SPA 切换及多次切模式测量，比较 CPU、长任务、丢帧增量、停止后监听器和堆内存。不能用本探针取代此验收。

推荐先修 P1-01，再修 P1-02 与 off 的工作暂停；这比先重写播放器绑定、引入 Worker 或更换整个调度器更直接。本轮只提出审查结果，没有执行这些修正。
