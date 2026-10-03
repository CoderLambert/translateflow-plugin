# [Platform][PF-03][P0] 实际 WXT 产物 E2E、旧用户升级连续性与默认构建切换

历史引用：[#248](https://github.com/CoderLambert/translateflow-plugin/issues/248)。2026-10-03 一次迁入；后续以本目录任务和本地证据为准。

## 流程迁移决策

下方是迁入的产品/工程合同。历史合同中的 Issue 评论/标签、远端 CI、自动 GitHub Review 和旧状态流不再是日常执行动作；统一采用 [LOCAL_WORKFLOW.md](../LOCAL_WORKFLOW.md) 的本地完整验收、真实浏览器/产物要求、具名独立审核及受保护代码同步。安全、数据、硬依赖与人工验收保持有效。原有“规划待启动”限制以用户本轮授权和 state.json 为准。

阶段一已合入 86ed596f8f266ac2d5c071b3bf681f2bb2d6ec2d；默认仍为 legacy。阶段二曾因路径等值漏判与真实源根破坏性负例丢失该工作区未提交源码，已恢复提交基线。路径安全修复归 path-safety 卡，未合入前不能最终切换。旧包固定基线 19e89b65fd3600073410407392da82ffa666ffc8，same-ID 实测仍须绑定最终切换候选。

## 执行卡
Parent #191；实现依赖 #246、#247。**最终切换还要求 #227 阻断性取消/数据安全问题已通过 #228 或等价修复合入并审核**；构建测试准备无需空等该 PR。规划待启动。
难度 L3；platform-qa 主执行，platform-build 负责切换 patch，独立高推理 reviewer 审核同一最终 head。禁止测试作者用放宽断言替代修复。

## 目标
证明新构建不仅能打包，还能保留用户已有配置、缓存和词典；通过后将 WXT 设为默认构建，结束两套构建长期并存。

## 实现
1. 改造 `e2e/support/extension-fixture.mjs`：读取指定的真实 production artifact，先复制后只在测试副本增加 mock 权限/fixture。不能继续默认调用旧 buildExtension 然后把结果称作 WXT 测试。测试专用词典/worker 注入通过 #246 的产物映射定位；测试不得补入新包遗漏的生产文件。
2. 保留 unmodified 生产包审计，与可控 fixture E2E 分开。分别验证开发缺词典模式、有效生成词典的 release 包、缺失/损坏/不兼容资源的诚实错误；release build 不得仅检查目录存在即绕过原认证。
3. 过渡阶段同一组故事跑旧产物和 WXT 产物：翻译/cache hit/restore miss零Provider、本地字典零Provider、Rich MDX/MDD/Worker/取消、Popup/Options/Commands、YouTube MAIN+fallback+SPA、防重复注入、权限拒绝/撤销与站点注册 union。失败区分已知 baseline、迁移回归和环境；不能沿用旧 head 认证。
4. 新增真正升级场景：同一个 Chromium profile、同一 extension ID，旧产物通过真实操作写配置/缓存并安装合成词典，关闭→替换为新产物→重开。核对原 DB/version/store、OPFS字节/活跃指针、词典启用/首选状态和配置结果均保留；有 release资源时另跑对应模式。不是两个干净 profile 各自成功。
5. 开发 ID 政策：已有 unpacked 用户优先保持同一加载目录/ID（可将新产物部署到原稳定目录），不能给现有用户突然换一把 key。测试固定公钥只用于隔离测试；已有商店项用原 ID。新目录或 ID 改变必须明确是不同 origin，无权限跨 origin 偷搬数据；禁止卸载/清空 profile 来“升级”。
6. 测试升级时旧标签里的失效脚本/消息、后台重启、反复注入、浏览器重启后的动态注册。提供可恢复提示/刷新途径，不自动重发付费请求；不承诺热更新永不中断。严格保持 listener 及时注册和取消/旧结果规则。
7. 同一合并候选 head 上验收通过后切换 `build:extension`、`build:extension:release` 和所有认证脚本/E2E消费者到 WXT；保留必要 buildExtension 返回字段或同PR更新全部消费者。`dist/extension` 保持用户稳定安装入口，可由 WXT产物受控复制生成。
8. 切换完成删除旧 build engine 的正式/CI入口，旧对照改为从已固定的旧 commit/artifact 获取。#246 的源码资源兼容桥仍是 WXT 内一部分，后由 PF-05 收口，不是继续维护两套 build。回退先停用新功能/回退兼容代码；不承诺商店允许降版本安装、不删除数据。
9. 记录产物 hash、Manifest允许diff、依赖/代码/词典字节、真实浏览器版本及实际CI。在单一 `docs/PLATFORM_UPGRADE_V1.md` 追加证据，不新建通用认证平台。

## 验收
- [ ] 全量适用 Chromium 回归测到 WXT产物；未修改包审计与 mock E2E 各自有证据。
- [ ] same-ID old→new→restart 数据连续，旧标签有真实恢复路径，零未经授权网络/权限变化。
- [ ] #227 阻断问题解决，当前 head 的 required CI/审核通过；真实YouTube/最低版本未测明确 NOT RUN。
- [ ] 默认安装/测试/发布构建只有 WXT，无隐蔽旧脚本仍生产不同包。
- [ ] React/Vitest/fixtures不进入非预期运行入口；预算满足 #245 或回到明确架构决策，不能改阈值假通过。

## 交付与不做
可以两个聚焦PR：先双产物/升级测试，再 exact-head 切换。不得跳过第一步直接切 main 构建。该任务完成只表示 Chrome工程基线可用，不等于学习中心完成或已获商店发布授权。后续直接接 #235/#236 产品交付，不先等待 Firefox/Safari/旧UI重写。

## 依据
https://playwright.dev/docs/chrome-extensions
https://developer.chrome.com/docs/extensions/reference/manifest/key
https://wxt.dev/guide/resources/migrate.html
