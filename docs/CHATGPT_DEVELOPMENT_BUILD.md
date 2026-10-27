# TranslateFlow ChatGPT 订阅实验开发版

> 开发者预览；**不是** Chrome Web Store 发行版。此功能需要使用自己的本机 Native Host、符合条件的 ChatGPT 账号及官方授权。实验实现或模拟测试通过不代表已获得公共应用接入许可、真实套餐权限或商店审核通过。

## 公开版与开发版

- **公开版（默认）**：保留普通网页、划词、字幕、本地词典、API Key/自托管模型翻译；在设置 → Provider 只显示 ChatGPT 订阅开发者预览提示及本页链接。隐藏登录、模型和 Host 命令。保存过的订阅配置不会被删除，但公开版拒绝订阅推理。
- **开发版（单独构建）**：扩展 Manifest 额外带 `version_name: "<version>-dev"`，解锁现有 ChatGPT 订阅设置和 Native Messaging 连接。Chrome 应使用“加载已解压的扩展程序”安装，不属于 Chrome 商店自动更新渠道。
- 两个版本使用同一份 Provider/缓存/页面代码，不创建第二套翻译引擎；默认 `npm run build:extension` 和 `npm run build:extension:release` 始终生成公开版。

## 获取开发版 ZIP（GitHub Actions）

在项目 [GitHub Actions — ChatGPT developer extension](https://github.com/CoderLambert/translateflow-plugin/actions/workflows/chatgpt-dev-build.yml) 页面，打开一次成功的运行并下载 `translateflow-chatgpt-developer-<run-id>` Artifact（通常需登录 GitHub）。压缩包中含独立的 `translateflow-extension-dev.zip`、`SHA256SUMS` 和 `SOURCE_COMMIT.txt`。

如果暂无成功运行，维护者可从默认分支手动运行该 workflow；也可以按下方从源码构建。不要下载来源不明的“已配置好 ChatGPT 账号”的扩展包。

解压 `translateflow-extension-dev.zip` 到一个空目录，确认目录根部有 `manifest.json`，并确认其中 `version_name` 以 `-dev` 结尾。在 Chrome 打开 `chrome://extensions`、启用开发者模式，点击“加载已解压的扩展程序”选择此目录。复制页面显示的 **32 位扩展 ID**。本地安装路径变化或重新安装可能产生不同 ID，Host 必须使用这次实际显示的 ID。

## 自行从源码构建

环境：Node.js 24.21.x、npm 11.19.x；从可信 Git 提交获取源码：

```bash
git clone https://github.com/CoderLambert/translateflow-plugin.git
cd translateflow-plugin
npm ci
npm run build:extension:dev
```

输出在 `dist/extension-dev/`，将该目录加载为 unpacked 扩展。默认公开构建仍在 `dist/extension/`，互不覆盖。需要自己压缩时，应从 `dist/extension-dev` 目录内部创建 ZIP，使 `manifest.json` 位于归档根部。

## Native Host 本机配置（需要 Go 1.26+）

Native Host **不随扩展 ZIP 自动安装**，账号令牌不进入扩展 ZIP。当前尚无面向公众的已签名稳定 Host 可下载，开发者需自行从可信源码构建并进行当前用户级安装。

在**同一个仓库 checkout** 里，在扩展安装后将 `<扩展ID>` 换成 `chrome://extensions` 当前显示的 ID：

```bash
TF_CHROME_EXTENSION_ID=<扩展ID> TF_NATIVE_HOST_VERSION=0.8.48 npm run build:native-host:candidate
```

`TF_NATIVE_HOST_VERSION` 必须与当前候选扩展版本相符；更新版本后请按实际 `manifest.json` 更新它。构建产物位于 `.output/native-host-candidate/`，生成 `release-candidate.json`、`SHA256SUMS` 和适用于 Linux/Windows x64 的候选二进制。候选标记为 `publishable:false`、`NOT_SIGNED`，**不得当作已签名公共安装包分发或绕过系统的未知发布者警告**。

Linux（Google Chrome）自建示例：

```bash
./.output/native-host-candidate/translateflow-host-0.8.48-linux-amd64 install --extension-id <扩展ID> --browser chrome
```

如果使用 Chromium 而不是 Chrome，将最后一个参数改为 `--browser chromium`。Windows 在 PowerShell 中构建候选后，使用相应 `windows-amd64.exe install --extension-id <扩展ID>` 安装。具体平台、安装注册位置和安全边界见 [Native Host 安装文档](../native-host/INSTALLATION.md)。

Linux 图形会话还必须提供已解锁的 Secret Service；Windows 使用 DPAPI。插件不会替用户安装或解锁密钥环。Native Host 的卸载不会自动清除账号凭据，退出账号请先使用插件的“退出登录”操作。

## 使用与安全边界

1. 在开发版设置 → Provider → ChatGPT 订阅，明确点击启用 `nativeMessaging` 权限。
2. 检测 Host 后，点击“连接 ChatGPT 账号”，在官方授权页确认 `chatgpt.tokens.use.direct` 等实际授权范围。
3. 授权完成后从账号返回的列表选择模型、保存设置，再用非隐私测试句验证翻译。测试前不要输入账号密钥、网页私人内容或未脱敏日志。
4. 服务可能因账号资格、套餐额度、地区、模型或 OpenAI 接入审批限制而拒绝请求；**不通过私人网页登录态、Cookie、非官方接口绕过限制**。
5. OAuth 真实授权、套餐用量、系统安全存储与 Windows/Linux 安装均须由开发者在自己的环境中明确执行；自动化测试使用模拟输入，不触发真实账号操作。

Chrome Web Store 发行版不承诺此功能可用。开发者版独立试验不影响普通 API Key、Chrome 本地翻译、词典和字幕功能。
