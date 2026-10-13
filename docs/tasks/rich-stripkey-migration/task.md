# #270 Stripkey 兼容与受影响派生索引迁移

基线 main `f1d655c30299286ca454f6a030d2d52d988a0c08`；前置 task0 / PR #326 已合入且合后 Node26/Chromium multi-dictionary6/6 PASS。用户授权 WIP=1 连续实施、独立审核、guarded merge、Issue 校准，覆盖日常不调用远端/不自动独审默认。

真实 Oxford 原 header 仅含 Stripkey="Yes"，无 StripKey，KeyCaseSensitive="No"；当前得到 stripKey=false。输入身份本机已校验，MDX 38,807,694 bytes / SHA256 737a93e9a25bfdaf5ee1683b4a0aff43ec5a9ed6238700526e258c79cad24e19。旧 schema1 compact index607,436 bytes，133,571 keys/90 key blocks/5,607 record blocks。此证据足以推进兼容修复；#269 的欧路/完整基线其余未测边界仍保留，不机械把历史blocked当代码不可推进。

目标：只接受已验证 Stripkey 别名，保留标准 StripKey 和原 default=false；冲突明确拒绝，不lowercase所有属性。新派生index明确schema/normalization版本，严谨读取legacy1；只有原header证明受影响时重建lookup bounds。校验独立新派生文件后原子激活指针，保留原MDX/MDD、旧index与用户settings；失败/取消/stale不激活坏索引，不清OPFS。

范围：metadata/index/validation与现有manager/index加载/严格固定路径指针，必要迁移helper和Node/MV3 OPFS恢复测试。shared合同/权限/CSP/Provider无变化。多record spans、总LRU、CSS/fonts/SVG、navigation与附件恢复另一个串行切片，不搭便车。

验收：别名Yes/No/标准/默认/未知拼写/冲突；affected legacy迁移与restart；unaffected不重建；原文件/资源/偏好不丢；写入/校验/状态失败和取消保留旧pointer；replace/uninstall竞态不能stale激活；旧cache不错误复用；真实本地有界header与Oxford查询验证仅输出脱敏元数据，零Provider、零词典外网。完整命令以state.json为唯一登记，PASS绑定准确候选与实际包；旧记录不改写为当前PASS。

派生索引激活取消边界：mutator前取消不激活；storage.set进入不可逆提交窗口后若指针已成功提交，则如实保留新有效索引，不声称回滚。Selection lookup仍可因自身取消结束，不把它等同于派生迁移撤回。冷加载须拒绝已被替换或卸载的旧packVersion，不能把另一版本index交给旧sourceReader。
