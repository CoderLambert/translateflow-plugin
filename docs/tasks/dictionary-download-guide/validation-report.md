# 词典获取指引与实际截图交付（0.8.63）

用户要求核对FreeMdict 25795帖是否合法适合推荐，在README及设置词典区域补充来源，并裁剪所提供的实际查词截图。主Agent完成，没有子Agent或独立审核。

## 产品结果

- 设置→词典库→本地导入，新增默认折叠的「去哪里找词典 · 下载与导入指引」。中英配对，使用native details支持键盘。链接为FreeDict/WikDict官方页面，明确是StarDict，逐词典许可/CC BY-SA 4.0、先解压和同名文件配套选择，以及尚未逐包验证。
- 保留已有精选ECDICT与用户自带MDX/MDD。导入指引说明只使用获准在本阅读器使用的文件，不把公开网盘或“仅供学习”当作授权；不执行词典脚本、不请求在线TTS。外链新标签、noopener/noreferrer、no-referrer；没有自动下载、新Provider、站点权限或存储迁移。
- 用户截图裁成1400×1125浮窗，去除浏览器标签、地址和背景，保留词典名称及局部词条排版。README注明原词典内容权利、仅说明本地显示、不分发词典文件或授权，不用可见音频按钮冒充音频已验收。原始全屏截图没有进入仓库。
- README增加来源和下载导入步骤；新docs/DICTIONARY_DOWNLOADS.md区分授权/格式/技术兼容和公开展示。明确词典图的释义来自所导入词典，不与另外两张本地模型译文图混淆。

## 来源与判断边界

实际读取用户帖子，作者自述抓取官网、提取官方App/其他版本内容，并提出私下传播；未见完整公开分发授权依据。因此不加入该帖、网盘或提取码到产品的推荐/安装源。不是对整个论坛或每个文件作违法定性。帖子还依赖JS/在线TTS，不能保证在本扩展同等兼容。

来源为论坛原帖、FreeDict官方downloads与许可说明、WikDict官方download/about、WIPO Lex收录的2020年著作权法（第十/二十四条）。FreeDict逐本授权；WikDict数据CC BY-SA 4.0与代码MIT分别说明。政府初试URL404、Oxford抓取被robots/403阻止，没有用它们证明授权，也未绕过限制或下载词典。

## 实际检查

证据在忽略目录docs/task-execution/local/dictionary-download-guide/。

- 首次`npm run typecheck`发现静态链接数组的文案key被扩大为string；使用`as const`保留字面量后再次严格检查PASS，未放宽编译规则。初始失败和最终日志分别保留。
- `node scripts/i18n-locales.mjs --generate`：1595个键。
- `npm run commit:prepare`：0.8.63，暂存树`057967a12de53dc19ac83c60d6384fb3acdc4509`，构建与资源/许可审核PASS，146文件。其后仅补README来源措辞和任务归档，生产源码/构建输入未变，复用该包。
- 实际公开包、临时Chromium profile：词典页面可见、初始折叠、Enter展开、两条准确外链与target/rel/referrerpolicy、StarDict/授权提示、390px暗色无横向溢出均PASS。页面及展开外部HTTP(S)请求为0。主Agent查看窄屏截图；没有实际触发任何词典下载、词典导入或Provider。英文文案通过类型/键一致性检查，未另做英文视觉验收。
- Python检查README本地链接和图片路径存在、版本与包一致；ZIP每文件字节与真实公开产物相同，无docs/tests/scripts/lexicon源码或此次截图进入扩展。
- 本轮没有跑Node/Vitest、完整validate、完整E2E或重新认证全部词典；用户实拍不是本Agent重跑的商业词典兼容性或版权证据。

## 交付与自查

- 本地安装包dist/extension/：0.8.63。
- Downloads独立更新目录：TranslateFlow-0.8.63-词典指引更新，ZIP为translateflow-0.8.63.zip。
- SHA256：06058d7cbd66927f1419f5c3b6c87e03bf0eaed35e1dd5bca09d7ce60278eae4。
- 裁剪图另存Downloads/TranslateFlow-本地词典展示-裁剪.png；0.8.61/0.8.62原ZIP及资料保留。
- README公开同步独立PR #375已squash合入main：`311b783e2916e62e5954651c948b5ad70324652a`。文档candidate `00c11e4fbdad68d40322f74c8e7be6a1df76db2d`，sync `71971ef71ed9cc2727115aafca198dc5eadca066`；gate PASS，main tree与sync完全相同，公开README字节匹配，PNG HTTP 200且hash与本地相同。公开main仍0.8.50，准确标记0.8.63为本地候选；此次文档合入没有发布UI。

主Agent按实际diff自查：复用现有样式和导入入口，不自动调用存储/下载/AI，不改变原有词典运行、安全边界或安装来源。来源说明不能替代版权许可，截图片段不等于整部词典可公开分发；若以后用于商店营销需另核对图片使用权。未操作商店。产品分支未推送或合入，任务保持reviewing，candidateHead/mergeHead为空。既有商店说明未提交修改保留。
