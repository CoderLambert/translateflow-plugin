# 按变更选测与并发约定

Node、Vitest、普通 Playwright 的本地默认并发上限为 10，`TF_TEST_WORKERS=5` 可下调，实际取 CPU、文件数、上限的最小值。所有 Actions 显式设置 `TF_TEST_WORKERS=2`。不同时启动三类 runner；构建与 `wxt prepare` 顺序执行。同一任务的 acceptance.json 只由一个进程写入。

| 改动模块 | 开发阶段命令示例 |
| --- | --- |
| 缓存/配置/Provider | `npm test -- 'tests/cache*.test.mjs' 'tests/provider*.test.mjs'`，对应 `npm run test:e2e -- e2e/cache-system-mv3.spec.mjs e2e/provider-connections.spec.mjs` |
| 划词/取消 | `npm test -- tests/selection-v2.test.mjs tests/rich-mdict-lookup-cancellation.test.mjs`，`npm run test:e2e -- e2e/selection-rich-lookup-cancel.spec.mjs` |
| 词典富文本/输入安全 | `npm run test:rich-mdict-security`，`npm run test:e2e:rich-mdict` |
| Popup/Options React | `npm run test:unit -- tests/unit/options-react.test.tsx`（按实际存在文件选择），`npm run typecheck`，对应设置页 E2E |
| 测试基础设施/workflow | `npm test -- tests/test-concurrency.test.mjs tests/local-task.test.mjs tests/wxt-e2e-entry.test.mjs`，`npm run test:e2e -- --list` |
| 只改 fixture | 选其实际消费者；生产输入不变时复用同一已审计包 |

完整验收顺序：`npm run validate` → `npm run build:extension:wxt` → 两目录 smoke → `npm run test:e2e`。`validate` 不含 E2E。E2E 默认使用 `.output/chrome-mv3`；`TF_E2E_ARTIFACT=dist/extension` 可让完整回归消费标准包。CI 只在标准包上执行一套完整回归，两个目录均独立构建/审计/smoke。

`test:e2e` 无文件参数时先执行普通功能，再以单 worker 执行 `scripts/test-concurrency.mjs` 登记的专项。`npm run test:e2e:special` 显式运行这些专项；`npm run test:e2e:upgrade` 单独运行升级。完整升级需 `TF_UPGRADE_OLD_ARTIFACT` 指向固定旧提交 `19e89b65fd3600073410407392da82ffa666ffc8` 的产物，`TF_UPGRADE_NEW_ARTIFACT` 指向本次标准包。用户词典升级还需 `TF_USER_DICTIONARY_OLD_ARTIFACT` 指向固定移除前 main `349321a079544a51834de1b3173f1fc653220e6d` 的 WXT 包；CI 顺序构建该旧包以保留升级覆盖。大型 MDD 和真实语料沿用既有环境变量，缺输入明确 SKIP；不能把无语料运行当发布认证。

同文件按顺序、每用例独立 profile、零重试。默认报告在 `test-results/run-<时间>-<唯一标识>/`，spec 默认证据各自独立。显式证据目录供现有认证消费者使用，调用方必须为每次运行分配独立目录；不得并发写同一任务证据。Playwright 使用依赖项目保证普通功能结束后才执行串行专项，单次 reporter 覆盖两个阶段；定向文件与 `--special` 不额外运行依赖项目。完整验收使用 npm 入口。

PoC 审计：`design-freeze-poc` 保留独有的 OPFS 重启、签名篡改、Range 读取断言，并串行运行；`design-freeze-selection-slice` 的注入式本地路由与人工 stale 模拟可由生产 `selection-release-gate`（本地词/实体、Provider 边界）和 `selection-rich-lookup-cancel`（真实旧结果取消、零 Provider）替代。本次保留此 PoC：其中候选 ID/歧义路由仍为测试注入的独有断言，未把相似生产流程误判为完全等价覆盖。未确认等价覆盖的断言继续保留。
