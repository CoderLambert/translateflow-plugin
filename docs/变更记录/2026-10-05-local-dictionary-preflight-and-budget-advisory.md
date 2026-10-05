# 本地词典真实样本预检与包体门禁记录

- 日期：2026-10-05
- 分支：`fix/wiktionary-mdict-preflight-20261005`
- 基线：`origin/main` `39bdb53de2cff9f6f470ee6fa39809b635858810`
- 定向 E2E `testedHead`：`7da242a6312dc13028aeba9661cb23bcdc0b8d4d`
- 范围：修正 Options 本地词典隐藏控件、MDX `StripKey` 空描述符和 MDD 实际排序识别；保留 #245 包体阈值的 advisory 行为。真实 MDX+MDD 文件只在本机用于解析与浏览器验收。未合并、未发布。

## 变更

| 提交 | 内容 |
| --- | --- |
| `90b543baaa44caf35c5f19d4f210c51c5cc183a7` | `options.css` 明确遵守 `[hidden]`，避免预检/确认控件被布局样式重新显示；同步等待元素隐藏的 E2E 断言。 |
| `86b151faa7d356b366ddce186a3facb6123c494d` | 增加 MDD 大小写折叠顺序读取，同时按原拼写区分相同折叠值。 |
| `b4676ba582e489570f5a706d6831c26f25975417` | 将 #245 平台代码字节预算超额由失败改为 `WARN`；审计数值与其它断言仍保留。 |
| `7162a31567c8ff85812dcbecd6a7a0e4fc27bb39` | 仅允许 `StripKey` 规范化产生的空 MDX 描述符，继续拒绝空实际词头；检测 MDD 实际排序，验证完整描述符端点对。 |
| `a54e70509e63138a74f5f4a303b6b911c5ef4298` | 增加缺省 `KeyCaseSensitive` 头部的 MDD 原始排序兼容回归。 |
| `aae34dac1d205021fa8631225e96a69d5b53db7a` | 修正已发现的 MDX 规范化端点次序边界；增加原始末键规范化为空值的回归。 |
| `8d98af79b645ba0ba23bed2a4d1710b57c333eae` | 将 Selection 产品用例使用的监听器注入时间调整到页面内容建立之后。 |
| `bea7b3080ca68ae0ccb9f9e0a7ec26c28d39b4aa` | 使用真实词典中符合当前 Selection 资格规则的词头，缩窄网络与产物证据字段名称。 |
| `d8de9f3726f8956ac866fb85fb3f8d5a5260a0eb` | 在 Options 中启用真实词典的 Selection 显示设置，并校验呈现文本与真实记录相符。 |
| `7da242a6312dc13028aeba9661cb23bcdc0b8d4d` | 断言真实详情卡展开，将可见富文本滚入视口并保存产品页截图。 |

## 真实 MDX/MDD 发现

旧预检把 key-block 描述符当作实际词头校验。该输入使用 `StripKey=Yes`：真实首词头 `%` 非空，但其规范化描述符为空。独立成熟 reader 也读到实际首词头 `%`，记录偏移为 0；下一词头从偏移 298 开始。这解释了旧的 `MDICT_UNSAFE_CONTENT` 结果，**并非真实词头为空或当前安全拒绝有效**。

修复后，实际存储词头仍经过非空及内容安全校验；只有 `StripKey` 下的描述符端点可为空，且查找边界仍由实际词头派生。真实本地 MDX 成功建立 197,519 项、104 个 key block 的索引。

MDD 索引在读取已解码键时识别实际原始或大小写折叠顺序，跨 block 比较也参与判断。新 schema 保存识别结果；schema 1 继续按原始大小写排序读取。描述符端点仅在完整原始端点对或完整 `lower(actual)` 端点对匹配时接受；混合/错误端点和倒退 offset 仍拒绝。回归覆盖大小写折叠相同但拼写不同的资源、旧索引、缺失大小写头部、跨 block 查询及最后一项完整资源字节。

真实 MDD 的本地结构检查仍显示 17 个资源键、1 个 key block、8 个 record block。既有策略接受 1 个 CSS 与 2 个 PNG，拒绝 4 个 TTF、4 个 WOFF、4 个 WOFF2、1 个 EOT 与 1 个 SVG；没有扩大 allowlist。此策略统计不证明产品已实际呈现那些资源。

## 验证与产物

环境：Linux x86_64；验证实际使用 Node `v24.21.0`、npm `11.19.0`、Chromium `153.0.8010.12`，满足仓库声明范围。Node/npm 来自已有本地缓存，通过命令级 PATH 使用；没有安装依赖或添加凭据。本运行环境不提供可观测模型名或推理档位，记为 `UNKNOWN`。

| 检查 | 结果 |
| --- | --- |
| `node --test tests/rich-mdict-format.test.mjs tests/mdd-format.test.mjs` | PASS，18/18；含空规范化实际末键回归。 |
| `npm run build:extension:wxt` | PASS_WITH_WARNING；Manifest/资源/审计断言通过。平台代码 1,581,934 字节，#245 旧阈值 1,576,595 字节，超额 5,339 字节并发出 WARN。 |
| WXT 生产产物（E2E 测试适配前） | Chrome MV3，112 文件、2,198,653 字节、无词典资源；tree SHA-256 `3a7f327c756a4b1de735ce82bf10ef03d61e631bb0fd2d594050ad2ccd8300e5`。真实输入未进入构建产物。E2E 运行器随后将词典 fixture 文件和 `manifest.json` 权限补丁写入临时测试副本；上面的 SHA 只指原始 WXT 目录，不是浏览器所载临时副本。 |
| 定向本机真实文件 E2E | `npm run test:e2e -- e2e/local-dictionary-import-v2-product.spec.mjs --grep 'empty local dictionary preflight|locally supplied real MDX/MDD' --workers=1 --retries=0`，PASS，2/2。`testedHead` 为 `7da242a6312dc13028aeba9661cb23bcdc0b8d4d`。本地导入 197,519 项、1 个 MDD；直接离线查 `中国` 得 `中國`，实际 Selection 产品卡用当前可选词 `IP`，富文本包含真实记录文本（263 字符）；浏览器重启后 `中国` 查询仍与原记录相同，然后删除测试安装。Provider mock 调用 0。Options 页重启前监听到的非本地 HTTP 请求 0；监听仅覆盖 Options 页，不代表全浏览器网络捕获。运行器日志 `sourceHead` 为空，由 Git 本地核验 testedHead。 |
| 导入完成截图 | `test-results/e2e/local-dictionary-import-v2-5db7d--survives-a-browser-restart/local-real-mdict-import-complete.png`；SHA-256 `139fa14c280a9e42f2072be68714a8e71bad46e7c5f7a80186933a5f5e2184cf`；Library `libfile_9f7f6dde42a48191a181c056341a0854`。截图显示预检可用、197,519 项及真实 MDD 关联。 |
| Selection 产品页截图 | `test-results/e2e/local-dictionary-import-v2-5db7d--survives-a-browser-restart/local-real-cedict-rich-text-selection.png`；SHA-256 `02b0be68cb4860dc41c85e84b18b8e10c0dcb30291cefdb7eea39c2037c6f520`；Library `libfile_609dd15766fc81918c6f551058a5ccaa`。它来自扩展 Selection 浮层，显示当前展开的真实 CC-CEDICT HTML 词条。测试源页由 E2E 建立选中文本；词典数据、查询、卡片呈现均使用本地实导入和产品运行时。 |

本轮没有重新运行完整 `npm run validate` 或 `npm run check`。既有 Reading/Selection/Provider 通过记录不移作本轮证据。本次定向 E2E 验证了导入、直接离线查询、Latin 词选区、真实 rich-text 卡呈现、重启持久性和删除；没有覆盖实际 MDD CSS、图片或音频资源在卡片中的呈现。

## 未运行与边界

- 未做整个 MDX 原文映射的独立实现全量 byte-for-byte 对照、60 个固定查询、10 个复杂词条的内容价值验证；不能据此完成 `offline-dictionary` 整卡认证。
- 该真实样本只验证本地 CC-CEDICT 格式导入与离线查询；Wiktionary 内容覆盖/质量和 Oxford 词典内容均未验证。
- 未验证实际 MDD CSS/图片/音频展示；字体和 SVG 继续受当前策略阻止，另有 CSS 引用没有资源键。没有放宽 CSP、权限或资源 allowlist。
- 额外试探选中纯汉字 `中国` 时没有出现 Selection chip；该结果没有纳入通过用例。资格规则见 `src/content/selection/selection.js:32-41`，要求至少两个 Latin 字符且 Latin 字符占比不低于 35%，所以纯汉字输入当前被过滤。此处只记录现状，未改 Selection 产品规则。
- 真实/付费 Provider、商业或私人词典、Firefox/Safari、Edge、真实安装升级、商店打包/上传均未运行。
- 本轮没有修改 GitHub Issue、任务状态或标签；未合并、未发布，也没有放宽 CSP 或扩展权限。
- 本分支的审查 PR 和产物链接以交付回报为准。准确产物 hash 指 E2E 适配前 `.output/chrome-mv3`；测试运行器修改了临时副本，不能将此 hash 说成浏览器加载目录的 hash。
