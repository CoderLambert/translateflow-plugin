# 首批实现验证（非发布验收）

本报告保留首批候选 `bf37935f04ef6271ef8d3b5780142ac8d65c3600` 的历史验证及当时限制；审查后工作树的修复与新证据见 [implementation-report.md](implementation-report.md)。下文“未完成/NOT RUN”描述原候选，不覆盖后续报告。

状态：working / Draft；不合并、不发布。TF 基线 ee8b08dfd08ced762ffcb275304da6249615b718。仅实现 YT-01 的当前字幕/回看修正，以及 YT-02 的前台模式取消部分。

## 实际执行

环境：Node v22.16.0。GitHub connector 可读写；容器 DNS 无法解析 GitHub，不能完整 clone/npm ci。独立临时工作区仅物化受影响文件并核对 Git blob；不是完整 checkout，不声称满足仓库 Node24 工程门槛。

- 原 main 的12项新问题回归：0 PASS / 12 FAIL，均为预期行为断言失败；再次使用真实 Task 模块对原源码回放，结果相同。
- 修改后组合回归：23项新增回归 + 原有5项 pipeline 测试，28 PASS / 0 FAIL / 0 SKIP。
- 原有5项测试原文件 Git blob：0d18567b7121b5caa27cbf9739f994b528f0d8eb，未修改旧断言。
- 四个变更的 JS/MJS 文件逐个 node --check：PASS。生产源码 controller217行、pipeline415行，均未超过420行。
- 独立 FluentRead 提取探针：10 PASS / 0 FAIL，直接运行固定上游调度类和纯选句闭包；不是上游全套 Vitest，也不是 TF 生产接入。

命令：

```sh
node --test tests/subtitle-pipeline.test.mjs tests/subtitle-controller-currentness.test.mjs
node --check src/content/subtitles/controller.js
node --check src/content/subtitles/pipeline.js
node --check tests/subtitle-controller-currentness.test.mjs
node --check tests/support/subtitle-controller-fixture.mjs
# 独立提取包内运行，不进入安装包
node --test probe.test.mjs
```

## 可核对的实现输入

| 文件 | Git blob |
|---|---|
| src/content/subtitles/controller.js | 2bc61aafdfb312e6f0dd8a0e555815d745e84e42 |
| src/content/subtitles/pipeline.js | b578e60a079e4fb23670467709815fc56553c78a |
| tests/subtitle-controller-currentness.test.mjs | b33d03cd2ec8423584c20cd52bf8eb9d3c187c89 |
| tests/support/subtitle-controller-fixture.mjs | a5fce528dbd5e4435fc52a1701e8648fbb6a5373 |

未修改的输入：source.js=16aa92c30acd08a720e60cb2e8d7dfae5c6343f1；tasks.js=a6c115d5c0d638266ab7e4f4aabe1a611d81879e。上传后的 GitHub blob 与本地实测字节一致。

## 覆盖与自查

真实 Task、字幕 source 合同、pipeline、controller 组合加载；运行时传输、YouTube 媒体来源和 renderer 是边界 double。定时器受控，不能用于宣称默认280/60ms延迟改善。

覆盖：同视频迟到、字幕空档、A-B-A回看、原文零新增调用、慢设置写入前取消、模式恢复复用、换轨隔离、重叠字幕顺序及部分响应、在途去重、启动停止与旧来源回调、异步reset、真实时钟/seek、存储失败不重启、160条FIFO与2MiB文本预算、空白/非法结果、非字幕任务不误取消。

主 Agent 自查发现并补测：reset未撤销已挂起ingest、响应时媒体时钟已越过句尾、重叠字幕只返回部分译文、空白及非字符串结果。已修正。没有独立模型审查，不写“独审通过”。内存字节预算按key与译文UTF-16字节计数，不是浏览器heap实测。

## 未完成与验收限制

NOT RUN：npm ci / npm run validate / 类型检查 / WXT构建 / MV3 E2E / 默认延迟计时 / 真实YouTube与Provider / 正式local-task gate。

尚未实现：后台配置与缓存准备阶段的取消注册、跨配置快照和缓存清理联动、原生栏菜单、仅译文枚举、完整滚动轨道适配、预翻译与真实执行释放预算。仅原文/off已停止前台新增请求并调用既有取消入口，不代表后台未登记的任务已无法继续调用Provider。

独立提取的GPL组件没有放入生产图，未改变全仓许可证。后续先完成YT-02，再推进原生栏及时间轴接入。当前修改不是完整可发布的字幕升级版本；不以本报告代替最终冻结候选和真实安装包验收。
