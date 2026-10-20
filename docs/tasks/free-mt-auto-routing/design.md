# 免费服务协议、缓存和依赖记录

实现基于用户提供的设计，沿用 Translation Coordinator/SingleFlight、配置快照和 DB4。
自动计划由快照持有，缓存业务消息适配层转换实际供应商操作；service/storage 不认识服务池。
`routeCandidates` 是后台生成的具体配置列表，不注册名为 auto 的 Provider。
每段完整地重试候选服务，已完成段落保留；段落内的全部文字槽只采用同一服务结果。
同一批次（包括不同 format 分组）共享 25 秒预算；网页 HTTP 5 秒，B站 8 秒，排队/读取/清理占用真实容量。
消费者取消通过既有 SingleFlight 立即返回；实际传输仍占用 p-limit 和单服务槽直至结算。

## 来源与许可

| 来源 | 固定源码 | 采用的协议行为 |
| --- | --- | --- |
| Bilibili Index Translate | `9aff74ca50c60873916f99269b10cd0d79237b4a`，`inference/llm/call_api.py` | 固定 `/v1/chat/completions`、`Index-Translate-35B-A3B`、unary、关闭 thinking、仅完整 stop 输出 |
| KISS Translator | `a1279f2517bd478ef1dd93b941f9177094486cd4`，`src/apis/trans.js` | Google gtx GET 参数；火山 `/crx/translate/v1` 及 source_language/target_language/translation 字段 |
| FluentRead | `2cff10745b42bc15d5329aeb2bf6d15e923c3a86`，`src/providers/translation/free-chinese-web.ts` | 有道限制中英方向、响应方向验证、分块和取消结算的故障边界；未采用其签名协议或源码 |

源码链接：[B站官方示例](https://github.com/bilibili/Index-Translate/blob/9aff74ca50c60873916f99269b10cd0d79237b4a/inference/llm/call_api.py)、[KISS](https://github.com/fishjar/kiss-translator/blob/a1279f2517bd478ef1dd93b941f9177094486cd4/src/apis/trans.js)、[FluentRead](https://github.com/Bistutu/FluentRead/blob/2cff10745b42bc15d5329aeb2bf6d15e923c3a86/src/providers/translation/free-chinese-web.ts)。
仅独立实现请求/响应合同，没有复制 GPL 框架或代码，不改变仓库许可。
有道采用固定公开演示端点 `https://aidemo.youdao.com/trans`，明确指定语言、验证 `l` 的输出方向；
没有引入签名密钥、网页脚本或付费云账号。真实扩展中英双向验收与合成响应分开记录。

锁定直接运行依赖：`p-retry@8.0.1`、`p-limit@7.2.0`（MIT）。
实际传递依赖及完整许可见 [安装包许可资产](../../../assets/licenses/free-mt.txt) 和 package-lock.json。
精确资产映射只额外加入这个法律告知文本，不引入文档、测试或 node_modules。
WXT 保持 `chrome102` 目标；不向 p-retry 传依赖新浏览器 `signal.throwIfAborted()` 的选项，
现有 AbortController/transport 与协调器负责取消；实际 Chrome 102 运行仍未验证。

## 默认池准入和运行

自动池顺序：微软 → B站 → 谷歌 → 有道；腾讯仅固定模式。
火山协议已实现并有合成测试，但当前网络真实 MV3 返回 `MT_NETWORK`，因此不启用为默认候选。
进入自动池的四家均有实际编译扩展中的成功回执；这不证明长期可用性或不同网络均可用。
每方向最近成功线路优先 10 分钟。冷却持久化复用原 `tfMtCooldown:<id>` 键，
30/60/120 秒递增，上限 5 分钟；429 至少 60 秒、403 至少 5 分钟并遵守 Retry-After。
到期后下一个用户任务可以恢复探测，不启动后台定时联网。

B站新增 `declarativeNetRequestWithHostAccess`，已有 host permissions 不变。
Session rule 12001 必须安装成功才请求，只移除本扩展发出的固定 POST 翻译 URL 的 Origin；
精确 regex、initiatorDomains、requestMethods、resourceTypes 限制其他网页/域名/端点。

## 配置与兼容

设置 version 2 包含 mode、routing、providerId、sourceLanguage；免费模式内默认自动，
整个扩展保持独立 legacy/AI/本地模式。用户明确要求的旧 version 1 设置规范化为新版默认值，
因此升级后需重新同意并启用免费模式；不删除原设置、缓存、AI 凭据、Reading 或词典。
微软/腾讯固定模式缓存 identity 保持原有 protocol/input 版本；新增服务各有协议版本。
数据库 schema、entries/epochs 和通用 envelope 不变。

首次 lookup 为各候选冻结配置和写令牌；命中保留具体来源，cacheOnly 不调用 Provider。
网络结果绑定不透明 routeRef、原文结构、实际服务、结果和 request；Content 不持有候选令牌。
store 核对 routeRef 与文本后用原令牌写具体配置，跨服务不混存。
清缓存立即把相关计划标为不可写；结果可以显示，但不能用换线或再次 lookup 刷新令牌。
配置、页面/文档变化和 worker 重启使旧快照失效；新任务重新建立计划。

Options/Popup 的「翻译方式」统一分层选择：免费在线默认自动选择，手动服务折叠显示，
折叠不修改选择；Options 保留独立保存和连接检查，仅相关错误时显示冷却诊断。
Popup 草稿由唯一主按钮完成授权、本站保存和翻译，关闭前未提交的草稿不会持久化；Quick Control 跟随当前任务显示换线，
段落 title/data-provider-id 与划词来源标记显示实际服务。缺失段落保留原文并提供既有重试入口。
