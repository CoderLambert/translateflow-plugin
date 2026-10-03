# [Reading Loop][RL-06][P0] Release A 验收：真实查询到学习中心的可用闭环

历史引用：[#236](https://github.com/CoderLambert/translateflow-plugin/issues/236)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

## 执行卡
Parent #229；Release A发布验收；硬依赖#234、#235合入main且阻断性审核问题已解决（传递含#232合同补丁、#233、#248、#249）。L3 QA设计/L2确定性执行；独立只读终审rl-reviewer，不由原实现者自签。2026-10-02本次只同步计划，不改变执行标签。

## 产品完成定义
真实查询→受信任学习中心明确授权→真实保存→重启后回顾当时词义/译文/完成问答与source→能暂停/排除站点/删除/导出。A不宣称已有精确回访/自动标记/新流式助手。

## 真实包与测试输入
**使用#248切换后的实际WXT production artifact**，先审计未修改包，再复制出只添加合成站点/mock Provider的测试副本。不得继续用旧buildExtension生成另一包冒充WXT；fixture不能补入生产缺失的页面/chunk/worker。记录source SHA、包hash、Manifest、浏览器版本；TS/Vitest/Node tests不能替代实际MV3。

## 实施验收顺序
1. 正常创建链路：未授权local lookup→非阻断邀请→learning-center.html→Enable→回原有效结果卡→点击保存本次结果→commit ack→学习中心最近/按页/搜索/详情→重启。另测直接先开启再新查询的自动保存路径；不全靠seed数据库。
2. 拒绝/失效：Not now继续查词；开启期间原卡关闭/换选区/导航不回填；切标签本身不改变selection身份。Content不能调用set-recording，伪造userInitiated字段不能得到全局权限。
3. 结果矩阵：local hit、真实no-hit、当前cache hit、主动句子翻译、现有Explain。Local lookup/历史读取零Provider；仅明确翻译/AI有请求，不因保存失败重发。
4. 一次operation基本词义→迟到Rich摘要→重复消息只加一次lookup；下次明确查询再加一次；同词同页不同位置source不同；两标签合法append不丢失。
5. 数据退出：暂停/恢复、单origin排除/恢复、单条/按页/清空、容量/真实quota。清记录不删词典/cache/排除配置；无consent/private/editable/敏感/排除站点零Reading持久化。保存/取消/删除以事务先后测试，不能因发出取消就认为已撤回commit。
6. 读取：一页列表使用摘要，记录请求计数证明不是N+1 get-record；按页聚合/搜索/稳定cursor、预览source一致、删除后迟到详情/搜索结果不复活。词典卸载/Provider未配置/断网仍可读快照。
7. 导出：使用start/next/finish/cancel；接近64 MiB行预算、单record超过1 MiB、中文/引号/反斜线/emoji。逐条检查完整消息≤1 MiB、拼接JSON可解析、行/来源关联/序列/字节与fixture一致；不能只验证小数据。
8. 导出竞态：重复cursor不重复拼接，乱序/缺片、追加/viewed/删除/清空/撤权、worker/页面中断、主动取消均不产生成功的残缺文件。finish之前取消获胜则中断；finish成功后的交付副本不能追回。UI只报告可观察的生成/发起下载，不伪报用户已存盘。
9. 安全：跨页recordId/伪扩展页/旧document/旧消息版本/private全路径拒绝；恶意HTML/链接/远程图片不执行不联网。AI payload不包含未经选择授权的anchor前后缀/URL/页面标题，导出不带凭据/token/完整MDX/MDD。
10. 体验：loading/empty/no-result/error/not-saved/quota/paused/excluded、键盘/Escape焦点/IME/窄屏/缩放/暗色/reduced-motion、en/zh_CN及StrictMode清理有真实交互证据。UI语言变化不改翻译语言/cache/artifact。

## 性能与边界证据
普通合成文章必须完成位置捕获，极端大页/动态页必须有界退路；不接受所有情况返回not-loaded的假通过。计时注明机器/浏览器、输入规模、最长同步片段和总耗时；预算为上限，不把旧Node投影测量当DOM通过。数据库、字典、Provider mock、人工权限提示、线上模型质量分别记录。

## 交付与失败处理
更新docs/READING_LOOP_ACCEPTANCE.md的A证据：准确head/hash、命令、逐项PASS/FAIL/NOT RUN、Provider/消息计数、真实存储核对、合成截图、用户复现步骤和限制。发现缺陷回对应owner或由coordinator明确授权最小修正，不删断言/扩大权限/引入平台掩盖。

执行当前npm run validate、真实WXT相关Reading/Selection/缓存Chromium E2E；词典认证仅触及路径或required CI时执行。无真实API key不阻止mock产品流，但不能声称真实模型质量已验收。

只有A真实main故事及独立review成立才记录READING_LOOP_A_PASS并按依赖释放后续任务；不关闭#229、不启动未经授权D/商店发布。原CONTRIBUTING的merged→implemented→auditing→audited语义继续有效。
