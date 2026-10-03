# 主 Agent 自查

主体：本次主 Agent，没有启动 reviewer，不宣称独立审核。
最终候选：`e722652a1c5df3b73bb11c73602ab0b5534cc366`。

默认、发布、显式 WXT 入口及全部 buildExtension 消费者使用同一引擎。稳定安装目录保持 dist/extension；保留 Manifest 精确相等、认证词典 descriptor/哈希、代码预算以及既有路径/符号链接/嵌套 Git 工作区防护。没有修改生产 key、权限、Provider/cache 身份或 DB schema。发布包构建一次，受控复制到稳定目录；两份包 hash 相等。

此前 Selection 站点排除断言失败的原因已证实：policy 已读取 excluded=true，仍打开会被后台拒绝的状态订阅，错误回包被当作正常 invalidation 校验，覆盖正确的 disabled 卡片。修复仅在 excluded 站点跳过 connect，后台拒绝规则保持有效；后续显式查询和焦点刷新继续读取实时 policy。新增回归在修复前观察到 1 次连接，修复后连接、写入和 BEGIN_QUERY 都为零。没有放宽浏览器断言。

最终实际执行：29 项相关 Node 测试 PASS（Selection 13、本地流程 16）；静态/语言检查 PASS；一次真实 WXT 发布包与审计 PASS；smoke PASS；Selection 文件 7 个故事及同 ID 旧→WXT→重启 2 个故事全部 PASS（25.3 秒）。浏览器 Chromium 153.0.8010.12。完整输出、耗时、日志 hash、升级收据和包 fingerprint 见 acceptance.json。

原完整 validate 和 E2E 保留原 testedHead/结果；原 E2E 是 143 PASS、3 SKIP、1 FAIL，未改写成全绿。最新 diff 的生产变化只有上述 classic Content 条件，已用定向回归替换其受影响覆盖；治理脚本变化由对应测试验证。无 TS/Vitest/lockfile、Provider/cache/storage、编译入口或其它浏览器流程变化，因此不重复全量验收，不重新编译未变化的词典。

主 Agent 对照实际 diff、调用路径和任务逐项要求自查，未发现剩余阻断项。Chrome 102、真实 YouTube、其它浏览器、付费 Provider、外部/私有真实词典认证和商店发布 NOT RUN；本次证据不替代 #235/#236 产品验收。
