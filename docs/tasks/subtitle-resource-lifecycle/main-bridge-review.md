# 字幕资源生命周期的 MAIN 固定闭包安全复核

依据 `scripts/source-boundaries.mjs:18-24` 和 `docs/ARCHITECTURE.md` 的固定例外要求，由既有具名 `dev_specialist` 只读复核本次 MAIN diff、辅助响应读取函数及对应测试。主 Agent 串行修复，子 Agent 未写文件。此次是固定闭包的聚焦独审，不是整个未提交工作树的独审或真实 YouTube 验收。

初次复核 P0=0/P1=0/P2=1：过滤播放器全部 DOM 更新会漏掉没有网络/导航事件的缓存轨道切换，使旧轨道和未完成 reader 保留。主 Agent 补充不调用 reannounce 的 RED 回归（en != fr），随后保留播放器内部 DOM metadata 检测、继续过滤外部更新并去重 TRACKS。GREEN 断言新轨道及旧 reader cancelled=1/unlocked。

复核结论：P0=0/P1=0/P2=0，允许静态登记以下精确 SHA-256。已登记至固定常量；没有动态读取候选源码来放行检查。

| 文件 | SHA-256 |
| --- | --- |
| `src/content/subtitles/youtube-main-bridge.js` | `357f8757aee18742d9fd1ae3d5383c2ff35690324a367903fa5e3bfb1fb4eaae` |
| `src/content/subtitles/youtube-timedtext.js` | `525df3515d5a10231102d132f321873ec7fb39bf96a42285c7d375cda061fc19` |
| `tests/youtube-bridge.test.mjs` | `ad787ef5c69f59c12d371256876a390a8b6b70f24d562fd84abd20a04503bbb2` |

审核实际执行：前轮 bridge 21/21 PASS；修复后 3 项受影响回归 PASS；范围内 diff 检查 PASS，退出码均 0。另以真实 Node `Response.clone()` 流探针验证超过 2 MiB 时取消自有读取，原始响应仍可完整读出 2,097,153 bytes。原始工具记录分别为 `58857c`、`15e2cc`、`38deb7`、`294dad`；审核遵循只读要求，没有另写日志。主 Agent 后续完整定向 bridge 22/22 和 MV3 流程结果另见 validation-report.md。

保留纯观察、固定消息结构、video/generation/trackRevision、2 MiB 上限与原 fetch Promise/XHR 返回值；未增加权限、主动 fetch、签名字幕 URL 重放或后台能力。辅助 reader 只读取已有响应副本，stop/切轨/视频变化清理自有读取，原请求保持页面所有权。

可观察模型/effort/实际启动参数元数据 UNKNOWN；会话指令声明 unrestricted / approval never，全程按只读任务执行。后续修改这些文件字节将使本审核绑定失效。
