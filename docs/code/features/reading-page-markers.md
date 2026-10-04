# Reading：授权站点再访、页面标记与本页历史

[首页](../README.md) · [返回原文](reading-return-to-page.md) · [逐文件与验收证据](../modules/reading-page-markers.md) · [保存与学习中心](reading-records.md) · [启动](extension-startup.md)

固定源码 main `13041666b253ecf9aa86b3ff5edfa677dde01c05`，tree `55ced4b9fdc96690bfbb0a39b5ce195667806a55`。这是持续再访路径，和一次性 handoff/临时返回卡共用投影与 resolver，但拥有不同的刷新/清理状态。全文解释的文件与关联局部说明见模块章；本轮仅静态阅读，安装、生成、构建、测试和浏览器均 **NOT_RUN**。

已归档的 #240 `READING_ABC_PASS` 是候选 `1bbfdfb001f73f3175f0b47c9935cd4e486f3b71` 的 validate、WXT 与 Chromium 9/9 fixture 结果；不能继续将 ABC 整体写成未运行。其准确范围、6 个 A + 3 个 B/C 故事和未验证项见[证据链](../modules/reading-page-markers.md#evidence)。该包 fingerprint 不代表后续 #292/#293 源码的新包，也不消除下文静态合同差异。

<a id="entry"></a>
## 1. 用户开启的是站点意图，读的是当前页

用户在学习中心详情可信点击 Enable site markers，`ReturnToPage → client.setMarkers → service → auto-sites.setReadingMemorySite` 保存 `readingMemorySites`。开启还需有效 origin 权限；拒绝保留先前意图并返回 permission-required。意图、记录总开关、Reading 站点排除、自动翻译/cache restore/Quick Control 是不同状态，不以切换 marker 清历史或撤销其它功能。

普通 http/https 页由 Manifest 的静态 document_idle Content 列表启动。前序 projection、reading-source、reading-contract、UI 已在，reading-record 的 owned entry 装上 handoff 和 marker。首次 marker load 等待 `readingHandoff.ready`；focus 或 route 切换调用 register，后台用真实 sender/tab/top-frame/document、nonce collector 和 pageKey 注册，不相信网页自报身份。无当前 Selection operation 的 register/page proof 可通过，但不能据此读取任意记录详情或写入。

`GET_SITE_MARKERS` 的 Content 请求不带 siteKey，后台从 access 推导；只有 ready/enabled 才继续 `GET_PAGE_SUMMARY`。service 先读实时站点 policy，排除站点禁止摘要；记录 enabled=false 只阻止新增写入，不默认阻止旧页摘要，因此暂停后仍可回看历史。已拒绝或中断的注册不会被当作已获得页面能力，后续请求照常被 access/session 拒绝。

<a id="summary"></a>
## 2. 最小摘要、分页与数量来自哪里

`marker.send → service.handle → repository.read → query.read` 在独立 Reading IDB 只读事务中按真实 access.pageKey 走 pageRecent 索引。每项只有 recordId、revision、anchor、hasCompletedAssistant；没有 artifact 问答、URL、Provider 信息或全局历史列表。hasCompletedAssistant 在写入形成 listItem 时由保存的 assistant artifacts 派生，Content 不靠逐条 GET_RECORD 猜类型。

每页请求 limit=100，响应受 1 MiB 完整消息预算和条数限制；query 预留封装字节。pageRecordCount 来自 pages 元数据，不拉取所有详情计总数；pageRevision 与 cursor 同时返回。cursor 在后台内存，绑定 owner/authority/navigation/document/method/page/query/limit 和 catalog/consent/data/page revisions，单次消费、10 分钟原始 TTL、并发 busy，任何相关变动报 STALE_OPERATION。worker 重启旧 cursor 失效。

marker 的循环取到 nextCursor=null 或已累计至少 200 项，然后 slice(0,200)。正常满页为两次；实现以累计条数/cursor截止，没有独立请求次数计数。query另有字节截断分支，未来改变单项大小或消息上限时须重新核对“两次”的前提，不能只改条数常量。客户端不另比较两页的 pageRevision；当前一致性依赖后台 cursor 校验及最后 generation 检查。中间失败整次清 UI，不把部分旧页与新计数拼成成功。

UI 按钮显示“本页历史 N”；N 是后台总数。若 N 大于 loaded items，则标题“定位前 K 条”，K 是本轮取回候选数；每行给定位状态。当前没有单独已检查/已定位计数，也没有第 201 条之后的本页分页按钮，不能把 K 或可见圆点数写成全页历史定位率。更多历史需去学习中心，不能宣传本页已经提供手动续页。

<a id="resolver"></a>
## 3. 批量定位先过更小的 body 投影门槛

`resolvePage` 与单条 `resolve` 共用 exact、prefix/suffix、blockDigest、UTF-16→Range 映射；旧 position 不是定位结果。批量调用先 `project(document.body)`，所有候选复用该投影，并缓存命中块的局部投影和 digest，不逐条重新扫全页。

关键区别：底层一次 project 的硬门槛是 **16,000 UTF-16 单位 / 500 节点 / 8ms**。body 达到其中一个预算即返回 unsupported+budget reason；resolvePage 立即把全批设 not-loaded。非预算原因则全批 unsupported。它没有单条 resolve 在 body 失败后收集 paragraph/root 再扫描的 fallback。1M 字符 / 25k 节点 / 250ms 是后续总预算，不能覆盖前面的单片门槛。长文章可能仍能手动单条返回，却整批没有任何 marker；这是源码静态推导，不是本轮浏览器耗时/失败复现。

body 成功后，按 exactOffsets 找候选，再定位最近的块、核对局部上下文及可选 digest，同一 Range 去重；多 Range ambiguous、无匹配 missing、预算不足 not-loaded。当前结果优先级仍是“多个→ambiguous，一个→resolved，其余再看 limited”：预算用完时已找到一个不能当作已证明所有未扫描位置都不重复。revision 变动最多三次递归重试，150ms 间隔；此计数只约束一次 resolvePage 的 revision 恢复，不是整个页面的所有 load。

普通 query 的 capture 也走同一 source projection，saved anchor.status 描述保存时的证据；再访必须重新核验现在的 DOM，不能直接信旧 resolved。投影排除扩展 UI、译文、隐藏/编辑/敏感节点并保守拒绝不支持的 shadow/custom host，具体实现见[投影边界](../modules/reading-page-markers.md#projection-boundary)。

<a id="ui"></a>
## 4. 圆点到列表，再到准确历史详情

render 为每个摘要创建 quote 按钮、状态和“查看记录”。**当前所有 resolved 记录都画圆点，未读取 hasCompletedAssistant 来过滤**；本地词典查询也会画点，现有 marker E2E 正是这个输入。普通记录仅列表、completed AI 才自动轻标是原始 #239 Issue 的较强要求，不能把它写成已实现。

圆点是扩展 Shadow layer 中的 button，使用 Range 的第一个正面积 rect 定位；没有 CSS Highlight API/命中 feature detection 分支，也不包裹或改写正文。点击圆点展开列表并聚焦对应 quote；点击 quote 滚至 Range 起点父元素；可信“查看记录”只发 OPEN_LEARNING_CENTER(recordId)，固定新标签 deep link 再由扩展页读取详情。没有自动 N+1 get-record、hover 全文预读或新词典/Provider 查询。

位置监听直接在 scroll/resize 回调中测所有 marker rect，不是临时卡的 RAF 合并；无 rect 的 marker.hidden=true。token 的 `[hidden] { display:none !important; }` 实际生效，不能把 panel 的 display:grid 误报为隐藏失效。toggle/关闭改变 hidden 与 aria-expanded；marker 模块本身没有 Escape handler 或关闭后焦点返回，不能套用临时返回卡的 Escape 验收。同位置多个 record 也没有位置去重/重叠优先级算法。

历史 quote/label 的 open Shadow 风险沿用[前章既有警告](reading-return-to-page.md#5-必须保留的隐私警告)，本轮没有重复定性成新发现或修复；样式隔离和安全 textContent 不提供对宿主页脚本的保密性。

<a id="lifecycle"></a>
## 5. 刷新、暂停、删除、撤权与取消

| 触发 | 当前链路与用户可见效果 | 不能夸大的边界 |
| --- | --- | --- |
| 正常 load / 新 load | generation++，abort 上次 resolver，断 observer、清 timer/旧 UI；请求和 resolve 后核对 generation | 已发送的 runtime 请求不因 AbortController 撤回；摘要循环没有每页取消检查，旧请求可能继续到上限，但不应通过最后 generation 检查重画 |
| body mutation | 成功 render 后监听 subtree childList/characterData/attributes，150ms 合并后重新 load 全部候选 | 不是仅更新受影响记录；每次 load 新建 resolver 预算，controller 无终身三次/总预算；属性噪声同样触发，不使用 projection.sourceMutation 过滤 |
| SPA 路由 | popstate/hashchange/Navigation navigate 先 cleanup，150ms 后重新注册再拉摘要 | route listeners 长期保留；无 Navigation API 时未在该模块装 pushState 包装器。测试主动 dispatch popstate，不能证明所有站点路由 |
| pagehide / focus | pagehide 的 once handler cleanup；focus 尝试 connect 并 register/load | 没有 pageshow 专用 BFCache 恢复；cleanup 不主动断 port，也不拆永久 route/focus listeners，不能宣称完整卸载/零资源驻留 |
| 删除/清空 | 管理事务提交后 publisher→订阅重新读 revisions→Content load；旧 UI 先清，空页不渲染 | invalidate 只带代数，不带全文；不能把发出请求等同实际提交。GET_RECORD 更新 lastViewedAt/revision 也可能触发刷新 |
| 全局暂停 | consentGeneration 改变、写入/operation 撤销；摘要只读未被 enabled 门槛挡住 | 保留旧历史是当前规则；中途 cursor 因 consent 变化失败需下一次 load，暂停不代表删除 |
| 站点排除 / 权限撤销 / 断线 | policy 拒绝、订阅发布失败断 port，或 runtime.revoke + close ports；onDisconnect cleanup | 清理后只在后续 focus 等时机显式恢复连接，不是可靠的后台自动重连机制 |
| 关闭 marker 意图 | auto-sites 保存 readingMemorySites=false；下一次 GET_SITE_MARKERS 拒绝继续 | 该 setter 不经 Reading repository publisher；marker 无 storage.onChanged 监听，已读根 content.js 也不处理 readingMemorySites。无其它事件时立即清点的通路未在本链找到，需专项验证 |

“取消定位”仅释放当前 controller 的 Range/UI 与阻止旧 generation render，既不撤销已保存历史，也不等于 Selection 保存 CANCEL_OPERATION 返回 cancelled。后者必须按后台 committed/cancelled ACK 显示，详见[保存模块](../modules/reading-records.md)。

<a id="boundaries"></a>
## 6. 如何使用现有 PASS，哪里还要验证

- 已归档 #239 1 个 marker 浏览器故事；#240 又在同一产品包上运行 A 六个、handoff/return/marker 三个，共 9/9。它们证明各自合成 fixture 的预期，不是所有 Issue 验收条款都被断言覆盖。
- marker 故事只有一条普通本地查询，点击开启、再访、inline 替换、SPA 离开/返回与 Provider=0；没有 201+、分页源变动、AI-only、长期 mutation、真实撤权、BFCache、marker Escape/命中降级矩阵。
- resolver 的 Node fixture 将 performance.now 固定 0；marker-measurement.json 测的是 200 项 DTO 的构造/字节，不是 DOM/layout/IDB。两者都不能给“真实 250ms 长页预算 PASS”。
- 小片 body 提前失败、部分扫描下唯一性、终身 mutation 预算、数量/续页、开关即时失效与 UI 键盘合同是独立待核对项；文档不修改代码，不把这些静态差异伪装成本轮运行 FAIL，也不因 ABC_PASS 抹掉它们。
- Chrome 102/其它浏览器、隐身、真实权限提示/商店权限迁移、真实 Oxford 词典与发布均不由 ABC fixture 认证。原始日志、包和截图未在本轮取得或复验。

修改 marker 的用户入口先读 ReturnToPage/auto-sites；改摘要读 repository/query/list/response；改匹配读 resolver/projection；改清理读 marker/runtime/subscriptions；改生成清单读 owned entry 与 drift test。建议下一步只对上述有证据的合同差异做独立授权的产品决策/验证，不为本篇导读运行全部开发流水线。
