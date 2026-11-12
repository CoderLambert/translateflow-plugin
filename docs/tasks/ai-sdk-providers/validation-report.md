# 本地实现与验证

分支 `feat/ai-sdk-providers`；独立目录 `../translateflow-ai-sdk`。基线 `6a7e796adee07639b673d78907c3342ec946644b`。原目录修改未动。未获 commit/推送/合并授权，因此没有 candidate/sync/merge SHA，也未运行 freeze/gate，不标记 completed。

| 检查 | 实际结果 |
| --- | --- |
| npm 安装固定依赖 | PASS，0 vulnerabilities |
| npm run check | PASS，语法、架构、i18n；末次工具调用检查日志见本地证据 |
| npm run typecheck | PASS，仓库原严格选项保留 |
| npm run test:unit -- --run | PASS，16 文件、93 测试 |
| npm test 初轮 | FAIL，2201 项中 38 项失败；缺失 Response/完成元数据的旧 fixture、SDK 7 instructions、许可证覆盖与实现差异均已处理 |
| 初轮失败项所在文件定向回归（node-final.log） | PASS，135 项；复用其余初轮 PASS，不重复全量 |
| 协议、共享能力、SSE、源码边界与 WXT 资产专项（final-targeted.log） | PASS，140 项 |
| 配置/缓存/污染结果专项（config-delivery.log） | PASS，99 项 |
| 最后完成态修复后重验（completion-final.log） | PASS，69 项，含 19 平台、15 组厂商推理映射、全端点、混合工具结果、拒答、重试与流式取消 |
| npm run build:extension:wxt | PASS，最终 build-reviewed.log；SDK 仅 Background、许可证、Manifest/资源闭包审计通过 |
| Chromium/MV3 6 场景（e2e-delivery.log） | PASS：3 种本地/云端连接、Anthropic 原生、推理保存重载与浏览器重启、划词流式取消 |
| 最后工具结果校验修复后浏览器定向重验 | PASS，2 项；e2e-reviewed.log 绑定最终包（Anthropic 与流式），其余先前未受影响场景复用，不宣称新包全量验收 |
| git diff --check | PASS |
| 真实厂商 Key 调用、私有词典、商店发布 | NOT RUN，未使用真实凭据；不属于 mock/构建结果 |

各组测试有重叠，不相加为覆盖率。完整日志、失败记录、截图及 SHA-256/input 清单位于 Git 忽略的 `docs/task-execution/local/ai-sdk-providers/` 和 `test-results/`；`evidence.json` 绑定实际工作树输入和包文件，不冒充 Git 候选。

安装包：`.output/chrome-mv3/`。与固定基线用相同 WXT 引擎分别实建对比：未压缩总量约 3.43 MB → 5.05 MB，后台闭包约 0.85 MB → 2.40 MB。精确字节见 `footprint.json`；deflatedBytes 是逐文件 zlib 估值，不是发布 ZIP。Manifest 完全一致；SDK 不进入扩展 UI/Content。无词典下载、编译或认证。

兼容决策：旧 API Key 缓存保留但新调用以 `ai-sdk-v1` 隔离，不清数据。旧 DeepSeek 显式禁用思考被“模型默认不发推理参数”替换，厂商可能默认开启思考；用户可在连接中明确关闭。SDK 自身第三方类型声明未通过仓库严格选项，JS adapter 使用明确 `.d.ts` 公开合同隔离，不放宽 tsconfig。
