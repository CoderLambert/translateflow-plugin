# 固定样本并发对比

Node 24.22.0、npm 11.19.0，availableParallelism=20。三类 runner 顺序测量；每档一次，含进程启动时间，不作普遍性能保证。Node 10 文件，Vitest 11 文件，Chromium 10 文件/47 用例。Node 原设置为直接 `node --test`，Vitest 原设置 2，Chromium 原设置 1；本地新设置上限为 10。

| runner | 原设置（秒） | 5 worker（秒） | 10 worker（秒） | 失败 |
| --- | ---: | ---: | ---: | --- |
| node | 3.669 | 3.618 | 3.668 | 0 |
| vitest | 3.286 | 2.057 | 2.04 | 0 |
| chromium | 57.948 | 27.223 | 26.3 | 0 |

原始命令、固定文件清单、逐组输入 SHA-256、退出码、实测耗时与日志 hash 在本地忽略目录 `docs/task-execution/local/test-concurrency/benchmark.json`，该清单 SHA-256 为 `be2172519310bd7977c97817bdcbd90030e91bca46f400a741dc5789069388c9`。Chromium 共执行 3×47 项，全部通过、无重试。安装包 tree SHA-256 为 `9d52dc76b7f518e936500e9be3739af734d9dee3692e3e8df2e94a1384dae95c`；测量使用版本 0.8.20 的相同 WXT 包，候选提交的版本构建另行验收。
