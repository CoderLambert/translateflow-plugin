# 本站悬浮入口位置验收

以下是 2026-10-16 旧基线上的单项历史证据；当前集成验收与新包 fingerprint 见 [content-runtime-closeout](../content-runtime-closeout/verification.md) 和其 `acceptance.json`。旧日志保留原结果，不改写为当前候选结果。

日期：2026-10-16。分支：`fix/rich-dictionary-ai-actions-20261016`。HEAD / origin/main：`c19b79dcbee3dd03d80c906ea857bae679e72ee8`（本地未提交候选，包含此前授权的词典 AI 与上下文失效修复）。未提交、推送、合并或发布；无 PR / syncHead / mergeHead，不标记 completed。

## 交付行为与模块

- 拖动翻译按钮即可移开网站按钮；拖动完成后记住本站相对位置，普通点击仍展开面板。
- Alt + 方向键移动，Alt + Home 或面板中的“恢复默认位置”清除本站偏好。Escape、pointercancel、失去捕获、窗口失焦及划词优先显示会取消未完成拖动。
- `src/content/quick-control-position.js` 管理指针、键盘、视口布局及监听清理；既有 view/controller 负责入口、语言、任务与保存失败反馈。位置样式独立以保持既有模块职责和行数边界。
- `src/background/quick-control-position.js` 验证真实 top-frame sender，读写独立 `quickControlPositions` 版本 1 本地偏好，串行保存并限制 256 个站点。只接受有限 0–1 坐标对或 null 重置；读接口仅返回本站偏好。现有配置、缓存、权限和 Provider 不变。
- 同步 classic Reading 投影入口并按既有脚本重生成 `src/content/reading-record.js`；生产 WXT 仍使用可读 owner 源码。

## 实际验证

以下日志、截图位于 Git 忽略目录 `docs/task-execution/local/quick-control-position/`。

| 检查 | 命令与结果 |
| --- | --- |
| Node | `node --test tests/quick-control-position-*.test.mjs tests/constants.test.mjs tests/reading-content-classic.test.mjs`：19 PASS，`node.log` |
| 静态 / i18n | `npm run check`：PASS，`check.log` |
| 严格类型 | `npm run typecheck`：PASS，`typecheck.log` |
| 默认安装包 | `npm run build:extension`：PASS，`build.log`；输出 `dist/extension/` |
| Chromium 定向 | 实际消费 `TF_E2E_ARTIFACT=dist/extension` 的测试副本，最终 7 个不同场景 PASS，详见下方日志分配 |
| 差异自查 | `git diff --check`：PASS；主 Agent 自查调用链、写入身份、旧读取覆盖、取消、销毁和打包范围 |

浏览器命令均为 `TF_E2E_ARTIFACT=dist/extension npm run test:e2e -- ...`，未使用真实 Key 或私人网站内容。生产包 tree SHA-256：`0bac350ba1c8bd920892880a57f7add27fb17a66bd0c3a551143b3ed02e9f6ce`，128 文件、2,893,052 字节，词典资源 0 字节。测试只在临时副本增加 localhost 权限；既有 Quick Control 场景还使用合成词典 fixture。

- `e2e.log` / `e2e-initial-fail.log`：`e2e/quick-control-position.spec.mjs e2e/translateflow.spec.mjs e2e/ui-redesign.spec.mjs e2e/ui-locale.spec.mjs --grep 'drag frees|keyboard moves|Escape and pointer|Quick Control is|reduced-motion|mounted Quick Control'`。其中原 Quick Control 任务/重试/取消/划词优先流程及减少动画场景 PASS，后续未改变生产输入，复用该结果。
- `e2e-followup.log`：`e2e/quick-control-position.spec.mjs e2e/ui-locale.spec.mjs --grep 'drag frees|keyboard moves|Escape and pointer|trusted touch|mounted Quick Control'`。真实 CDP touch 拖动、划词隐藏后 resize 恢复、取消场景、语言重建均 PASS。
- `e2e-final-assertions.log`：`e2e/quick-control-position.spec.mjs --grep 'drag frees|keyboard moves'`。最终鼠标拖动、网站按钮可点击、刷新恢复、Provider 0 请求、键盘移动、390×480 暗色面板边界与按钮不重叠、两种恢复默认入口共 2 PASS。

早期失败全部保留：`node-initial-fail.log` 中异步测试未等待读取开始，改为显式 barrier；legacy 投影陈旧，补充依赖并重生成后 PASS。首次语言场景假设默认英语，与当前产品默认 zh_CN 冲突，改为显式设置英语测试起点后 PASS。新增面板不重叠断言首次误用了测试局部变量，修正变量后对应两项重验 PASS。未放宽产品断言或增加固定等待。

## 界面证据与限制

- `overlap-before.png`：模拟网站悬浮按钮被初始位置遮挡。
- `moved-website-button-usable.png`：翻译按钮已移到左侧，网站按钮点击显示“已打开”。
- `restored-position-and-panel.png`：刷新恢复位置后正常展开面板。
- `narrow-dark-panel.png`：窄屏暗色面板与按钮保持在视口内，内容可滚动。

未在用户真实 NewsHub 页面手工验证，合成网页回归不能代替该网站全部行为。未运行全量 validate / 全量 E2E；显式 `.output/chrome-mv3/` 本轮未更新，交付与验收均绑定默认 `dist/extension/`。无需重新下载或编译词典。版本仍为 0.8.11，本轮没有触发提交版本钩子。

生效方式：Chrome 扩展管理页对 TranslateFlow 点击重新加载，再刷新目标网页。按住“译”拖到空位并松开即可保存；需要恢复时打开面板选择“恢复默认位置”。其他已打开标签页在下次加载时读取本站位置。
