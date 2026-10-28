# 国内下载镜像

GitHub Release 在中国大陆经常无法直接下载，因此安装包同时发布到自建静态镜像。镜像只是 nginx 提供的一个静态目录，不参与 Git 托管，也不改变源码仓库的位置。

- 下载页：<https://git.lambert.host/translateflow/>
- 最新版：<https://git.lambert.host/translateflow/translateflow-latest-chrome.zip>
- 固定版本：`https://git.lambert.host/translateflow/translateflow-<version>-chrome.zip`
- 校验：`https://git.lambert.host/translateflow/SHA256SUMS`

三个地址指向同一个 zip 内容，与 GitHub Release 附件**字节一致**（`sha256` 相同）。

## 目录结构

```text
/var/www/translateflow/
├── index.html                       下载页（手动维护文案，版本号/文件名/校验值由脚本改写）
├── SHA256SUMS                       sha256sum -c 可校验
├── translateflow-<version>-chrome.zip
└── translateflow-latest-chrome.zip  每次发布覆盖为最新版本
```

nginx 侧只有一条静态 location，写在 `/etc/nginx/sites-available/gitea` 的 443 server 块内、`location /` 之前：

```nginx
location ^~ /translateflow/ {
    alias /var/www/translateflow/;
    autoindex off;
    charset utf-8;
    add_header Cache-Control "public, max-age=300";
}
```

选择在 `git.lambert.host` 而不是新建子域，是因为该主机已有可用证书、`nginx -t` 影响面小；如果以后想换成 `dl.lambert.host`，需要先在 DNS 添加 A 记录指向服务器，再用 `certbot --nginx -d dl.lambert.host` 签证书，然后把上面这段 location 移到新 vhost。

## 即时同步（GitHub webhook → 服务器）

发布 Release 后不再等 timer：GitHub 会主动通知服务器，服务器立刻开始拉取。

```text
gh release create / GitHub 页面发布 Release
        │  release: published
        ▼
POST https://git.lambert.host/translateflow-hook   （带 X-Hub-Signature-256）
        ▼
translateflow-release-hook.service（127.0.0.1:18085，校验签名与事件）
        ▼  systemctl start --no-block
translateflow-mirror-sync.service（服务器自己从 GitHub 下载并校验）
```

这个设计的关键点：**GitHub 只发通知，文件仍然由服务器自己拉取**。所以 CI 里不需要放任何 SSH 私钥，服务器也不需要接受来自互联网的写操作；webhook 只持有一个 HMAC 共享密钥。

组成部分：

| 项目 | 位置 |
| --- | --- |
| hook 服务 | `/usr/local/bin/translateflow-release-hook.py`（仅 Python 标准库） |
| systemd | `/etc/translateflow-mirror/…`：`translateflow-release-hook.service`（root；`ProtectSystem=strict`、`ProtectHome=yes`、`PrivateTmp=yes`、`NoNewPrivileges=yes`） |
| 共享密钥 | `/etc/translateflow-mirror/webhook-secret`（`0600 root`） |
| nginx | `location = /translateflow-hook` 反代到 `127.0.0.1:18085`，只允许 POST |
| GitHub | 仓库 Settings → Webhooks，事件只订阅 `Releases`（hook id `704424840`） |

校验规则（不满足即拒绝，payload 不会进入 shell）：

| 条件 | 不满足时 |
| --- | --- |
| `X-Hub-Signature-256` 的 HMAC-SHA256 与密钥一致 | 403 |
| `X-GitHub-Event: release`（`ping` 返回 `pong`） | 其他事件返回 200 并忽略 |
| `action == "published"` | 200 并忽略（draft/edited 不触发） |
| `repository.full_name == CoderLambert/translateflow-plugin` | 403 |

已验证：`GET` → 405；错误签名 → 403；`push` → 200 忽略；`edited` → 200 忽略；他人仓库 → 403；合法 `published` → 202 且同步日志出现新的运行；GitHub 自己的 ping 投递返回 200。

运维：

```bash
ssh tencent 'sudo journalctl -u translateflow-release-hook.service -n 30 --no-pager'  # 通知是否到达
ssh tencent 'sudo journalctl -u translateflow-mirror-sync.service -n 30 --no-pager'   # 同步结果
ssh tencent 'sudo systemctl disable --now translateflow-release-hook.service'         # 停用即时通知（timer 仍兜底）
gh api repos/CoderLambert/translateflow-plugin/hooks                                              # 查看 hook
gh api repos/CoderLambert/translateflow-plugin/hooks/704424840/deliveries                         # 投递记录（含重投）
```

轮换密钥：`openssl rand -hex 32` → 写回 `/etc/translateflow-mirror/webhook-secret`（600 root）→ `systemctl restart translateflow-release-hook.service` → 用 `gh api -X PATCH repos/<repo>/hooks/<id>` 更新 `config.secret`。两侧必须同时改，否则签名校验会全部 403。

## 自动同步（兜底轮询）

webhook 是主路径，下面的 timer 只作为兜底：通知丢失、服务器重启、GitHub 重投失败时仍然能被追上。

镜像由服务器的 systemd timer 自动跟随 GitHub Release，不需要在 GitHub 里保存任何密钥（拉取方向是服务器 → GitHub，公开仓库无需凭据）：

| 项目 | 位置 |
| --- | --- |
| 同步脚本 | `/usr/local/bin/translateflow-mirror-sync` |
| service | `/etc/systemd/system/translateflow-mirror-sync.service`（oneshot） |
| timer | `/etc/systemd/system/translateflow-mirror-sync.timer`（开机 3 分钟后首跑，之后每 15 分钟） |
| 状态 | `/var/lib/translateflow-mirror/release-tag`（记录已同步的 tag） |

行为：

1. 用 `HEAD https://github.com/<repo>/releases/latest` 的 302 `Location` 读出最新 tag（不消耗 GitHub API 配额）；
2. tag 与状态文件一致则直接退出，不做任何下载；
3. 下载 `translateflow-<version>-chrome.zip`，读取 zip 内 `manifest.json` 校验版本与 tag 一致，不一致就失败退出、保留旧包；
4. 写入版本文件、覆盖 `translateflow-latest-chrome.zip`、重算 `SHA256SUMS`、改写 `index.html` 的版本号与校验值，最后写入状态文件。

常用操作：

```bash
ssh tencent 'sudo systemctl start translateflow-mirror-sync.service'      # 立即同步一次（幂等）
ssh tencent 'sudo journalctl -u translateflow-mirror-sync.service -n 20 --no-pager'
ssh tencent 'systemctl list-timers translateflow-mirror-sync.timer'
ssh tencent 'sudo systemctl disable --now translateflow-mirror-sync.timer' # 停用自动同步
```

已知边界：**最长约 15 分钟延迟**；服务器必须能访问 `github.com`（当前正常）；GitHub 侧删除或重命名 release 资产时脚本会失败并保留上一版，不会清空镜像。

如果希望"发布后立即同步"，可选做一个 GitHub Actions 工作流（`release: published` 触发），但那需要在仓库 Secrets 里放一对 SSH 密钥。当前不使用它的原因是不想把可写入生产服务器的凭据放进 CI；服务器主动拉取已经覆盖同一需求，本地 `scripts/publish-mirror.mjs` 也能立即发布。需要时再引入。

## 每次发布的步骤

```bash
# 1. 构建并确认产物版本
npm run build:extension:release
python3 -c "import json;print(json.load(open('dist/extension/manifest.json'))['version'])"

# 2. 与 GitHub Release 使用同一个 zip（先打包，再上传 Release）
cd dist/extension && zip -qrX ../../translateflow-<version>-chrome.zip . -x '.*' -x '*/.*' && cd ../..

# 3a. 立即发布到镜像（脚本会读 zip 内的 manifest 校验版本、上传、更新 latest/SHA256SUMS/index.html，并回读校验 sha256）
node scripts/publish-mirror.mjs \
  --zip translateflow-<version>-chrome.zip \
  --version <version> \
  --public-base https://git.lambert.host/translateflow

# 3b. 或者什么都不做：服务器 timer 会在下一个 15 分钟周期内自动跟上（也可手工触发，见上一节）

# 4. 快速自检
curl -sSI https://git.lambert.host/translateflow/translateflow-latest-chrome.zip | head -5
curl -sS https://git.lambert.host/translateflow/SHA256SUMS
```

脚本默认使用 `ssh` 别名 `tencent` 与目录 `/var/www/translateflow`，可用 `--host` / `--dir` 覆盖，`--dry-run` 只打印计划。它不会删除旧版本 zip，需要清理时手动 `ssh tencent 'rm /var/www/translateflow/translateflow-<旧版本>-chrome.zip'`。

## 回滚

- nginx 配置改动前会自动留档：`/etc/nginx/sites-available/gitea.bak.<timestamp>`；回滚即 `sudo install -m 644 <备份> /etc/nginx/sites-available/gitea && sudo nginx -t && sudo systemctl reload nginx`。
- `translateflow-latest-chrome.zip` 直接覆盖回上一版本文件，并同步 `SHA256SUMS` 与 `index.html` 中的版本号即可。

## 服务器现状与限制

- 该 VPS 位于腾讯云 **`na-siliconvalley`（美西）**，不是国内节点：从大陆访问走跨境线路，实测 1 MB 包约十几秒（约 60 KB/s），明显好于 GitHub 的常见表现，但不如国内对象存储或 CDN。
- nginx 1.28.3，`git.lambert.host` 站点对全站有 `limit_req zone=gitea_web_ip burst=20 nodelay` 与 ClaudeBot/GPTBot 拦截；单次 zip 下载不受影响。
- 想要更好的国内速度，可选：① 在同一家的国内地域另开实例或改用国内对象存储（默认域名可免备案，1 MB 文件的流量成本极低）；② 给现有域名接入 CDN（需备案域名）。
- 网盘（百度/夸克）不作为正式下载渠道：需要登录或客户端、分享链接会失效、无法保证"链接即最新版"，只适合发帖时临时转发。

## 与 Release 的关系

GitHub Release 仍是"源码版本 + 附件"的权威记录；国内镜像只是同一个附件的第二出口。两边的 `sha256` 必须一致，发布顺序建议：先构建 → 打 Release → 再发布镜像，最后核对两处校验值。
