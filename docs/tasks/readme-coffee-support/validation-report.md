# README、爱发电与 GitHub 入口交付（0.8.62）

基线 `a7561dfd3ec095c358f4e12edf6682985476c50e`，分支 `feat/unified-reading-polish`。用户授权重写 README，在关于页加入自愿支持，随后明确使用爱发电主页 `https://afdian.com/a/transflow`，并追加设置页 GitHub 图标/欢迎 Star。

## 已完成

- README 重写为面向用户的介绍、功能表、真实界面截图、安装、三步开始、翻译方式、数据与权限、反馈和开发链接；保留第一行版本格式。完整介绍网页、划词、文本、字幕和学习回顾，并准确说明缓存复用减少对应 API 调用与费用、导入词典后的离线查询，不把特色误写成全部产品范围。
- README 增加爱发电入口与主页分享二维码，说明支持自愿、不解锁功能、不包含第三方 AI 额度，在平台确认金额及支持周期。两张展示图来自此前真实本地模型/公开自写文章验收，不宣传所有模型都具有相同效果。
- 关于页加入轻量支持卡片，外部链接只在点击时打开；主页二维码默认折叠、本地加载，扫码前往主页而非直接扣款。不接入支付 SDK/API、不查订单、不传用户内容，不新增权限。
- 设置导航底部新增本地 SVG GitHub 图标及“欢迎 Star”，各栏目都可访问；点击只打开准确仓库首页，不登录、自动点赞或获取账号信息。外部链接使用 noopener/noreferrer 和 no-referrer。
- 关于页介绍同步产品全貌与缓存/离线词典特点；中英文文案配对。
- 支持 URL 与二维码路径由纯共享常量拥有；资源进入精确打包映射，未增加网页可访问资源。二维码使用本机 qrencode 生成，不请求远程二维码服务。
- 中英文隐私政策补充爱发电外部支持路径及支付数据由平台处理，插件不读取付款身份或支持状态。随包 HTML 从唯一 Markdown 源重新生成。
- GitHub Pages 政策更新已部署：`gh-pages@0262b2ac527db124b509d36e16b7501f6db491b9`，built；两种公开政策 HTTP 200 且字节与本地生成结果一致。未推送产品分支、合入 main 或提交商店。

## 实际验证

原始证据位于忽略目录 `docs/task-execution/local/readme-coffee-support/`。

- README 版本标题与 package 一致，内部文档/图片路径存在，无断链；Git diff 空白检查通过。
- `zbarimg --quiet --raw assets/support/afdian-transflow.png`：准确解码为用户提供的 `https://afdian.com/a/transflow`。同样对窄屏暗色真实截图解码成功，验证实际显示后的可读性。
- `node scripts/legal-assets.mjs --generate`、`node scripts/i18n-locales.mjs --generate` 成功，最终1589个文案键。
- `npm run commit:prepare` 成功：0.8.62，准确暂存构建 tree `0205d7f1b3eae6a883cfd5264492f8148a775ef3`；编译、Manifest/资源/许可审核通过，146个文件。后续仅补报告和任务状态，不改变扩展构建输入。
- 临时 Chromium profile 中加载实际公开包，验证爱发电/仓库 href、GitHub target、欢迎Star显示、二维码初始折叠与加载、切换通用后仓库入口仍可见、390px暗色无横向溢出；查看设置和展开二维码的外部请求为0。主 Agent查看桌面和窄屏暗色截图。仅检查本地 UI，不访问支付结算或执行真实 Star。
- 首次临时显示检查在惰性图片完成加载前立即读取 naturalWidth，返回“QR resource not ready”；改为等待图片真实加载后通过，未修改生产代码掩盖资源问题。未将该首次脚本退出伪称成功。
- 用户持续要求避免重复测试，本轮未运行 Node/Vitest、严格 typecheck、完整 validate 或整轮E2E；采用构建与聚焦的实际显示核对。之前的全仓/支付平台/英文视觉结果不冒充本轮已验证。

## 产物与自查

- 安装目录：`dist/extension/`，0.8.62。
- 新 ZIP：`/home/lambert/Downloads/TranslateFlow-0.8.62-更新包/translateflow-0.8.62.zip`。
- ZIP SHA-256：`1198e12c4d8be12717bd20a06f081833890f230635249ced79960fa07992bc49`。
- 已核对 ZIP 根 Manifest、146个文件读取字节与已构建包相同，二维码源字节一致；二维码没有进入 web_accessible_resources。原0.8.61 ZIP和商店资料夹保留。

主 Agent对照源码、调用路径、实际包和截图自查，没有新增付款校验、网络请求、权限或数据持久化，也不以支持/Star解锁功能。SVG图标内联随扩展打包，无外部图标网络请求。本报告是主 Agent自查，不是独立审核。

维护者先前确认商店账号、AI生成图标、BYOK和本地功能测试的文档修改仍保留在工作区，本次不夹带入支持入口提交。README改写尚未同步GitHub主分支。此任务保持reviewing，未声称合入或商店发布完成。

如果商店草稿要包含这些新入口，应上传0.8.62 ZIP替换0.8.61；若已进入审核，遵循后台允许的取消审核/更新流程。代理本轮未操作商店或修改爱发电账号、方案、实名、收款、支付或提现设置。
