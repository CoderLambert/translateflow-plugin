# 免费翻译自动备用本地验收

2026-10-20；主 Agent 实现、自查。worktree：
`translateflow-free-mt-routing`；
branch：`feat/free-mt-auto-routing-20261020`；基线 `49fb4ed7dcbdc49684d79803e0640b2b9fa093c0`。
未获提交/推送/合并授权，candidateHead/syncHead/mergeHead 均为空，没有新 PR。
本地状态 reviewing 不表示已合入。验证对象是未提交实现，不能冒充 Git 候选冻结或 local gate PASS。

## 用户可使用的结果

Settings/Popup 可以选择自动备用或固定服务；自动池为微软、B站、谷歌、有道，
最近成功方向优先。腾讯保持手选；火山有适配器但真实请求失败，未加入默认池。
自动失败保留已完成段落，未完成部分保留原文并使用现有重试入口。
缓存写入保留实际来源和首次写令牌；清缓存不会被换线任务回填。

安装目录：当前 worktree 的 `dist/extension/`（WXT MV3，仍为 0.8.40；没有提交版本递增）。
最终包 131 个文件，3,000,119 bytes，未附带词典；fingerprint：
`c08f1f6cf0b43e7aada4b58e6d240dd2e7be486afc3e8ca7d4bbccb2d97aed49`。
源码/测试/构建输入清单 843 项 fingerprint：
`c95e1fe8cf361b26c6d8ffcbf4cc6f6cb1d5faf4ebcb73a48040ac5e7f42de04`。
完整清单、日志和实际包 inventory 在忽略的 `docs/task-execution/local/free-mt-auto-routing/`。

## 实际检查

| 命令/验证 | 结果与范围 |
| --- | --- |
| `npm run validate` | 初次集成 FAIL：Node 1928 项中 1923 PASS / 5 FAIL。4 项因普通 AI fixture 没有新增 DOM 查询方法，1 项是 DNR 权限合同旧断言。均已修复并定向重验；没有把该次执行改写为 PASS，没有重复完整 validate。 |
| `node --test tests/cache-system-persistence-failure.test.mjs tests/release-gate.test.mjs tests/machine-translation-routing.test.mjs tests/machine-translation.test.mjs tests/tasks.test.mjs tests/wxt-assets.test.mjs` | 78 PASS，覆盖上述 5 个失败项及受影响合同。后续 transport 生命周期、语言解析变更再按以下范围验证。 |
| `node --test tests/machine-translation-routing.test.mjs tests/machine-translation.test.mjs` | 最终逻辑 55 PASS，含 18 项新路由/生命周期测试；包括超时早于 abort-ignoring HTTP 清理返回、真实槽不提前释放、过期排队零 HTTP、取消立即重试、固定不换线、429/403/5xx/空/协议错误备用、冷却恢复、真实缓存来源及写入围栏。 |
| `npm run check` | PASS，793 个 JS/TS/TSX 文件语法与架构边界；runtime 依赖仅向两个精确模块开放。 |
| `npm run typecheck` | PASS，严格 TS；变更 TS/TSX 后执行。 |
| `npm run test:unit` | PASS，12 files / 70 tests。 |
| `npm run build:extension` | PASS，最终稳定目录 WXT chrome102 目标、Manifest/闭包/资源审计，包含精确 MIT 法律告知资产。 |
| `npm run build:extension:wxt` | PASS，开发中实际构建显式路径；最终交付以稳定目录和下述 fingerprint 为准。 |
| `TF_E2E_ARTIFACT=dist/extension npm run test:e2e -- e2e/machine-translation.spec.mjs --workers=1 --retries=0` | 12 PASS / 23.0s，Chrome 153.0.8010.12，mock HTTP + 实际 MV3/IndexedDB/UI/DOM；绑定逻辑完成包 `88929560b153f440b424dc3f46f5e61fc42f00e8412a9f6748d57b62417e814f`。 |
| 最后仅英文联网告知文案更改后的 `npm run check:i18n` | PASS，1173 keys；中文流程/生产逻辑未变，复用上项有效结果。 |
| `TF_E2E_ARTIFACT=dist/extension npm run test:e2e -- e2e/machine-translation.spec.mjs --grep 'Options applies\|automatic backup uses' --workers=1 --retries=0` | 2 PASS / 5.0s；最终交付包 `c08f1f6c...` 重新验证设置授权/固定连接检查和自动备用/实际来源/DB4 恢复。 |
| `git diff --check` | PASS。 |

浏览器测试覆盖：原有 AI 模式、微软/腾讯固定模式隔离、code/kbd/URL 保护、词典命中不联网、
划词与已有 Reading artifact、Options/Popup 窄屏、取消和导航、B站备用及 DNR 条件负例、
清缓存期间显示结果但不回填、同 profile 重启后 cacheOnly 0 新请求。
DNR 负例检查实际安装规则的 initiator/method/精确 regex；未宣称执行了所有网页发起者的网络抓包。
截图位于忽略的 `docs/task-execution/local/free-online-mt/`：`settings-narrow.png`、
`popup.png`、`automatic-backup.png` 等，已由主 Agent 查看。

## 真实服务和网络限制

最终包 fingerprint `c08f1f6c...`，Chrome 153.0.8010.12：

- 微软、B站、谷歌、有道：固定模式均真实成功；有道额外验证中→英，英→中也成功。
- 只给微软注入网络失败后，自动路由通过真实 HTTP 切到 B站成功（约 3.8 秒）。不是真实线路故障声明。
- 本轮最终包实发 6 次固定非敏感例句 HTTP。另一次微软检查被存活的内存冷却拒绝，未联网；
  移除存储键无法绕过冷却。随后在独立临时 profile 真实验证微软成功（约 1.4 秒）。
- `live-delivery.json` 保存精确包 fingerprint、归一化结果和这一测试隔离说明，不保留完整供应商响应。
- 较早实际编译包对火山返回 `MT_NETWORK`，故排除默认池；不宣称火山实际可用。

当前网络出口类型 UNKNOWN；没有修改代理/VPN/DNS。**国内直连和海外网络各至少两家成功的要求
NOT VERIFIED**。实际 Chrome 102 运行 NOT VERIFIED；构建目标仍为 chrome102。
商店更新、发布、完整无关 E2E、真实私有词典与最终提交冻结 NOT RUN。

代码/来源/兼容细节见 [design.md](design.md)，主 Agent 自查见 [review.md](review.md)。

公开记录已移除个人 home 路径与本机扩展身份；准确安装路径、扩展 ID 和备份位置仅保存在 Git 忽略的本地安装记录中。
