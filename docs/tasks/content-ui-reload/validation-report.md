# 扩展更新后浮窗异常修复（0.8.64）

基线96b21f589a2210483a8a19e57e4a7279f353368a，feat/unified-reading-polish。本报告为主Agent自查，不是独立审核；不访问或记录用户截图中的私人会话地址。

## 复现与原因

`node --test tests/content-ui-reload.test.mjs`对真实primitives/popover源码建立JSDOM回归：修复前1 PASS、3 FAIL，准确复现Extension context invalidated，以及undefined/null读取removeEventListener。失效环境的runtime.getURL在创建装饰性品牌图标时抛错，导致浮窗只完成部分初始化；后续hide假定panel必然存在，又抛清理异常。

图标获取现在仅在浏览器URL接口边界捕获失效错误，返回null，沿既有文字/刷新提示回退；健康上下文仍使用随包图标。hide在部分挂载时安全移除可用panel的监听器，重复关闭正常。没有屏蔽console、吞所有运行时错误或改Chrome权限。

用户须在更新/重新加载后刷新之前打开的页面一次；新版无法在原页面原地改写已运行的旧版脚本。无需卸载、清库或删除词典/学习数据。旧扩展错误日志是历史记录，可清除后观察，不将历史日志当作修复后新错误。

## 实际验证

日志与版本/包记录在忽略目录docs/task-execution/local/content-ui-reload/。

- 修复前before.log：新回归4项中3个与截图相同的错误，健康场景通过。
- `node --test tests/content-ui-reload.test.mjs tests/ui-foundation.test.mjs tests/selection-controller-cancel.test.mjs tests/auto-context-invalidated.test.mjs tests/selection-reading-window.test.mjs`：47/47 PASS。覆盖失效图标回退、部分挂载null/undefined清理、健康重开、选择取消和已有刷新提示/自动任务停止。
- `node --test tests/versioned-commit.test.mjs tests/release-gate.test.mjs`：11/11 PASS。支持明确标记候选标题，同时要求匹配候选行和真实main源码行；未标记错配、缺行、错误版本仍失败，版本准备可更新候选标题，暂存区与并发行为不变。
- `npm run commit:prepare`：0.8.64，暂存构建tree25e300eb7092645334359390916147e5bf9c3e68，146文件；生产资源/许可审核通过。后续仅调整浏览器测试的图标观测点和归档，生产源码/构建输入未变，不重复构建。
- `TF_E2E_ARTIFACT=dist/extension npm run test:e2e -- e2e/content-ui-reload.spec.mjs e2e/auto-context-invalidated.spec.mjs`：已有真实重载自动任务场景PASS；新场景初次FAIL，因为查询方式控件正常把chip改成文字，测试把chip内是否保留img误当作品牌原语结果。修正为实际品牌原语返回值，未放宽失效/关闭/恢复要求。
- 仅重跑新场景`TF_E2E_ARTIFACT=dist/extension npm run test:e2e -- e2e/content-ui-reload.spec.mjs`：PASS。真实Chrome重载保留旧isolated world；实际getURL抛失效错误得到验证；旧浮窗可显示文字、重复关闭，无未处理的原错误；刷新后图标原语恢复，mock Provider请求0。已有自动任务PASS输入未变，复用。
- 两个真实重载场景共2项最终有效PASS。实际包fingerprint：838e80c7837d6284306464d937771c462bc32f1d60731a98a396bacca0065445，146文件、3426041字节。测试只修改临时副本的Manifest，本地真实安装目录不变。
- 另以全新临时profile加载实际包，关于页可见「TranslateFlow · 当前版本 0.8.64」，截图留存；Manifest/package/lock、README、实际包Manifest和运行时getManifest逐一一致。
- ZIP逐文件与实际包一致，无docs/tests/scripts/e2e。SHA256：029791d7111045d131053801623f2ca6b74f396d1795c878518f4e1941be12f5。

未执行：全量validate、所有E2E、真实用户会话重放、真实Provider。仅修JavaScript UI/版本工具，无TS变更；已有严格类型结果复用，不声称本轮重跑typecheck。

## 后续用户再次报告：真实升级与 Chrome 错误列表核对

新增真实对照脚本位于忽略目录 `upgrade-error-inventory.mjs`。从保存的0.8.63 ZIP加载临时副本，使用真实页面选择/Escape产生Chrome runtimeErrors；复制0.8.64到同一临时安装路径再重载，确认扩展卡片已显示0.8.64但旧文档仍执行0.8.63脚本，且保留历史错误。清空记录后在旧页面选择仍会产生相同失效错误；刷新时旧脚本的pagehide清理还能最后追加null/removeEventListener记录。因此恢复顺序应为：先刷新所有仍加载旧版的网页，最后Clear all。不要先清空再刷新并把卸载旧页面时的错误误当作新页面错误。

刷新旧文档、再清空记录后，重新划词/Escape/再次重载扩展，Chrome runtimeErrors为空、pageerror为空。整个过程只用临时profile、本地合成页面和保留的公开包，未访问用户私人会话或清理用户浏览器记录。此对照证明存在与截图一致的升级遗留路径，不声称已直接检查用户浏览器。

新增永久E2E直接使用页面选择事件与Escape，检查Chrome实际runtimeErrors，不在popover外围catch异常；正常64页面、64重载后的旧上下文、刷新后的新页面三阶段均应为空。`TF_E2E_ARTIFACT=dist/extension npm run test:e2e -- e2e/content-ui-reload.spec.mjs`两项PASS。用0.8.63临时解压副本运行同一新增测试，重载后的划词入口无法创建而FAIL；未修改包源码造红。0.8.64包fingerprint未变。没有发现需要再次修改生产代码的证据，复用原包，不为回归证据升版本。

## 版本与交付

本地新安装目录仍为dist/extension，0.8.64。Downloads独立目录TranslateFlow-0.8.64-升级错误修复，包含ZIP、SHA256和更新步骤。0.8.61/62/63旧包均保留，未操作商店。

GitHub README顶部不再停留0.8.50：PR #376已合入，标题为「TranslateFlow v0.8.64（开发候选）」。准确文档candidate e0b13de7e07f0cdeac8b2be4433dbc605b9ee766，sync ff290d8aa21ea118ddb39d066a104cab35ec579d，merge ffe32c13569ced81fda355441da4beca6bfec481。main tree与sync完全一致，公开README全文/首行字节核对通过。main源码版本0.8.50仍在表中准确披露，没有把本次文档与版本工具同步冒充全部功能或修复代码已合入。

主Agent检查实际调用链、diff及新包：仅装饰图标异常回退和未完成浮窗的局部清理；不增加权限、联网、迁移或重试预算，不改词典/缓存/Provider行为。开发分支代码仅本地提交，candidateHead/mergeHead留空，状态reviewing；已有商店文档未提交修改保护不动。
