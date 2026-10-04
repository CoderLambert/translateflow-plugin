# 252 — Glossary 与词典库 React 迁移

Parent：任务 191。硬依赖：251。本任务替换 Options 中 `glossary` / `dictionary-packs` 两个 legacy compatibility islands 的 UI owner；复用既有后台、controllers、Workers、OPFS、取消、安全 sanitizer 与来源合同，不改变词典格式或内容。

## 用户结果

- Glossary 的 global/site 范围、Origin、来源/目标术语、大小写、启停、编辑、删除与错误恢复在受控 React UI 中完整可用，变化继续触发现有缓存 identity。
- 词典库保留内置健康、精选上游/官方、已安装、Rich 首选/展开/排序、本地 MDX/MDD/StarDict/TFLex 文件选择、预检、确认、进度、取消、重试、更新、修复与卸载路径。
- loading/empty/error/success/cancelled/repair/update/permission-required 状态诚实；旧健康版本不因失败替换，取消不伪报撤回已提交结果。
- 不新增词典、语料、下载源、Provider、权限、DB/OPFS schema、远程资源或内容许可声明。

## 架构与安全边界

1. 删除 `LegacyIslands` 模板/adapter 和 controller DOM side-effect mount；React 组件通过 typed clients 调用现有 controller/background 合同。不得在组件内重写解析、索引、网络、OPFS 或取消状态机。
2. 文件/HTML/CSS/MDX/MDD 均视为不可信；继续使用现有 preflight、quarantine、sanitizer、路径/容量/解压限制。React 只渲染文本或已审核安全树，不使用 `innerHTML`。
3. `chrome.permissions.request()`、文件选择和安装提交只能由真实用户手势触发；初始 effect 只读状态，不自动下载、导入或调用 Provider。
4. Worker/listener/Blob/Port/operation 在卸载、取消、重试和 StrictMode 下有单一 owner 与对称 cleanup；旧请求不覆盖新选择。
5. React 仍只在 Options/Popup/Learning Center；Workers/Background/Content/MAIN 不引 React。固定 `options.html` 路径和导航 DOM contract 保持。

## 完成标准

- `npm run validate`、`npm run build:extension:wxt`、`npm run test:wxt:smoke` PASS；React/Vitest 覆盖 Glossary CRUD、词典列表/状态、文件 preflight/取消/cleanup 与 StrictMode。
- Chromium 覆盖 `settings-ia.spec.mjs`、`dictionary-library-v2-product.spec.mjs`、`rich-mdict-product.spec.mjs`、`mdd-resources.spec.mjs`、`selection-rich-lookup-cancel.spec.mjs`、`translateflow.spec.mjs` 的相关本地确定性场景。
- 不重复未变化的外部 62.9 MiB ECDICT 下载、真实私有语料或发布认证；真实目标 MDX/MDD 兼容性仍按 offline-dictionary/专门认证任务处理。
- 更新架构/UI/词典边界文档；明确 #253 才是完整 UI en/zh_CN 收口，商店/其它浏览器不在范围。
