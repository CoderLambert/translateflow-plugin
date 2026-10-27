# 0.8.48 集成验收

候选 `c8b5b59b91cfaa51f2ab261df7670f3fa8d5f1c2`；Node 24.21.0、npm 11.19.0、Chromium 153.0.8010.12。

| 实际执行 | 结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | PASS，按锁文件安装 |
| `npm run check` | PASS，含语法/架构与 i18n |
| `npm test` | PASS，2066/2066 |
| `npm run typecheck` | PASS |
| `npm run test:unit` | PASS，82/82 |
| `npm run build:extension` | PASS，公开版 |
| `npm run build:extension:dev` | PASS，ChatGPT 开发版 |
| `npm run build:extension:wxt` | PASS，显式 WXT 包与审计报告 |
| 公开包 ChatGPT / provider-connections E2E | PASS，5 项通过；开发版专属 1 项不适用 |
| 开发包 ChatGPT E2E | PASS，1 项通过；公开版专属 1 项不适用 |
| 公开包 `test:wxt:smoke` | PASS，页面翻译/缓存恢复/本地词典/扩展页/Worker/MAIN |

完整 validate 的阶段逐项执行并分别绑定日志，不声称额外运行了一次组合命令。所有命令参数、单调计时与日志 SHA256 在 acceptance.json。首轮候选的 Node 1 项、类型、公开版 E2E、smoke 失败均已修复并重验，原失败证据保留在本地，不改写为 PASS。

公开包与显式 WXT 包 fingerprint 均为 `32a9a5cb8a6065bb46dfb65f37cb57359598ee5a55638d2f6cf0f8b638172a8b`；开发包为 `ebca883fdb8071abbfd074b18a274b2d0d34080c64e4fb313799366af6b9052c`。开发包只增加 `version_name=0.8.48-dev`，权限字段相同。安装包不含测试/源码库/文档或私有词典。

截图：`test-results/run-1793116641905-2ce13baa-85fd-499c-abfa-459b34c75e0b/artifacts/chatgpt-plan-nativehost-Ch-48677-e-user-level-host-is-absent-functional/chatgpt-host-missing-narrow.png`；另有公开包 Ollama/LM Studio 窄屏截图。截图和原始日志仅本地保留。

未验证：用户真实网页与 Provider、真实账号 OAuth/套餐、完整 E2E、浏览器同 ID 升级重启及商店发布。旧注册兼容由真实旧脚本列表/jsdom 回归覆盖，不等同于浏览器同 ID 升级。用户测试包交付后，可靠性审核以这一版为基线继续。
