# 统一整合阶段验证

已从相同 main 基线 `d5b0e411dbe0195fb6dd179a2c17af196a211f83` 精确整合 Popup 与 YouTube 字幕两份改动，原工作区保持不动。版本 0.8.51，通过 `npm run commit:prepare` 构建准确暂存区到 `dist/extension/`。

已执行：104项相关Node回归、9项Popup React测试、`npm run check`、`npm run typecheck`，全部PASS。实际统一包上的28项Popup/字幕Chromium场景全部PASS（29.1秒，retries=0）。安装包tree SHA-256为 `baaeb97c2afee52d1cb96ad3e2ca1e609ce778cf0ac04f32097cb619e292d386`。

证据位于 `docs/task-execution/local/unified-reading-polish/integration-*.log` 与 `integration-inputs.json`。旧工作区报告保留其原始绑定，不代表当前统一包已完成后续译文质量修复。当前阶段不更改 Provider/缓存协议；接着处理协议残片与历史污染缓存。
