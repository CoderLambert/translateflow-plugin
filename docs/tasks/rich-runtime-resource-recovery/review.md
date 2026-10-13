# 验收后自查

生产候选：`dea649ffcf8b5ed8888c9878b1f29061154f048d`。执行者为主 Agent；此记录是验收后自查，不是独立审核。

检查资源读取、取消、对象 URL 释放、版本绑定、CSS slot 降级和音频重试。CSS 新增 flex 属性有界校验；背景只接受纯颜色；响应式规则使用 viewer 命名容器；相同规则只在同一层保留最后位置，只有相邻且声明完全相同的规则合并选择器，保留预算。没有放宽脚本、外网、CSP 或权限。

大窗口沿用当前 Selection 和历史，不重新查询；手动收起在当前 selection 保持，新 selection 重置。关闭清理 observer 和动画帧。真实 Oxford 样式在原有输出规则预算内保留，copy 词头、build 近义词以及 POS 背景恢复；360px 时上下排列。底部操作可达。

查询成功的卡片头只保留词典名，顺序、首选、来源/信任、格式和完成徽标不再生成；首选排序与自动展开仍由原数据驱动。查询中、失败和无匹配状态保留。Oxford 发音按钮的可见标签为英/美（英文 UK/US），`aria-label` 仍为完整播放说明；通用音频和失败文案不变。

生产候选 validate PASS（1514 Node、42 Vitest）、WXT build/smoke PASS、安全 3 项与取消 12 项 PASS、定向 Node 141 项 PASS、`git diff --check` PASS。声明的 Chromium 回归 14 项 PASS；本次头部/发音补充场景 7 项 PASS，验证首选行为、状态与 Oxford 交互，Provider=0。

真实私有 Oxford copy/build：桌面与窄屏 PASS，build 近义词约 660px；两词 UK/US 音频均 readyState=4、无错误、local blob；Provider=0、external HTTP=0。仅脱敏结果入库，未公开原文或截图。这是聚焦回归，不是完整 #274 验收。

生产包指纹为 `353575dded064b84d3b97fca02b46012f49a40f6e915815fc7d0b87969556555`，包含经完整性核验的生成内置词典资源。已更新到用户原加载目录，备份旧包，未修改浏览器存储。用户仍需在扩展管理页重新加载并刷新页面，原浏览器视觉结果尚未验证。未发现当前已证明问题的代码 blocker；保留 draft，不声称独立审核或完整私有 Oxford 认证。LRU 等低优先级工作未展开。
