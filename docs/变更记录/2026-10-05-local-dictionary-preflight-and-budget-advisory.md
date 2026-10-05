# 本地词典真实样本预检与包体门禁记录

- 日期：2026-10-05
- 分支：`fix/wiktionary-mdict-preflight-20261005`
- 基线：`origin/main` `39bdb53de2cff9f6f470ee6fa39809b635858810`
- 已测产品候选：`b4676ba582e489570f5a706d6831c26f25975417`
- 范围：修正 Options 预检控件的隐藏样式、支持 MDD 不区分大小写的索引顺序，并按用户指示将 #245 平台代码字节阈值改为非阻断警告；对真实公开 MDX+MDD 样本做本地解析和浏览器预检。没有合并或发布。

## 变更

| 提交 | 内容 |
| --- | --- |
| `90b543baaa44caf35c5f19d4f210c51c5cc183a7` | 在 `options.css` 明确遵守 `[hidden]`，避免本地词典预检/确认控件被布局样式重新显示；同步 Options 可见性断言。 |
| `86b151faa7d356b366ddce186a3facb6123c494d` | MDD `KeyCaseSensitive=No` 使用折叠大小写排序并以原始拼写稳定打破相同折叠键的平局；保留物理条目顺序、资源身份和旧索引 schema 读取兼容。 |
| `b4676ba582e489570f5a706d6831c26f25975417` | #245 预算超额由断言失败改成 WARN；报告提供原阈值、实际平台代码字节数、超额数和警告状态。其它审计断言未放宽。 |

## 验证与结果

| 检查 | 结果 |
| --- | --- |
| `npm run check` | PASS；619 项 JS/TS/TSX 检查，738 个 locale 检查。 |
| `npm run build:extension:wxt` | 构建成功，审计状态 `PASS_WITH_WARNING`。除代码体积警告外的现有审计断言通过。 |
| WXT 候选产物 | Chrome MV3，112 个文件、2,196,251 字节；tree SHA-256 `8dfa42655bc29c8dc5ebf2a6bbb5b8ee19d626e9eedb2e54fc2cf2ff42465b5a`。真实词典未放入产物。 |
| #245 代码体积 | 旧阈值 1,576,595 字节；实测平台代码 1,579,532 字节，超额 2,937 字节。构建报告已保留此数值并告警。没有为了越过阈值继续压缩代码或更改阈值数值。 |
| MDD 本地结构 smoke | 真实公开配对文件被识别为折叠大小写顺序；17 个索引键、1 个键块、8 个记录块完成结构/JSON 索引核验。资源策略接收 1 个 CSS 与 2 个 PNG；拒绝 4 个 TTF、4 个 WOFF、4 个 WOFF2、1 个 EOT 和 1 个 SVG。CSS 的 16 个本地 URL 引用中，15 个能映射到 MDD 键，1 个 PNG 引用无对应键。未扩大资源 allowlist。 |
| Chromium Options 真实文件预检 | 使用与上列 tree SHA 一致的原始构建产物和本地 MDX+MDD 文件对运行。浏览器预检将 MDX 报为无效，提示含当前策略禁止的内容，安装按钮保持禁用。 |

## 阻塞与未运行

- **阻塞：**该 MDX 的首个实际词条键为空。`src/background/packs/importers/mdict-metadata.js:157-167` 中 `validateMdictHeadword` 会拒绝空词头并返回 `MDICT_UNSAFE_CONTENT`。这是当前安全合同的有效拒绝路径；本次没有绕过校验、修改安全边界或添加产品例外。
- 因预检拒绝，真实词典的安装、Selection 查询、持久化/重启恢复均 **NOT_RUN**。这不构成导入或使用成功证据。
- MDD 中被拒绝的字体和 SVG 不会被页面执行；其中字体又被随附 CSS 引用，且另有一个资源 URL 未匹配。此处记录当前 allowlist 对样本外观完整性的限制，没有扩大内容类型或资源信任策略。
- 本轮没有调用真实/付费 Provider，没有新建凭据；未运行商店打包/上传、#254 Chrome/Edge 可追溯打包、Firefox/Safari 或真实扩展安装升级场景。
- 既有其他 Reading/Selection/Provider 测试没有作为本轮重新运行证据，也没有移记为本轮 PASS。该记录不改变任务状态或 Issue 标签。

## 审查边界

未修改 CSP、扩展权限、远程资源规则、词典资源 allowlist、真实词典内容或用户数据。未推送、未创建 PR、未合并到 main；候选待主助手审阅。文档提交在产品候选之后，只增加审计记录，不改变上述已测产物。
