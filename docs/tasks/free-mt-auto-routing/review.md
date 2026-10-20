# 主 Agent 自查

主体：主 Agent；不是独立模型审核。基线 main@49fb4ed7，修改保留在独立 worktree，未提交。

核对实际调用链：配置规范化 → 快照 → 缓存业务适配层 → Coordinator/SingleFlight →
路由 → 薄协议注册表 → 唯一 transport；实际缓存写入走原 DB4 facade。

已修复：

- 真实槽提前释放：取消消费者与真实 fetch/正文清理分离，p-limit 仍持有在途传输；
  abort-ignoring fetch 超时不阻止消费者按预算返回，立即重试不能加入旧 flight。
- 不同 format 分组的成功段落丢失：保留已验证结果，缺失段落留原文并进入既有重试状态。
- 过期排队任务在零毫秒 timer 前发出请求：排队前同步检查剩余预算，启动时再次检查 abort。
- 非 MT 路径新增来源 DOM 查询：只在 MT 且有实际来源时访问，普通 AI 行为不变。
- 有道 Auto/Auto 可能反向翻译：请求明确目标，解析严格校验中英响应方向与字符串列表。
- 自动缓存计划再次 lookup 刷新写令牌：首次冻结并复用，清缓存标为不可写，拒绝旧缓存命中。

风险检查：没有新缓存库/任务框架/付费 fallback；API 凭据不进入新 adapter；不改变 host
permissions、DB4 schema、记录 envelope、词典或 Reading 权限。新增 DNR 能力只对固定端点、
本扩展发起的 POST 生效，安装失败不会降级到无规则请求。许可文本为精确安装包资产。

React 界面按已读取的两份 Vercel React best-practices 技能自查：保留 Hooks 顺序、稳定 client、
显式用户动作授权、disabled/loading/error、label 与 live status；卸载清理现有请求，
状态读取失败不会形成未处理 Promise。已查看真实窄屏设置和自动备用截图。

未解决限制：火山本环境真实连接失败，未加入默认池；国内直连/海外双环境、实际 Chrome 102、
商店发布/自动升级未验证。现有窄屏设置的全局 sticky 保存条仍使用原布局，完整页面截图中会
覆盖当前视口底部一小段内容；本次选择和提交交互通过，未扩展修改全局布局。

本任务无 commit/push/merge/release 授权，不冻结伪造 candidateHead 或宣称已合入。
