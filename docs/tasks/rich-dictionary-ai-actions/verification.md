# 富文本词典 AI 入口修复的本地验证

以下记录来自 2026-10-16 的旧基线与旧候选；当前集成验收见 [content-runtime-closeout](../content-runtime-closeout/verification.md) 和其 `acceptance.json`。这些历史结果保持原始状态，不代表当前候选。

日期：2026-10-16。基线与分支见 [task.md](task.md)。所有改动尚未提交，HEAD 仍为基线；没有 candidate/sync/merge commit 或 PR。以下是主 Agent 自查和本地验证，不是独立审核或发布认证。

后续用户要求再次复查，当前代码、安装包及验证结果以 [audit.md](audit.md) 为准；以下保留前两轮修复的历史证据。未随包提供词典已进一步改为正常空来源，不再当作查询错误。

## 当前有效验证：只有导入 MDX 的生产安装

用户再次反馈大窗口内没有标签后，发现首次浏览器测试的 `lexiconPacks: "fixture"` 掩盖了生产默认无内置词典的条件。`resolveSelectionRequest` 在结构化查询返回 error 时保留 `explanationAllowed: false`，随后优先富文本命中也无法显示 AI 标签。

先将新专项改为 `lexiconPacks: "missing"`，只导入合成 MDX，查询 `noted`，在原构建上复现标签隐藏（FAIL，`missing-before.log` 和 `missing-before/trace.zip`）。修正后台的单词可用性判断后，保持真实错误诊断，不把错误伪装成无命中，也不放开 unsupported/未知短语的限制。

- `node --test tests/selection-v2.test.mjs tests/selection-dictionary-first.test.mjs tests/selection-controller-cancel.test.mjs tests/selection-rich-outcome.test.mjs tests/selection-explain-runtime.test.mjs tests/selection-assistant-stream.test.mjs tests/selection-ui-contract.test.mjs`：88 PASS，包括结构化 error/no-hit/unsupported、未知短语及旧请求隔离。
- `npm run check`、`npm run typecheck`、`npm run build:extension`：PASS。最终构建直接更新 Chrome 实际加载的 `dist/extension/`。
- `TF_E2E_ARTIFACT=dist/extension npm run test:e2e -- e2e/selection-rich-ai.spec.mjs e2e/selection-lexicon-error.spec.mjs e2e/rich-mdict-product.spec.mjs`：5 PASS。覆盖无内置词典+合成 MDX+`noted` 的三个 AI 操作、大窗口、零自动 Provider 请求、正文保留、旧请求隔离，以及可选词典缺失时原有翻译 fallback、词典安装/查询/删除。
- 当前安装包 tree SHA-256：`5994f03234f5bf292a5d22700a54992ae95700472f175b27c15b26f96e0004bd`，128 文件、2,883,941 字节，无内置词典。`.output/chrome-mv3/` 是首次实现的历史构建，不能作为这次补充修复的当前包。
- 当前证据：`node-tests-v2.log`、`check-v2.log`、`typecheck-v2.log`、`build-installed-v2.log`、`e2e-installed-v2.log`、`source-sha256-v2.txt`；`production-default-pass/` 保存最终界面截图。已查看大窗口截图，确认 `noted`、词典正文和三个 AI 标签同时可见。

以上验证仍仅使用合成词典和 mock Provider，没有检查用户私有牛津词典内容，也没有声称用户当前网页已经加载新脚本。版本维持 `0.8.11`，因为本任务未提交，不触发 pre-commit 版本递增。

## 首次实现的历史验证（未覆盖无内置词典组合）

- `node --test tests/selection-dictionary-first.test.mjs tests/selection-controller-cancel.test.mjs tests/selection-rich-outcome.test.mjs tests/selection-explain-runtime.test.mjs tests/selection-assistant-stream.test.mjs tests/selection-ui-contract.test.mjs`：72 PASS。新增覆盖允许/禁止 AI、命中保留初始视图、未命中返回 fallback、取消不完成，以及旧回调/完成消息/流式 delta 不写回。
- `npm run check`：PASS，含源码/架构及 i18n 检查。
- `npm run typecheck`：PASS。
- `npx playwright install chromium`：完成；环境提示使用 Ubuntu 24.04 fallback，后续真实 Chromium 测试可运行。
- `npm run build:extension:wxt`：PASS，输出 `.output/chrome-mv3/`，128 文件、2,883,862 字节、无内置词典。构建报告包含既有 #245 advisory budget 告警；未扩大打包范围来消除它。
- 用户反馈实际仍无标签后，核对本机 Chrome 的扩展加载路径，确认加载的是仍未更新的 `dist/extension/`。随后执行 `npm run build:extension`：PASS，已更新此实际安装目录。使用 `inventoryArtifact` 对比完整文件树，与上述已验收 `.output/chrome-mv3/` 的 SHA-256 完全一致，复用相同字节的定向测试结果。构建日志为 `build-installed.log`。
- `npm run test:e2e -- e2e/selection-rich-ai.spec.mjs e2e/selection-assistant-ui.spec.mjs --grep 'rich dictionary hits|Content partial/Stop'`：最终 2 PASS。新专项覆盖导入合成 MDX、三个标签可见、点击前零 Provider 请求、各动作对应提问和回答、重访不重复请求、返回词典保留原节点，以及关闭/换词时在途请求隔离。既有停止/重试/完成保存流程单独复跑通过。
- `git diff --check`：PASS。

首次浏览器执行包 tree SHA-256：`cc3045f0940f3d70c7025cbc7d381e33cec299c5f5fa8ea9b3f2011958112bdb`。历史验证针对当时未提交工作区构建，不能当作基线 HEAD 本身或补充修复的验收。

## 失败与复跑记录

- 首轮新专项因测试写错两条既有提问文案而 FAIL；核对 `assistant-grounding.js` 后仅修正测试期望，未改业务文案。
- 初版多行回调使 controller 超出现有行数上限，`check` FAIL；改为沿用已有调用行传参后 PASS，未修改门槛。
- 扩大执行 `npm run test:e2e -- e2e/selection-rich-ai.spec.mjs e2e/rich-mdict-product.spec.mjs e2e/selection-assistant-ui.spec.mjs`：8 PASS、1 FAIL。既有 `Content partial/Stop...` 等待“停止 AI 回答”按钮超时；随后该项单独复跑 PASS。未更改该测试、放宽断言或增加 sleep；失败原因未被确定，不宣称已消除时序风险。

## 界面证据与自查

原始日志及截图位于 Git 忽略目录 `docs/task-execution/local/rich-dictionary-ai-actions/`：`node-tests.log`、`typecheck.log`、`build.log`、`e2e-final.log`、`stop-timing-failure/`，以及 `final-browser-pass/` 内的命中、三项回答、返回词典、换词截图。已人工查看命中标签与用法回答截图，确认标签和正文实际显示。

当前生产 diff 包括两处回调传递和后台对单词查询 error 状态的 AI 可用性修正：不产生自动 Provider 调用，不替换命中后的词典 DOM，不新增编排、消息结构、权限、存储或网络路径。旧请求隔离继续由既有 snapshot/version/Port 生命周期负责。

全量 `npm run validate`、全量 E2E、真实 Provider/私有词典兼容性及商店发布：NOT RUN，不在本次验收范围。先前正文空白和保存失效提示：未验证，也未宣称修复。

## 本地加载

实际安装目录 `dist/extension/` 现已构建并核对，与已验收产物完全一致。打开 `chrome://extensions`，对 TranslateFlow 点击“重新加载”，随后刷新待查词网页，使旧 Content Script 更新；不必更换加载目录。导入/启用词典，划词命中后应看到三个 AI 标签；配置 AI 后显式点击才发送请求。仅更新磁盘文件不会自动替换已经注入网页的旧脚本。
