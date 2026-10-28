# 免费网页服务的首发范围核对

代码提供客户端 adapter，不等于服务方授权，也不等于官方 API 合同。本轮不静默移除用户既有服务、不新增供应商、不放宽请求限制。下表的“未确认”是尚缺可依赖的服务方依据，不能被本地请求成功或开源实现许可证替代。

| 当前网页入口 | 自动池 | 当前确认范围 | 首发前需补 |
| --- | --- | --- | --- |
| Microsoft `edge.microsoft.com/translate/translatetext` | 是 | 源码固定 HTTPS 网页端点，无 API Key | 核对该具体网页接口是否允许第三方公开客户端使用；Azure Translator 的付费 API 说明不能自动授权此接口 |
| Bilibili `index-translate.bilibili.com/v1/chat/completions` | 是 | 固定端点，扩展专属 DNR 规则移除 Origin | 具体端点的公开使用许可与限流、DNR 头处理的允许性；不能拿同平台模型开源许可代替托管服务许可 |
| Google `translate.googleapis.com/translate_a/single` | 是 | 固定 HTTPS 网页服务路径 | 具体路径的允许使用条件；Cloud Translation 正式认证 API 与该路径分开核对 |
| Youdao `aidemo.youdao.com/trans` | 是 | 固定 demo 网页端点 | demo 服务是否允许公开分发与持续使用、流量和地域条件 |
| Volcengine `translate.volcengine.com/crx/translate/v1` | 否，手动 | 固定网页端点 | 浏览器端点的允许范围、第三方客户端和限流条件 |
| Tencent `transmart.qq.com/api/imt` | 否，手动 | 固定 Transmart 网页端点 | Transmart 具体服务条件；腾讯云 TMT 正式 API 的合同不自动适用于此入口 |

本轮尝试读取 Microsoft Learn、Google Cloud、Volcengine、有道智云和腾讯云的第一方 API 页面；资料工具因目标解析到 198.18.0.0/15 的环境地址而拒绝访问，未绕过该限制，也未将未读取页面当作已核实条款。即使取得正式云 API 文档，仍需回到当前网页端点的适用条件。

可由维护者后续核对的第一方入口（本轮访问受阻，非授权证明）：

- https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/v3/translate
- https://cloud.google.com/translate/docs/reference/rest/v2/translate
- https://www.volcengine.com/docs/4640/65067
- https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/index.html
- https://cloud.tencent.com/document/product/551/15619

首发决策建议：只把已有适用授权或可明确确认使用条件的服务列入稳定承诺；未确认项保持发布阻塞项，或由维护者明确选择调整发布范围。任何调整都应同步自动池、同意文案、DNR 权限、隐私政策和测试，不只隐藏入口。不能仅在商店写“实验”就免除条款义务。

当前商店文案已经去掉“永久免费、无限量、官方合作、所有网络稳定”等承诺，隐私政策列明实际接收方和自动切换。此文档不对服务是否违规下未经核实的结论。
