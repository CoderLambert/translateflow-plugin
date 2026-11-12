# SDK 交付后正文漏译回归

根因已证实：SDK 工作区从 main 建立，而用户此前加载包来自另一个未合入工作区；交付前没有核对该包的既有功能来源。新包因此缺失语义 span/通用 TranslationUnit、卡片水合恢复、锚点保留和同任务并发消费者隔离。原加载目录和 Key 本身没有变化。不是通过换服务商、清缓存或放宽完成态修复。

红灯证据：`page-regression-red.log` 中 4 个预期来源只发现 heading/card，两个正文 span 缺失；`page-concurrency-red.log` 中同任务 6 批仅最后一批成功，其余被错误取消。SDK 传输与设置合同保留；相关已有生产实现从原工作区携回当前候选，原目录源码只读。精确文件/来源 SHA 清单在 `carried-forward-files.json`。

| 验证 | 结果 |
| --- | --- |
| Node 新旧正文单元、范围、观察、锚点、并发回归 | PASS，53 项，page-node.log |
| 受影响缓存/页面/批处理/SDK 回归 | PASS，160 项，page-affected.log |
| 设置范围组件 | PASS，23 项，page-options.log |
| check / typecheck / build:extension:wxt | PASS，page-check.log / page-types.log / page-build.log |
| 通用片段、Shadow/slot、动态页面、取消、span、水合、Provider 的 20 场景 | 首轮 16 PASS、4 FAIL；失败均为旧 Provider 测试只计算原来的三段正文而不计算现已覆盖的短标题。保留请求分成 plain/rich 两次的断言；增加三段正文各自上屏断言后，4 项定向重验全部 PASS（page-provider-final.log），其余 16 PASS 复用 |
| 用户公开 URL + 实际 MV3 安装包 + 延迟 mock Provider | PASS，41/41 单元、12/12 长正文、missing=0，5 次 mock 请求；page-live.log 和截图 |
| diff whitespace | PASS |

最终实际包 tree SHA-256（浏览器 fixture 记录）：`e414410900a8eeb07817ed7130ed39efe1d64718abe2cb1847b7c318711bd292`；147 文件，5,072,053 bytes。该指纹属于本次修复包，不能沿用前一包的部署 receipt。新 receipt 见本地 page-installed-copy.json。

主 Agent 自查：携回范围限于已加载包原有网页覆盖/生命周期及其关联设置，不覆盖 SDK adapter、reasoning 合同和完成态校验。沿用唯一 WXT Content 图、shared translation.css、后台配置/取消机制；SDK 仍仅后台，无权限/CSP 扩大、不改存储 schema、不清用户配置或词典。所有恢复/缓存测试均保留“仅恢复不发 Provider”断言。验证是公开网页 + mock，不宣称真实厂商或所有网站验收；未提交或合并。
