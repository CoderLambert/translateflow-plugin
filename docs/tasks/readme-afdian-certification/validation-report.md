# README 爱发电创作者关联与版本说明验收

候选 `06eaaf9d1f27ec439963caa11c0dfb0efdf7c7ee`，基线 `d5b0e411dbe0195fb6dd179a2c17af196a211f83`，PR #374。主 Agent直接完成，没有独立审核或子Agent。

用户要求依据其认证截图，公开证明本GitHub创作项目与其爱发电主页的关联。截图明确允许GitHub平台公开宣传主页；目前申请已提交，不将文档补充写成平台认证通过。

README现在显著说明项目维护者CoderLambert已入驻爱发电，主页 `https://afdian.com/a/transflow` 由本人运营，用于支持项目持续开发与维护。提供可点击文字及本地二维码，自愿支持不解锁功能、不包含第三方AI额度；不新增支付SDK、订单查询或账号操作。

版本事实：main的Manifest/package为0.8.50；本地统一候选0.8.62已构建但尚未合入。README标题与main源码保持0.8.50，新增显著版本表及开发候选边界，避免仅改标题误导安装者。介绍和截图以0.8.62为主，明确main构建不包含AI文本小窗、新设置和内置文档。不将版本说明更新当作应用发布，不合入本地12个功能提交。

沿用已准备的用户向README，替换尚未存在于main的本地支持链接为公开Pages支持页，移除main没有的Pages开发文档链接。图片集中在docs/images，未修改生产资产、打包映射、Manifest、package/lock或源码。

实际验收：

- `node scripts/local-task.mjs run readme-afdian-certification -- git diff --check origin/main` PASS。
- `node scripts/local-task.mjs run readme-afdian-certification -- zbarimg --quiet --raw docs/images/afdian-transflow.png` PASS，输出准确主页URL。
- Python逐项核对README标题/Manifest/package一致，显著展示0.8.62未合入状态；作者关联、自愿说明、全部Markdown本地链接与HTML图片路径存在；Git diff仅README、docs/images和本任务归档。PASS。
- 主Agent自查明确作者与项目关系，链接拼写为transflow，不是translateflow；没有私有路径、支付身份、私有页面文字或API凭据进入公开文档。来源截图为公开自写文章和合成翻译文字；认证截图本身未上传。
- 按目标分支AGENTS/CONTRIBUTING的纯文档规则，不运行构建、类型检查、Node/Vitest或浏览器，不升应用版本。实际pre-commit仅执行暂存diff检查，未禁用或修改Hook。此前0.8.62安装目录和ZIP保持不变。

原始命令耗时及日志由local-task脚本绑定保存在Git忽略目录，acceptance记录本次准确候选与日志hash。合并采用squash和准确远端head保护，合并后核对main tree与同步head一致，并核对公开README实际内容。平台是否批准创作者认证仍由爱发电审核决定；本任务不代操作或重复提交认证。
