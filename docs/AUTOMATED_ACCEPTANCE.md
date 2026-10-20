# 用一份本地配置执行自动回归与真实资源验收

入口为 `node scripts/run-configured-automation.mjs /absolute/path/config.json`。它先运行真实资源验收，再串行运行现有 `validate` 和完整 Chromium/MV3 回归，生成 HTML、JSON、步骤截图与脱敏日志。功能项目失败导致串行专项被依赖阻止时，会显式补跑专项；不把未执行算通过。`--live-only` 定向复验真实资源，`--regression-only` 只运行不含真实凭据的回归；报告中没有完整回归步骤就不能宣称全套通过。

配置与凭据放在 Git 忽略的 `docs/task-execution/local/`，权限 0600；密钥用 `realAi.apiKeyEnv` 指定的环境变量，或 `realAi.secretFile` 私密 JSON 中的同名字段。不要把密钥写入命令参数、提交或公开测试 fixture。执行器只支持本轮已授权的官方 DeepSeek 地址、`deepseek-flash` 和 `openai-chat`，上限 20 次；增加服务范围需明确配置合同，不做任意 URL 凭据转发。

执行前按实际 runtime/source、根 UI/locale、传递构建模块、锁文件与 Node 版本核对生产输入；输入或包指纹变化才重新构建所选标准/WXT 包，不能直接测试旧包。验收结束再检查输入是否变化，发生变化的结果不能作为新源码通过证明。退出码 0 表示本次选中步骤无 FAIL/BLOCKED，1 表示有 FAIL，2 表示仍有 BLOCKED；SKIP 和未验证范围仍须阅读报告。

核心配置为 `schemaVersion: 1`、稳定 `campaignId`、`artifact`、`outputBase`、`realAi`（enabled/baseUrl/model/protocol/apiKeyEnv/maxRequests/maxOutputTokens）、`browser`（executablePath/useIsolatedTestProfile）、`chromeLocal`（allowModelDownload/timeoutMs）、`dictionary.directory`、`livePages.urls` 和 `automatedRegression`（enabled/workers）。当前真实页面验收使用第一个 URL，Chrome 模型路径固定验证 en→zh；其它语言对需要新增对应场景，不会因数组中出现就自动宣称已覆盖。

真实 AI 通过仅监听 loopback 的预算转发器访问 `https://api.deepseek.com/chat/completions`。产品连接界面保存 loopback 地址并显式允许本地 HTTP；上游是真实 DeepSeek，不模拟结果。转发器仅设置输出 token 上限，保留模型、提示词和成功响应。它不是第三方网关验收，也不能证明浏览器直接访问官方 TLS 地址成功。所有上游尝试在发出前写入 campaign 的 `requests.json`；失败、断开、Provider 自动重试同样计数。中断后重跑同一 campaign 不清零。超限不再调用上游，不为了“测过”自动扩大限额。

执行器为同一 campaign 保留私有测试 profile 与固定 unpacked 扩展路径；更新副本仅发生在自建临时目录，保留扩展 ID、词典与已下载模型。它不连接或修改用户日常浏览器，不替换实际安装目录。真实验收不开启 trace/视频/网络录制；截图遮盖密码框和私有词典正文，报告不包含词典原文、私密路径或请求体。不要把包含 profile/凭据的整个 campaign 目录公开分享；可视报告只需要对应 run 的 `index.html`、`screenshots/` 和脱敏日志。

模型由产品里的真实点击触发，先使用 availability 探测；不支持、不可用或超时明确 BLOCKED，不注入模拟 API。用户允许下载时，只为真实验收移除 Playwright 默认的 `--disable-component-update` / `--disable-background-networking`，避免测试启动参数阻断 Chrome 组件准备；普通 mock 回归保持原参数。可用 `browser.headless: false` 运行有窗口的隔离浏览器。词典仅选择 MDX/MDD，不执行旁边的 JS；文件走原产品预检、OPFS 与资源管理流程，并等待最终“完成 · 富文本词典已安装”和资源计数，不能把中间“正在完成保存”当作导入结束。真实文件兼容性不等于覆盖所有词条、声音与图片。真实网页使用原网址，不用 fixture 替换。每个浏览器验收步骤都截图；Node、类型检查等无界面检查仅提供日志。

模拟回归进程不继承真实凭据或真实词典配置，使用现有独立临时 profile／合成资源。完整 Playwright 回归打开 trace 供失败定位；这些 trace 属于模拟回归，不能标作真实服务／私有词典证据。旧包、特定语料缺失及网络导致的 FAIL/SKIP 均保留，不放宽断言。完整 E2E 不承诺全部场景通过；HTML 中的回归步骤应结合日志里的场景数量与跳过原因判断。

`publicSources.ecdictCsv` 可指定已缓存的公开 ECDICT CSV，映射到现有 `TF_E2E_ECDICT_CSV`。现有用例核对完整字节长度和 Git blob source lock 后才回放，标记 verified-source-replay；这不证明浏览器直连上游下载成功，也不能用私有 Oxford 文件替代。HTML 截图轨迹从实际 Playwright trace 的帧图生成，保留复验执行，不把帧数当通过的用例数。
