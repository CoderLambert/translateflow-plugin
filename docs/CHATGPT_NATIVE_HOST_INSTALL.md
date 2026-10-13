# ChatGPT 本地组件安装与发布引导

TranslateFlow 的网页翻译、本地词典和其他 Provider 不依赖本地组件。只有选择 **ChatGPT 订阅** 作为 Provider 时，才需要安装 TranslateFlow 本地组件。该组件通过 Chrome Native Messaging 在扩展与 ChatGPT 官方接口之间建立受限连接。

> 当前文档是正式发布前的安装模板。公开发布前必须完成本文末尾的发布检查；没有有效平台签名的候选文件不得提供给普通用户。

## 用户安装

### 1. 安装扩展并启用连接权限

1. 从 Chrome Web Store 安装 TranslateFlow。
2. 打开 **TranslateFlow 设置 → Provider**。
3. 在 **ChatGPT 订阅** 区域点击 **启用本地连接**。
4. 接受 Chrome 显示的本地应用连接权限。

拒绝该权限不会影响词典、DeepSeek 或 OpenAI-compatible 等其他功能。之后仍可回到此处重新启用。

### 2. 下载正确的安装包

只从以下入口下载：

- TranslateFlow 设置页中的 **下载 TranslateFlow 本地组件**；
- 项目 GitHub Releases 的最新稳定版本。

根据操作系统选择文件：

| 系统 | 发布文件 | 支持范围 |
| --- | --- | --- |
| Windows 10/11 x64 | `translateflow-host-<版本>-windows-amd64.exe` | Google Chrome stable |
| Linux x64 | `translateflow-host-<版本>-linux-amd64` | Google Chrome stable；开发用途也可指定 Chromium |

发布页应同时提供每个文件的 SHA-256。文件来源、签名或哈希无法确认时，请停止安装并到项目仓库反馈。

### 3. Windows 安装

1. 确认文件的数字签名发布者与发布说明一致。
2. 双击已签名的 Windows 安装文件。
3. 安装程序会注册到当前 Windows 用户，不需要管理员权限。
4. 完成后返回 TranslateFlow 设置页，点击 **已经安装 · 重新检测**。

正式发布包会绑定 Chrome Web Store 中 TranslateFlow 的准确扩展 ID。若 Windows 显示未知发布者，或安装文件没有有效签名，不要选择绕过警告继续运行。

### 4. Linux 安装

在下载目录中校验哈希，然后运行：

```bash
sha256sum translateflow-host-<版本>-linux-amd64
chmod +x translateflow-host-<版本>-linux-amd64
./translateflow-host-<版本>-linux-amd64
```

正式发布文件已绑定准确的 Chrome Web Store 扩展 ID；无参数运行时会为当前 Linux 用户安装并注册 Google Chrome host。默认位置是：

```text
~/.local/share/translateflow/native-host/translateflow-host
~/.config/google-chrome/NativeMessagingHosts/com.coderlambert.translateflow.json
```

开发环境需要为 Chromium 注册时，可显式执行：

```bash
./translateflow-host-<版本>-linux-amd64 install \
  --extension-id <chrome://extensions 中显示的扩展 ID> \
  --browser chromium
```

Linux 登录需要当前桌面会话提供已解锁的 Secret Service。组件不会自行安装或解锁 GNOME Keyring、KWallet 等凭据服务。

### 5. 检查连接并登录

1. 返回 **TranslateFlow 设置 → Provider → ChatGPT 订阅**。
2. 点击 **已经安装 · 重新检测**。
3. 状态正常后点击 **连接 ChatGPT 账号**。
4. 在官方授权页面确认账号与权限。
5. 回到设置页选择 Host 返回的模型，并保存全局设置。

组件安装本身不会登录账号，也不会自动发送网页或词典内容。只有用户主动翻译或请求 AI 解释时才调用 Provider。

## 升级和重启

当设置页提示本地组件版本过旧时：

1. 从设置页打开最新稳定发布页。
2. 下载并校验新版安装文件。
3. 按对应系统的安装步骤再次运行；新文件会替换当前用户的旧版本。
4. 回到设置页点击 **重启本地组件**，再点击 **已经安装 · 重新检测**。

登录或推理正在进行时，TranslateFlow 会拒绝重启，避免中断并误报结果。等待当前操作结束后再试。组件升级不会主动清除已保存账号。

## 卸载

建议先在设置页退出 ChatGPT 账号，再卸载组件。退出操作负责撤销当前会话；单独运行卸载命令会保留系统安全存储中的凭据记录。

Windows 应从下载目录中的独立安装文件运行：

```powershell
.\translateflow-host-<版本>-windows-amd64.exe uninstall
```

Linux Chrome：

```bash
./translateflow-host-<版本>-linux-amd64 uninstall --browser chrome
```

Linux Chromium：

```bash
./translateflow-host-<版本>-linux-amd64 uninstall --browser chromium
```

卸载只移除属于 TranslateFlow 的当前用户注册、Host manifest 和不再被其他已注册浏览器使用的组件文件。发现注册冲突时会停止，不覆盖其他程序的数据。

## 常见问题

### 提示“尚未安装或注册”

- 确认安装组件和运行 Chrome 使用的是同一个系统用户。
- 确认下载的是对应操作系统和 CPU 架构的文件。
- 重新运行安装文件，然后在设置页点击 **已经安装 · 重新检测**。
- 开发版扩展的 ID 可能与商店版不同；开发环境必须用 `chrome://extensions` 显示的准确 ID 注册。

### 提示“需要更新本地组件”

已安装组件低于扩展要求的最低版本，或旧组件还没有版本握手字段。重新安装最新稳定版，然后在设置页重启并检测。

### 提示权限不可用

回到设置页点击 **启用本地连接**，重新授予 Chrome 的可选 `nativeMessaging` 权限。扩展不会在后台静默申请该权限。

### Linux 提示安全存储不可用或已锁定

确认当前图形会话存在可用且已解锁的 Secret Service，并从同一桌面会话启动 Chrome。TranslateFlow 不会自动解锁安全存储，也不会降级为明文保存凭据。

### Windows 阻止运行安装文件

不要绕过未知发布者警告。确认文件来自项目正式发布页、SHA-256 匹配，并且数字签名有效；否则应停止安装。

### 点击重启后提示本地组件忙碌

账号授权、模型查询或推理尚未结束。等待操作完成或主动取消当前请求，再执行重启。

## 安全边界

- Host 名称固定为 `com.coderlambert.translateflow`。
- 注册仅允许一个准确的 `chrome-extension://<扩展 ID>/`，不使用通配符。
- 扩展 Background 是唯一 Native Messaging 连接 owner。
- Host 不提供任意 Shell、文件路径、URL 或工具调用接口。
- 凭据只保存在当前用户的系统安全存储；日志不记录 Token、授权码、Prompt 或模型正文。
- 扩展不会下载后自动执行安装文件，也不会静默升级本地组件。

## 发布维护者检查表

公开发布前逐项完成并保存验收证据：

- [ ] 已取得稳定的 Chrome Web Store 扩展 ID，并确认与商店最终包一致。
- [ ] Host 版本使用严格的 `x.y.z`，且不低于扩展中的最低 Host 版本。
- [ ] 使用准确身份构建候选：

  ```bash
  TF_CHROME_EXTENSION_ID=<商店扩展 ID> \
  TF_NATIVE_HOST_VERSION=<x.y.z> \
  npm run build:native-host:candidate
  ```

- [ ] `release-candidate.json` 中的 commit、扩展 ID、版本、目标平台、字节数和 SHA-256 均与待发布文件一致。
- [ ] Windows 文件已用项目批准的代码签名证书签名，并在干净的 Windows 10/11 x64 用户环境验证签名、安装、升级和卸载。
- [ ] Linux 文件或发布清单已使用项目批准的发布密钥签名，并在干净的受支持发行版验证安装、升级和卸载。
- [ ] GitHub Release 只包含已批准的正式文件、SHA-256 和签名材料；未签名候选保持 `publishable:false`，不得上传为稳定发布。
- [ ] 从 Chrome Web Store 实际安装扩展，验证首次可选权限提示、下载入口、Host 检测和版本过旧恢复。
- [ ] 验证登录、模型列表、一次非敏感测试请求、退出，以及浏览器和系统重启后的恢复。
- [ ] 验证不安装或禁用组件时，词典及其他 Provider 仍能正常使用。
- [ ] 更新本文中的文件名、支持系统、发行入口和故障排查信息；确认没有遗留占位符或内部路径。

底层注册路径、开发构建和回滚细节见 [`native-host/INSTALLATION.md`](../native-host/INSTALLATION.md)。协议与凭据边界见 [`native-host/README.md`](../native-host/README.md)。
