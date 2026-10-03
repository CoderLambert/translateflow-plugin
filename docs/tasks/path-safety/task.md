# 统一路径判断并保护构建源工作区

## 目标、范围与所有权

现有 PR #278，提交 a33b6e2dd3db8f123b026df988e525eaab0081e7 之后还有三处未提交安全修复。绑定最新补丁的独审/全验收 NOT RUN。与 #248 默认切换分开。所有破坏性 build 负例只在 mkdtemp 中执行，源根/同路径仅测试纯谓词。

## 验收

规范化 same/descendant/ancestor/disjoint；拒绝源根、Git 子树、links 和旧 builder 写 WXT 目录；允许系统临时根合法别名。完整 validate 和未参与实现的具名 reviewer 精确审核。当前冻结证据无效，不复用旧 review。
