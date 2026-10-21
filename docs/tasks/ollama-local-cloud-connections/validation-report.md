# Ollama、本地部署与云端连接验证

最终候选 `0cf0bc4cafe9bd933bdfbef57a1fdbb8a1cfa91e` 已推送至功能分支；解析器现接受 Ollama 返回的 `segments` 数组。Provider Node 回归 41/41、Options 20/20、类型/仓库检查、默认/WXT 构建、WXT smoke 和 MV3 E2E 4/4 均 PASS。实际安装包的本机浏览器测试通过：扩展 ID `ijbkglnpamonghcklbfmlhjlmeeohgmo` 连接 `qwen3.5:9b` 并完成中文翻译，Mock Provider 调用为 0。用户报告其已配置的 Ollama Cloud 模型测试通过；本次未调用云端账户或读取 Key。LM Studio 真实服务未测。

## 基线与交付范围

- 前一任务 [PR #366](https://github.com/CoderLambert/translateflow-plugin/pull/366) 已合入远端 main，提交 `d465e933cef10e2a6ae9320837b2925b816dc895`，版本 0.8.44。
- 本任务从上述 main 提交建立分支 `feat/ollama-local-cloud-connections`；实现提交 `68acb0a124faa92a7efdbde7b5aee3354432cfdc`，尚未推送或合并。不改动用户正在使用的旧字幕安装目录。
- 本任务候选提交为 `68acb0a124faa92a7efdbde7b5aee3354432cfdc`。用下列输入和安装包指纹绑定本地结果。
- 输入 SHA-256：`3679af26f288611dce5df1149c33859fae9b19e52cf8d99e21892a6dfca3ca82`，算法和逐文件 SHA 见本地 `docs/task-execution/local/ollama-local-cloud-connections/local-validation.json`。
- 安装包仍标记 0.8.44，是未发布开发包；`dist/extension` 与 `.output/chrome-mv3` 字节树相同：`6c20d0f5a5c09a871e33fb2b575d8dda6de92967497a2ee13d0bab1b94593d8d`，131 文件、3,078,808 字节。

## 用户现在可以配置什么

| 入口 | 默认地址 | 认证 |
| --- | --- | --- |
| Ollama (local) | `http://127.0.0.1:11434/v1` | 本地默认无 Key，允许 HTTP；需在 Ollama 服务允许扩展来源 |
| Ollama Cloud | `https://ollama.com/v1` | 默认要求 Ollama API Key，无需本地 Ollama |
| LM Studio | `http://127.0.0.1:1234/v1` | 默认无 Key，启用服务器认证时填写 Key |
| 原有 Local / Custom | 用户提供 | 保留 vLLM、llama.cpp 等兼容服务和云端的自定义地址、协议、模型 ID |

模型名自由填写，无模型白名单。保存不会替换当前默认服务。Ollama 的 `:cloud` 模型仍会经本机 Ollama 转发云端，设置文案明确这一点。

新命名预设的 OpenAI Chat 协议接受服务根地址并转为 `/v1`；Ollama 根 `/api`、`/api/chat` 同样转为兼容路径。旧 Custom / Local 及代理前缀地址保持原语义，不猜测其它云平台的版本路径。

## 改动位置和主 Agent 自查

| 位置 | 行号 | 作用及边界 |
| --- | --- | --- |
| `src/shared/provider-connections.js` | 26、60、177 | 三个预设与平台限定的地址规范化。仍校验 HTTP 显式开关、协议、URL 内凭据；无存储访问 |
| `src/options/ProviderConnectionsSection.tsx` | 76、87 | 按预设显示模型及地址说明，用 `aria-describedby` 关联模型输入 |
| `src/i18n/catalog-options.js` | 80、273 | 中英文使用指引；说明本地、云端、模型标签及 403 |
| `src/background/provider-connection-runtime.js` | 14 | Ollama 本地预设测试遇到 403 时显示当前扩展准确来源及恢复步骤，保留原始错误状态；不视为测试成功 |
| `scripts/smoke-wxt-extension.mjs` | 65 | 为 mock 场景显式选择 AI 翻译，修正旧 fixture 误走免费翻译产生的 MT_CONSENT。未放宽产品的同意、权限或断言 |
| `tests/provider-connections.test.mjs` | 15 | 预设经 Effective Config 可用、根地址规范化、云端缺 Key 拒绝、403 指引；保留旧迁移、缓存、凭据隔离回归 |
| `tests/unit/options-react.test.tsx` | 59 | 设置页切换本地/云预设后的默认地址、认证开关、自由模型 ID 和保存参数 |
| `e2e/provider-connections.spec.mjs` | 6、61 | 三个预设的 MV3 流程；独立 opt-in 的真实本地 Ollama 场景 |

主 Agent 对照实际 diff 自查，没有委派第二轮独立审核。没有新增 Provider 协议、消息、依赖、权限、数据库 schema 或缓存版本；API Key、HTTP 请求和缓存仍沿用 Background 与 Effective Config。旧连接和迁移代码保持原语义。新预设若由旧版本读取会按现有未知平台规则视作 Custom，已保存的兼容地址、凭据引用及模型不依赖新协议。

未使用 FluentRead GPL 源码。没有为了真实验证移除 Origin、改动服务允许列表、重启用户服务或读取云端账户凭据。

## 已执行的验证

环境：Node 24.22.0、npm 11.19.0、Chrome for Testing 153.0.8010.12。浏览器测试均为临时 profile / 生产包测试副本；只在副本增加 localhost 测试权限，产品 JavaScript 不被替换。

| 命令/场景 | 结果 | 能证明的内容 |
| --- | --- | --- |
| `npm ci --prefer-offline` | PASS | 锁文件依赖安装成功，未升级依赖 |
| `node --test tests/provider-connections.test.mjs tests/provider-config.test.mjs tests/provider-native-protocols.test.mjs tests/provider-structured-json.test.mjs tests/local-translation.test.mjs` | PASS，40/40 | 规范化、有效配置、协议请求、迁移/身份与诊断回归 |
| `npm run test:unit -- tests/unit/options-react.test.tsx` | PASS，20/20 | 设置页交互和受影响的既有控件 |
| `npm run typecheck` | PASS | 严格类型检查 |
| `npm run check` | PASS | 823 源码检查、1257 i18n keys |
| `npm run build:extension` | PASS | 默认安装包构建 |
| `npm run build:extension:wxt` | PASS | 显式 WXT 包及资源审计，与默认包一致 |
| `TF_SMOKE_ARTIFACT=dist/extension TF_SMOKE_REPORT=docs/task-execution/local/ollama-local-cloud-connections/wxt-smoke.json npm run test:wxt:smoke` | PASS | Popup、Options、真实后台、Worker、mock 翻译/缓存恢复；3 个译文、3 个恢复命中 |
| `TF_TEST_WORKERS=1 TF_OLLAMA_REAL_MODEL=qwen3.5:9b npm run test:e2e -- e2e/provider-connections.spec.mjs --retries=0` | **exit 1；4 PASS、1 FAIL，18.0 秒** | 三个新预设和 Anthropic 的 mock MV3 流程通过；真实 Ollama 因下述 403 失败 |
| 生产适配器 → 真实本机 Ollama `qwen3.5:9b`，SSE、无 Key | PASS，33,999 ms | `Good morning.` → `早上好。`，ID 保留；Node 使用权限 stub，不能当浏览器证明 |
| `git diff --check`、E2E 文件语法检查 | PASS | diff 与语法正确 |

新行为先补测试，确认 RED：最初缺少 Ollama 预设、服务根地址未规范化；另一个测试先复现 403 无恢复指引，再作最小实现并通过。最终源码改动后重建并重验受影响项，未重跑完整 validate。

构建保留已有体积提醒：platform code 比 advisory budget 多 689,094 字节（详见构建日志）；该提醒不使构建失败。

首次浏览器命令因新工作区缺少 `.output/chrome-mv3` 和 `.wxt/reports` 未启动有效场景；执行显式 WXT 构建后再运行。首次真实浏览器测试已失败并保留 trace；后续仅补恢复指引，最终真实测试仍是 FAIL，没有改成 mock 或削弱成功断言。

## 真实服务的边界和阻塞

本机 Ollama 版本 0.33.3，已有 `qwen3.5:9b`，开始时未加载模型；测试未安装或下载模型。通过 API 元数据确认该模型没有 `remote_host` / `remote_model`，不使用本机已登录的云端模型。

真实浏览器里点击连接“测试”返回 **HTTP 403**，未进入模型调用，真实网页译文阶段 **NOT RUN**。带扩展 `Origin` 的独立 `/api/version` 请求同样返回 403；无 Origin 的 API 和实际本地推理可用。这些证据支持服务端来源限制诊断。[Ollama 官方 FAQ](https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama) 明确要求允许浏览器扩展来源。

恢复路径：由服务管理员把**实际安装的 TranslateFlow 来源** `chrome-extension://<扩展 ID>` 加入 `OLLAMA_ORIGINS`，保留既有来源并重启 Ollama，再重跑 opt-in 用例。截图中的 ID 属于一次性测试副本，不能直接拿来配置用户的插件。未擅自修改任何现有服务设置。

真实 Ollama Cloud、其它云平台、真实 LM Studio 均 **NOT RUN**：没有为本任务提供云平台凭据；1234 端口未有 LM Studio 服务。不能用 4 项 mock MV3 PASS 证明这些真实服务均兼容。当前新包也未加载到用户已登录的 Chrome；未将之前字幕包的截图重新绑定到这个新包。

## 证据与下一步

本地原始证据位于 `docs/task-execution/local/ollama-local-cloud-connections/`：`provider-tests.log`、`options-unit.log`、`build-default.log`、`build-wxt.log`、`smoke-final.log`、`e2e-final.log`、`wxt-smoke.json`、`real-ollama-adapter.json`、`local-validation.json` 及带截图的 `report.html`。

完整输入清单与安装包指纹保存在 `local-validation.json`。截图来自最终指纹的 Chromium 包：窄屏 Ollama / LM Studio / Cloud 设置页，以及真实 Ollama 403 卡片。原失败 trace 和 error context 仍保存在 `test-results/run-1792531323365-6884fb1a-ae62-4e01-adaf-379842e7862e/`，未删除或改写。

本地实现可审阅；下一步是决定实际安装的新包目录并配置该扩展来源，完成真实浏览器到模型的验收。新功能不自动跟随已合入的 YouTube 提交推送或合并；后续提交需重新冻结实际候选并按适用约定准备版本。
