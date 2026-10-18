# Selection Rich 查询状态独立审核与主 Agent 自查

独立只读审核者：dev_verifier（单独 Agent）；模型/effort UNKNOWN，不以身份自报替代运行证据。候选 `96758226c69990d6f10f590ba98849de1d7d8615`，基线 `cab9315819304a6ae1aa5e065a77c8864d88cc9d`。独立审核 PASS，无剩余 blocker。

审核完整 diff、真实调用链和八个验收场景，覆盖聚合状态、未展开/错误/不可用、重试、structured 主结果、多词典身份和 Provider 边界。首次发现旧 generation 的折叠卡延迟正文先写 DOM 后校验回调；已修复为正文写入前检查 session/requestId。独审只读复验 generation 改变及取消两条路径均无旧正文/回调。E2E 等待 resize 完成与提前捕获可信点击触发的 audio play 均保留真实操作及原断言，没有放宽阈值或模拟播放。

主 Agent 执行完整验收，独审读取并独立核对八命令日志 SHA256、候选绑定及产物：全部 PASS；定向 Node 28，完整 Node 1256、Vitest 40，安全 3、取消 5、Chromium E2E 15/15。浏览器 Google Chrome for Testing 153.0.8010.12（Playwright chromium）。实际包 119 files / 2,403,263 bytes；local-task fingerprint `824f7e5ab09c6a3e5cceb6d2ab26343fd76ba25e7dffe28ee05171f5dc4f3cac`，E2E inventory `3d6f5e4f6f326305dfaa3c1e26bf1a8d95a39dcceb19188952a0f240a4210253`，分别使用既有算法，均已复核。

主 Agent 自查（不是独审）：核对真实 diff、局部生成投影入口和实际架构边界；暗色 360px 合成截图主体与操作区在视口内。未改权限、CSP、Provider、缓存/Reading/词典存储合同。原失败候选日志保留在 ignored 本地证据中，未重标 PASS。私有 Oxford 全流程、4GB 性能、物理音频输出和最低浏览器 NOT RUN；本次合成证据不替代 #274。
