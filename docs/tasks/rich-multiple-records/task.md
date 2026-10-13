# #270 同键多记录与有界 alias 集合解析

基线 main `320f78e2b34fc16648e35369b06c473f1a58c68e`。PR #327 已完成 Stripkey/schema2及受影响legacy迁移，合后main验证PASS；不重做。用户明确授权 WIP=1 连续收口、独立审核、guarded merge/合后main验证与Issue校准，覆盖日常默认。

真实Oxford全record流式统计（不导出正文）：133571records中82261alias/51310real；5185重复display组最大7，其中3405alias+real。1930组含多个alias并指向不同terminals；313alias路径汇合。143对双向offset回边的节点均有real sibling，582alias有循环branch但全部有validterminal；不能因一条回边拒绝整词，也不能用folded key visited吞真实义项。完整终端原文合计最大806930bytes，去重block decoded最大842644bytes。

只读图模拟（不计正文parser工作、无memo）：完整查询实际候选span/node visits最大23，alias expansion11/edges21/distinctalias9；全路径8links、offset回边剪枝、terminals输出去重。CPU guard起点256次实际span访问（含roots/cachehit/terminal重访/cycle剪枝），约该包实测最大11倍，不是所有词典承诺。每次候选批量入队前检查；matched64仅最终exact或folded集合，扫描1m entries计真实工作；超限明确LIMIT，不截断。

目标：先全部exact spelling，否则folded集合；原key顺序稳定；同offset去重，distinct有效span全部保留；逐alias路径最多8links且offset/path检测环，valid sibling继续，terminal全局去重。only-cycle/missing/corrupt/budget错误诚实拒绝，不吞记录。

Parser以records[]为正式结果，first scalar兼容；每item保留rawRecord、source/decodedbytes、displayForm、稳定offset/span及必要alias来源。后台数组和累计预算验证；sharedstyle规则避免任意重复payload。前端归一化新数组/旧scalar，独立AST sanitizer/Shadow viewer渲染全部record，保持ID/fragment隔离、一次onDisplay与现有session/request/generation保护。raw HTML不可任意相邻拼接。

预算保持：单source1MiB、text2MiB；整个结果累计source1MiB/decoded2MiB，Compact展开/节点/资源也累计受既有2MiB/32768/1024限制。仅按已计量有界query cache避免重复block解压；总index LRU、CSS/fonts/SVG、navigation/Unified Article Shell与附件恢复另切片。不改持久index格式、权限/CSP/Provider/缓存/Reading存储，不清OPFS，不提交私有词条。

验收：same key/same offset、distinct offsets、exact vs folded、alias target、重复offset、跨key/record block、corrupt span；mixed alias+real、循环branch+valid sibling、only-cycle、convergent terminals、bytes/CPU cap、取消与旧generation。真实MV3界面全部sentinel/各record样式及fragment不串，Provider=0/external=0；同一真实Oxford只读新parser输出仅计数/元数据，对照旧单record结果，不冒充真实Oxford浏览器终验。命令与产物要求在state.json唯一登记。
