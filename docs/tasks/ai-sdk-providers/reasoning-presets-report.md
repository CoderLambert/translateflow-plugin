# 默认快速翻译与可选增强推理

基线 origin/main 与 HEAD：6a7e796adee07639b673d78907c3342ec946644b。branch：feat/ai-sdk-providers；未提交工作树，candidateHead=null。保持前序 SDK 迁移与页面兼容修复。

用户授权采用前轮对比中的折中方案：默认快速；精确适配的模型关闭或降低思考；未知模型用服务商默认。增强模式使用经过验证的常规预设，用户无需核对文档或填写预算。

## 实现与兼容

- src/shared/provider-reasoning.js：default/空值现在是快速策略，enhanced 代表增强预设；model-default 显式恢复原生默认。旧 effort/budget/enabled/disabled/adaptive 保留。精确模型映射详见 docs/PROVIDERS.md；不按前缀推断、不改变连接模型或地址。Gemini 动态预算 -1 只由内部预设产生，手动输入仍校验非负。Claude 过小输出上限明确报错，不偷偷降级。
- src/options/ProviderConnectionsSection.tsx 与双语文案：默认折叠快速说明，已适配模型可选增强；未知模型说明沿用自身设置；旧手动参数仍可编辑。390px 窄屏截图检查通过。
- src/shared/translation-cache-identity.js：共享 resolveReasoning 得到 effectiveReasoning，增加 reasoningPolicyVersion=translation-presets-v1；不升级DB、不清空历史。显式/省略默认 provider 使用同样的解析结果，保持旧配置等价关系。
- e2e mock 支持 SDK 合法的 Responses input 中 developer/system 指令，保持用户消息独立；仅记录非敏感 model/effort 用于断言。测试使用合成凭据。

参数来源：[OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning)、[DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/)、[Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking)、[Claude extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) 及锁定 SDK provider 的源码、schema。Kimi K2.5/K2.6 开关依据 @ai-sdk/moonshotai/src/moonshotai-chat-options.ts。未复制 FluentRead 代码。

## 验证与实际限制

日志统一在 docs/task-execution/local/ai-sdk-providers/ 下。

- RED：`node --test tests/reasoning-presets.test.mjs`，原实现不支持预设，reasoning-presets-red.log 保留。
- PASS：`node --test tests/reasoning-presets.test.mjs tests/provider-reasoning.test.mjs tests/ai-sdk-providers.test.mjs`，70项，reasoning-presets-contracts.log。包括19平台协议合同及未知模型不猜参数，9种平台/协议/模型的快速和增强实际SDK请求。
- 发现并修复：扩大相关配置/缓存范围至158项，156通过/2失败，reasoning-presets-affected.log。两失败均位于cache-context，根因是默认provider被身份计算补齐后未传入preset resolver；修复为相同默认值进入resolver。定向重验 `node --test tests/cache-context.test.mjs`，10项PASS，reasoning-presets-cache-recheck.log。其余相关结果复用。
- PASS：补流式场景后 `node --test tests/reasoning-presets.test.mjs`，23项，reasoning-presets-final.log；流式使用同一快速参数，完成结果与进度一致，仅一次HTTP请求。
- PASS：`npm run typecheck`，reasoning-presets-types.log。
- PASS：`npm run test:unit -- tests/unit/options-react.test.tsx`，23项，reasoning-presets-unit.log。
- PASS：`npm run check`，最终记录reasoning-presets-check-final.log。
- PASS：`npm run build:extension:wxt`，reasoning-presets-build.log，147文件/5,078,875字节；SDK仅后台，manifest与前包字节一致。
- PASS：`TF_TEST_WORKERS=1 npm run test:e2e -- e2e/provider-connections.spec.mjs --grep 'reasoning settings|fast and enhanced' --retries=0`，旧自定义/重启场景通过，新预设场景因mock只读取body.instructions漏掉SDK合法developer输入而失败，保留reasoning-presets-e2e.log。修正mock后只重验失败项 `--grep 'fast and enhanced'`，PASS，reasoning-presets-e2e-recheck.log。覆盖保存/重载、后台真实SDK请求中的none与medium、恢复model-default不传额外参数、无确认checkbox、无强度预算填写、390px无横向溢出。
- PASS：git diff --check；主 Agent 自查，不声称独立审核。
- NOT RUN：真实付费厂商调用、同模型速度/费用/译文质量对照。本轮不重复页面提取全量回归。

两浏览器场景使用同一产物：treeSha256=47c7d1ca6494113deea12cb4ce81dace3a559076a2cc502c2b61c2fc2fbb7911。

截图：test-results/run-1794475569793-2df49d82-9a83-4b26-b795-8595845873d9/artifacts/provider-connections-fast--52635-hout-parameter-confirmation-functional/{fast-preset,enhanced-preset}.png，已查看。

## 交付

已安全替换 ../translateflow-page-cancellation/dist/extension。替换前与上一包逐文件清单比对，检查路径与symlink边界，staging核验，再备份旧目录并rename，最后校验新目标与备份。收据reasoning-presets-installed-copy.json。未写来源worktree源码、未访问真实Key、未提交/推送/合并。用户需在Chrome重新加载扩展并刷新设置页。
