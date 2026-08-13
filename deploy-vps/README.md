# VPS 部署：nginx + cloudflared（大佬方案）

## 架构

```
用户 ──HTTPS──> cloudflared 隧道(Cloudflare 边缘, 永久域名)
                └─> nginx (80) ──> Node server.js (127.0.0.1:8808)
```

## 1. 买服务器

- 推荐海外轻量 VPS（免备案）：阿里云香港/新加坡轻量、DigitalOcean、Hetzner、Vultr（$4~6/月）
- 系统选 Ubuntu 22.04+

## 2. 装环境

```bash
apt update && apt install -y nginx curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
```

## 3. 部署应用

```bash
git clone https://github.com/dsh-external/dsh-group-photo.git /opt/dsh-photo
cd /opt/dsh-photo
# （真实数据版：把私有数据仓的 whitelist/members/works/social.json 复制进来）
```

## 4. systemd 守护（开机自启 + 崩溃自拉）

```bash
cp deploy-vps/dsh-photo.service /etc/systemd/system/
# 编辑文件填好 GH_CLIENT_ID / GH_CLIENT_SECRET
systemctl daemon-reload && systemctl enable --now dsh-photo
systemctl status dsh-photo
```

## 5. nginx 反代

```bash
cp deploy-vps/nginx-dsh-photo.conf /etc/nginx/sites-available/dsh-photo
ln -s /etc/nginx/sites-available/dsh-photo /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## 6. cloudflared 命名隧道（永久域名，需要 Cloudflare 账号 + 域名托管在 Cloudflare）

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login          # 浏览器授权
cloudflared tunnel create dsh-photo
# 编辑 ~/.cloudflared/config.yml（用 deploy-vps/cloudflared-config.yml 模板）
cloudflared tunnel route dns dsh-photo photo.你的域名.com
cloudflared service install      # 装成 systemd 服务
systemctl start cloudflared
```

没有域名也可先用临时隧道：`cloudflared tunnel --url http://localhost:8808`（地址随机，和现在 Mac 上一样）。

## 7. 收尾

- GitHub OAuth App 回调地址改为 `https://photo.你的域名.com/auth/callback`
- 数据备份：cron 定时把 /opt/dsh-photo/*.json 推送到私有数据仓

## 与 Mac 版的关系

- VPS 版上线后 = 主站（7×24），Mac 版可退役
- 白名单/合影数据文件从私有数据仓同步过去即可，成员登录体验完全一致
