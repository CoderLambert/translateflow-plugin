# 移除内置词典产品系统，保留用户安装词典能力

用户授权直接实现、测试、提交并推送独立分支，创建单一 Draft PR；不合并、不发布。基线 main 为 349321a079544a51834de1b3173f1fc653220e6d，PR #345 已 squash 合并；复用其历史记录，不改写旧验收。原工作区的其他任务修改不得触碰。

## 范围与架构

删除 Core Semantic / Technical Concepts 内容、固定 Reader、资源路径、状态消息、设置页分组、专属生成和认证、构建参数、CI 与当前误导说明。后台只使用既有 active OPFS Reader 与通用 Gateway / User Glossary；不增加第二套服务。通用 TFLex Reader/Writer/校验、精选下载、TFLex/StarDict/MDX/MDD 导入、OPFS 安装事务、多词典管理全部保留。旧格式 profile 的磁盘标识若属通用格式合同不得重命名破坏用户包。

不修改或迁移用户 OPFS、IndexedDB、Glossary、排序偏好、Reading/Vocabulary、翻译及 AI 缓存、凭据；不扩大权限、不隐式下载或调用 Provider。保留 Technical Preset、浏览器本地 Translator、Selection 显式 AI 与取消合同、YouTube 字幕。

## 模块与所有权

- dev_implementer：后台词典注册/消息/路由、设置页/样式/i18n 与直接相关测试。
- dev_verifier：e2e、smoke、用户词典安装 fixture 与等价错误覆盖；测试必须真实安装/隔离 OPFS，不伪造查询成功。
- dev_builder：构建脚本、通用编译工具解耦、来源/锁文件与 CI。
- 主 Agent：文档、任务状态、最终集成与自查。

子任务各用独立 worktree，不提交或推送；主 Agent 集成补丁。共享合同文件只有指定所有者可写。

## 验收

开发先运行定向检查。冻结准确提交后运行 state.json 中命令一次；修复只重验失败项及受影响依赖。覆盖无词典正常 no-hit/零 Provider、Glossary、用户词典命中/多词典/启用排序删除重启、下载及全部导入格式、Selection 显式 AI/取消/Reading/富文本，完整 E2E 检查共享 fixture 迁移影响。

真实产物不含内置词典、source locks、测试及原始数据。报告命令/数量/耗时/原始日志、head/tree/包 fingerprint、文件数/增删行/产物字节及未验证真实语料。保留必要历史审计并标明退役；每个残留符号需分类。最后主 Agent 对照实际 diff 自查，不自动模型独审。

完整 E2E 执行时设置 `TF_USER_DICTIONARY_OLD_ARTIFACT=/tmp/translateflow-pr345-final-20261019/.output/chrome-mv3`，这是已核对 PR #345 归档指纹的旧 main 安装包。新增升级case在同ID临时profile通过真实UI安装TFLex/MDX/MDD，替换同路径新包并核实新执行标记，精确比较storage/OPFS/全部IndexedDB；当前版本不变，因此只证明开发包替换/管理页reload，不声称商店版本更新事件。

## 验收命令拆分与有效结果复用

首次冻结 `fdef650b24aca8a8012902c124b07f20b5f5ab6f` 执行一次 `npm run validate`：静态/i18n通过，Node 1790 PASS / 1 FAIL；唯一失败是 `tests/local-task.test.mjs` 仍要求11个workflow，与本任务删除旧词典workflow后的10个不符。修正仅此测试清单，保留所有手动触发/inputs/jobs断言并增加退役文件不存在断言。

依用户“失败后只重验受影响项”要求，原始失败命令不改写PASS；保存原head/tree/日志/hash，并核对新候选实现/其余测试/构建输入与原候选完全相同。复用1774个文件外未变化的Node PASS，重跑整个local-task测试文件覆盖唯一失败；state.json拆分原validate组成项，执行其余静态检查、类型检查、Vitest和默认构建，再执行显式WXT/smoke/全量E2E。此调整不排除未解决失败，不削弱任何功能、安全、格式或包边界验收。最终报告明确区分原validate FAIL、修复后定向PASS与REUSED。

完整E2E在0fcedc71实际执行一次：222 PASS / 1 FAIL / 9 SKIP。唯一失败为ecosystem循环重置后未显式安装结构化用户词典；修复只增加计时前安装，不改变性能/请求/查询断言。最终候选复用未变生产输入的类型/单测/构建/smoke和其它浏览器PASS，重跑check、该文件3项，并使用已核对的19e旧包补跑2项升级；保留原失败与跳过证据，不重复全量构建或E2E。
