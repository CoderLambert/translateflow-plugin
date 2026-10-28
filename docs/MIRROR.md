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

## 每次发布的步骤

```bash
# 1. 构建并确认产物版本
npm run build:extension:release
python3 -c "import json;print(json.load(open('dist/extension/manifest.json'))['version'])"

# 2. 与 GitHub Release 使用同一个 zip（先打包，再上传 Release）
cd dist/extension && zip -qrX ../../translateflow-<version>-chrome.zip . -x '.*' -x '*/.*' && cd ../..

# 3. 发布到镜像（脚本会读 zip 内的 manifest 校验版本、上传、更新 latest/SHA256SUMS/index.html，并回读校验 sha256）
node scripts/publish-mirror.mjs \
  --zip translateflow-<version>-chrome.zip \
  --version <version> \
  --public-base https://git.lambert.host/translateflow

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
