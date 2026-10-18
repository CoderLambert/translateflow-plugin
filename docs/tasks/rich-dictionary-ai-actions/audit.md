# 富文本词典 AI 流程的历史检查

本记录最初形成于 2026-10-16、基于 `c19b79dcbee3dd03d80c906ea857bae679e72ee8e`。当前主分支随后通过 #346 移除了随包词典查询路径，因此当时提出的 `optional-package-reader.js`、旧 bundled status 修复和“隐藏随包词典分区”代码不再适用于当前架构，均未带入集成候选。主分支当前只查询用户安装的 OPFS 词典，空库返回 no-hit。

仍适用于当前架构并已带入集成候选的内容：

- 单词的结构化查询报错时保留真实诊断与 unresolved 路由，同时先尝试用户导入的 MDX；命中后才开放显式 AI 操作，不自动调用 Provider。
- 富文本查询和导航使用冻结的 selection capture；AI 请求版本独立，迟到的 AI 或词典结果不能覆盖新词、关闭后的界面或另一个 AI 标签。
- 未配置 AI 时结束 loading 并显示可恢复提示；词典内容继续保留。

当前候选的完整验证和实际安装包证据统一见 [content-runtime-closeout](../content-runtime-closeout/verification.md) 与 `docs/tasks/content-runtime-closeout/acceptance.json`。旧测试失败、修复过程和旧包 fingerprint 仅作为历史记录保留，不据此宣称当前候选已验收。
