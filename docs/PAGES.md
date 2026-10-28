# GitHub Pages 站点

站点已启用，发布源为本仓库专用 `gh-pages` 分支根目录；应用源码的 main 与功能分支不因站点发布而合并。

- 首页：https://coderlambert.github.io/translateflow-plugin/
- 英文隐私政策：https://coderlambert.github.io/translateflow-plugin/privacy.html
- 中文隐私政策：https://coderlambert.github.io/translateflow-plugin/privacy-zh-CN.html
- 支持：https://coderlambert.github.io/translateflow-plugin/support.html
- 开源许可：https://coderlambert.github.io/translateflow-plugin/third-party.txt
- 公开阅读示例：https://coderlambert.github.io/translateflow-plugin/demo.html

## 维护

```bash
node scripts/legal-assets.mjs --generate
node scripts/build-pages.mjs
```

这两个命令只生成本地静态页面，输出 `dist/pages/`。政策与支持源仍是 docs/PRIVACY*.md 和 docs/SUPPORT.md；不再另手写一份网站政策。首页不使用脚本、分析、表单或自动上传，GitHub Pages 本身的请求处理在首页单独披露。所有链接都使用项目站点相对路径。

页面更新已审核且获得发布授权后：

```bash
node scripts/publish-pages.mjs --publish
```

该显式命令使用已有 `gh` 身份，上传唯一列出的静态文件到 `gh-pages`，以非强推更新分支，保留站点历史。需要本仓库写入与 Pages 管理权限。它不会推送产品分支、合入 main、提交商店或读取浏览器密码。已有 Pages 配置指向其他来源时会停止，不能把该站点脚本当通用覆盖命令。

GitHub 的分支 Pages 发布仍会运行其内建部署工作流；这与仓库日常手动质量检查不同。首次证书或部署可能尚未就绪，必须在发布后检查 Pages 状态与实际 HTTPS 内容，不把 Git commit 成功当页面已上线。

## 本次部署

站点提交：`676a2dff102c15baa46dc5cfaf08c060da2cc4f2`（仅静态站点）。Pages 报告 built、HTTPS 已强制，8 个公开页面/资源的实际响应均为 200，响应字节与本地站点生成结果完全相同。内容清单为公开 `site-manifest.json`，本地详细核对在忽略目录 `docs/task-execution/local/store-launch-preparation/pages-verification.json`。

该站点不含安装包、测试 profile、私人路径、API Key、用户页面或本地诊断日志。公开阅读示例为项目自写的演示文章，供截图和操作演示，不代表外部文章或模型质量基准。
