# MDX 多记录查询独立审核

独立只读审核者 dev_verifier（单独 Agent，model/effort UNKNOWN）。候选 `2b9080b118b431838d80561ec1152eae362df9cf`，基线 `320f78e2b34fc16648e35369b06c473f1a58c68e`。PASS，无剩余 blocker。

已审核完整 diff 与 parser/预算/controller/renderer/sanitizer/Selection 取消调用链：exact-first 包括晚出现 exact；offset 去重和 source-offset 稳定顺序；逐路径 alias 深度及回边剪枝保留 valid siblings，只有循环/缺失/坏 span 明确失败；实际访问次数、bytes/ranges/decode 与 DTO 总预算；共享 stylesheet 与有界首条兼容；所有正文累计 AST 预检后各自独立 Shadow viewer；一次显示回调、旧 generation 防护和仅本 card 资源清理符合合同，未扩大 Provider、网络、权限或 CSP。

主 Agent 执行八条最终命令，独审核对全部准确候选和日志 SHA256：PASS；定向 Node 141、完整 Node 1305、Vitest 40、安全 3、取消 5、Chromium E2E 17/17。实际包 120 files / 2,424,470 bytes；local-task fingerprint `bb88ebe91176d9afdd0b6313c4c1c70e7ea25162098d655f240f834c3b54bc79`、E2E inventory `8f3523d930d5ee4a378a205117cebf90af1e131aa543bef596a669e6c4f211e5`，两算法独立重算匹配。浏览器 153.0.8010.12。

真实 Oxford 本地只读 actual parser 完成 5,185/5,185 重复 display 查询，共 10,871 terminal records / max 7；顺序、offset 去重、已有图 expected-offset、首条兼容和预算均 PASS。345 个含有效 sibling 的循环查询正确剪枝；四固定词、七匿名类别与 12 原正文的独立 native-zlib span 对照通过。脱敏报告 SHA256 `e0243a7327422cc0941c4f8450bf1f44309ce05a0c018b27924e2e2f8776d4c5` 与 acceptance 一致，无正文或私人路径。该证据不是独立词典 reader 或真实 Oxford 浏览器/用户 OPFS 终验；负例仍为合成 fixture，heap/RSS NOT_MEASURED。

主 Agent 自查（不冒充独审）：核对 exact/folded 与 alias 真实样本、响应累计限制和独立资源清理，复用所有有效 exact-head PASS。未改 index schema 或原文件；总 cache 预算与 #271–#274 剩余能力未交付，#270/#268 不据本切片关闭。prior Stripkey completion 归档只补实际 main 事实，原候选/验收绑定未改写。
