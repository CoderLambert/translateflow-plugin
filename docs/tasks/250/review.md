# 250 主 Agent 自查

候选 `20122c85e9a21ebdcd9ca475c66d3ca2eb037e76`，基线 `origin/main=8c3ad6d8bfc528a12b4b28d3c90ab97e0e403a32`。PASS。

`src/entries/content.js` 现在是唯一生产 Content 模块图，`entrypoints/content.ts` 让 WXT 输出稳定 `content-scripts/content.js/.css`。Manifest 静态注入、Popup 和 Commands 的发送失败恢复共用这两个安装路径；source owners 仍按 classic/IIFE global registry 顺序执行，bootstrap 幂等。生产 raw asset map 已移除 ISOLATED Content 源码，只保留 YouTube MAIN、六个 module Worker、locale 与认证词典的精确闭包。

边界自查：Content 编译闭包无 React、动态 import、网络/IDB/动态注册新 owner；`auto-sites.js` 仍只维护站点意图并清理旧注册；Manifest 权限、host、CSP、minimum Chrome、extension ID、cache/Reading DB schema 和 Provider 行为未扩大。MAIN/Worker 的稳定路径与执行 world 保持。包审计拒绝原始根 `content.js/content.css`、非 MAIN/Worker 的 `src/content/**`、未注册文件、测试/文档/开发资源与非学习中心 React。

same-ID 自查使用固定 `19e89b6` old artifact：Chrome 可在替换字节后暂留旧 background，但会清理引用已消失 raw 文件的旧动态注册；管理页 Reload 产生真实 update 事件，新 compiled Content 接管，旧 isolated world 失效并由页面刷新恢复。配置、三条缓存、两个 Rich MDX/MDD OPFS 词典、偏好、权限和扩展 ID 保持；首次实际打开学习中心只惰性新增精确空 `translateflow-reading-records` v1 schema。browser restart 后快照一致、Provider 仍只有种子调用、外部请求零转发。

正式证据：`npm run validate` PASS（1066 Node、16 Vitest、strict typecheck、默认 WXT）；显式 WXT 111 files / 1,734,539 bytes，platform code 1,483,168 ≤ 1,576,595，artifact fingerprint `e5d0d3e3b58c106b83793c0a466e22a0a012b299c4a427eccc2d1b34ec93b4f2`；WXT smoke PASS；本地确定性 Chromium 矩阵 33/33 PASS；same-ID old→Reload→restart 2/2 PASS。

历史失败保留：冻结前过宽全量 E2E 的外部 ECDICT 62.9 MiB 下载在 150 秒内只到 16 MiB，未完成安装。词典输入、网络 recipe 和认证未变，因此按本地最小执行规则不把该外部下载纳入 #250 正式门槛，也不把 FAIL 改写为 PASS。Chrome 102、真实 YouTube、真实付费 Provider、其它浏览器/隐身/商店发布未验证。
