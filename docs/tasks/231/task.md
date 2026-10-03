# [Reading Loop][RL-01][P0] 原文文本映射、选区位置身份与 Anchor 捕获

历史引用：[#231](https://github.com/CoderLambert/translateflow-plugin/issues/231)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

## 执行卡
Parent #229；Release A；硬依赖#230已合入；L3 DOM/选区正确性。主执行rl-runtime，辅助L1仅独立合成fixture；独立只读rl-reviewer。2026-10-02同步方案，不改变owner/执行状态。

#232的C1–C8修订消息与隐私接口，不重写本任务的tf-source-utf16-v1投影。原文映射工作可继续，与#232非重叠并行；真实消息接线须协调其最终接口，不复制第二套schema。

## 用户结果
同页相同词的不同出现位置各自使用正确上下文；第一次查询就捕获位置证据；原文映射失败不阻止普通查词或伪造位置。

## 实现步骤
1. 沿当前classic注册新增src/content/text-projection*，DOM adapter输出可见原文及text-node/UTF-16 offset双向映射，纯reference projector仅为规则基准，不直接全页同步调用。inline不插空格，block/br及ASCII空白按version规则；保留NBSP/组合字符/emoji语义。
2. 排除TF生成译文/UI、script/style/template、隐藏与editable/sensitive子树；跨root/slot敏感性不确定返回unknown/unsupported，与#232统一policy接口，不把“没有检测到”当绝对安全。
3. 修正selection/controller同文同页复用：不同Range/源上下文新selection generation，取消旧区拥有的任务/视图；重复同Range事件、滚动geometry、进入卡片导致选区清除不制造新查询。blur/切标签本身不等于关闭，支持#234首次授权返回原卡。
4. selection/context从真实Range对应位置截取有界context，不用indexOf首次出现。明确查询开始时冻结selectedText/context/quote/position hint/blockDigest/sourceDigest/projectionVersion；source变化作废，不能AI结束后重新抓DOM。
5. 当前选区与附近上下文捕获优先，不为每个selectionchange全页扫描；不能把局部offset冒充全局position。完整位置无法在预算内证明时按合同降级，不造坐标、不丢安全可读结果。
6. 普通HTML/light DOM首版；生成译文无可靠source映射、Shadow/iframe/Canvas/虚拟未加载等明确能力限制。当前Range不持久化DOM引用；节点替换/导航释放。此任务不做repository去重、自动标记或全站Candidate重构。

## 性能实施与验收
按#230冻结的先达限先yield/停止规则：每片8ms/500nodes/16k UTF-16，单次累计250ms/25knodes/1M UTF-16。DOM遍历/style检查/映射构造一起计时，不只计纯字符串函数。已知Node全量339.94ms不是DOM PASS。

以普通短文章、长技术文档、重复段落、极端超大页与mutation-heavy合成fixture分别测量。普通可支持页面必须完成真实捕获；极端页必须停止/取消/降级且原查词能用，不允许所有页面返回not-loaded换绿灯。输出机器/浏览器/输入规模/最长同步段/总耗时；有GC/布局开销如实报告，不机械提高阈值。

## 必测
- 同页A/B两处session、同段重复词、完全相同段落重复；旧AI结果不进入新位置。
- inline拆词、链接/强调、空白/br、CJK/NBSP/emoji/组合字符双向映射。
- 开启/清除译文前后source一致；生成译文无映射不冒充原文。
- 重复selectionchange、滚动、卡片焦点、首次授权切标签/返回、显式关卡的区分。
- 广告前插/段落移动/节点移除/导航失效；editable不采周边；未知root不自动记录。
- 预算达限/取消释放监听器和映射，无无限扫描或长期持有DOM。

## 所有权/交付
拥有text-projection*、Selection位置/context/controller窄改与测试；coordinator单写content-script列表、根入口、实际旧/WXT资源映射和check接线。#228已合入，检查最新open PR实际冲突，不再等待旧PR；不得与#234同时改controller。

npm run validate +真实Chromium/MV3专项E2E；受影响Selection/Rich取消回归保留。适用WXT能力按实际已合入阶段测试，不等待#250，不将裸ESM塞进classic注入。无Provider/词典parser/存储改动。准确head独立review，PASS/FAIL/NOT RUN分开，状态按CONTRIBUTING，产品门槛仍#236。
