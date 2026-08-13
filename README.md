## 🔴 线上合影进行中

**收官之夜，来合影 👉 https://rio-palm-cfr-benz.trycloudflare.com/**

（活动期间在线；仅 dsh-external 内测成员可入镜。地址为活动期临时隧道，永久纪念版见 [`archive/index.html`](archive/index.html)）

---

# DSH 内测大合影 📸 · dsh-group-photo

DSH 内测收官之夜诞生的合影墙：内测成员用 GitHub 登录（**零权限授权**），通过**冻结白名单**校验后，在拍立得墙上入镜并留下一句话。这是内测社区的一件纪念作品。

> A polaroid-style group photo wall built for the last night of the DSH internal beta.
> Members sign in with GitHub OAuth (**zero scopes**) and are admitted only if their
> GitHub identity matches a **frozen whitelist** snapshot of the private-period tester
> roster. Join once, leave one message, live on the wall forever.

## 特性

- 📸 拍立得合影墙：头像卡片 + `NO.xxx` 编号 + 留言 + 入镜时间，实时更新、彩带庆祝、移动端适配
- 🔐 零权限 OAuth：授权页不申请任何 scope，登录只用于证明"你是你"
- 🧊 冻结白名单：资格名单是内测私有期的快照，组织公开化 / 成员变动均不影响
- 🔒 浏览同样上锁：合影数据接口需登录会话，未登录只能看到人数
- 📦 零依赖：纯 Node 内置模块 + 原生 HTML/CSS/JS，无构建步骤
- 🗃️ 一键导出静态纪念版（`archive/index.html`），永久保存、任意静态托管
- 🏷️ 成员卡自动展示其在 dsh-external 组织的**代表作仓库**（`works.json`，由仓库首笔 commit 作者映射）

## 目录结构

```
├── server.js             # 零依赖 Node 服务（OAuth 回调、白名单校验、数据、静态页）
├── public/index.html     # 合影墙前端（纯 HTML/CSS/JS）
├── config.json           # 默认配置（密钥留空，运行时用环境变量注入）
├── members.json          # 合影数据（示例为演示成员，真实数据勿随意公开）
├── whitelist.json        # 冻结白名单快照（示例为演示名单）
├── works.json            # 成员 → 代表作仓库映射（自动生成）
├── freeze-whitelist.js   # 用 PAT 拉取组织成员重新冻结白名单
├── export-archive.js     # 导出静态纪念版
├── archive/index.html    # 已导出的静态纪念版
└── skill/SKILL.md        # DSH 技能包装
```

## 快速开始

```bash
# 1. 在 GitHub 创建 OAuth App，回调地址填 http://localhost:8808/auth/callback
# 2. 环境变量注入密钥（绝不放仓库）
GH_CLIENT_ID=xxx GH_CLIENT_SECRET=xxx GH_ORG=dsh-external npm start
# 3. 打开 http://localhost:8808
```

支持的环境变量：`GH_CLIENT_ID`、`GH_CLIENT_SECRET`、`GH_ORG`、`PORT`。

## 本地部署

> 前置：Node.js ≥ 20（零 npm 依赖，无需安装包）

```bash
# 1. 拿代码（公开版，含演示数据）
git clone https://github.com/dsh-external/dsh-group-photo.git
cd dsh-group-photo

# 2.（可选）挂载真实数据：从私有数据层复制（仅维护者）
# git clone https://github.com/SenmuuuuW/dsh-group-photo-data.git /tmp/dsh-data
# cp /tmp/dsh-data/{whitelist.json,members.json,works.json,social.json} .

# 3. 配置密钥（环境变量或 config.json 二选一）
export GH_CLIENT_ID=你的ClientID
export GH_CLIENT_SECRET=你的ClientSecret
export GH_ORG=dsh-external

# 4. 启动
npm start        # 等价于 node server.js

# 5. 浏览器打开 http://localhost:8808
```

### 填空对照表（哪里拿 → 填到哪里）

| 要填的东西 | 去哪里拿 | 填到哪个文件的哪个字段 |
| --- | --- | --- |
| Client ID | GitHub → Settings → Developer settings → OAuth Apps → dsh-group-photo 页面顶部 | `config.json` 的 `clientId`（或环境变量 `GH_CLIENT_ID`） |
| Client Secret | 同一个页面 → Client secrets → **Generate a new client secret**（只显示一次，复制保存） | `config.json` 的 `clientSecret`（或环境变量 `GH_CLIENT_SECRET`） |
| 回调地址 | 同一个页面 → **Authorization callback URL** 输入框 | 填 `http://localhost:8808/auth/callback` → **Update application** |
| 真实合影数据 | 私有数据仓 `SenmuuuuW/dsh-group-photo-data`（需用你的 GitHub 账号登录） | 复制 `whitelist.json` / `members.json` / `works.json` / `social.json` 到项目根目录 |

**关键提醒**：GitHub OAuth App 只允许注册**一个**回调地址，且必须精确匹配：
- 本地跑 → 填 `http://localhost:8808/auth/callback`
- 公网隧道 → 填 `https://<隧道地址>/auth/callback`（每次换地址都要重新注册）

**可选操作**：

| 想做什么 | 命令 |
| --- | --- |
| 公网访问（临时隧道） | `cloudflared tunnel --protocol http2 --url http://localhost:8808` |
| 重新冻结白名单（需要 read:org PAT） | `node freeze-whitelist.js` |
| 导出静态纪念版 | `node export-archive.js`（产物 `archive/index.html`） |
| 自定义数据文件位置 | 环境变量 `GH_DATA_FILE` / `GH_WHITELIST_FILE` / `GH_WORKS_FILE` / `GH_SOCIAL_FILE` |

## 白名单冻结

```bash
# 把拥有 read:org 权限的 classic PAT 写进 config.json 的 pat 字段（或 GH_PAT），然后：
node freeze-whitelist.js   # → 生成/更新 whitelist.json，用完后立刻 revoke PAT
```

服务端运行时不使用 PAT；`whitelist.json` 按 mtime 热加载，重新冻结无需重启。

## 导出静态纪念版

```bash
node export-archive.js     # → archive/index.html（单文件，双击可开，可上 GitHub Pages）
```

## 安全设计

- 成员授权**零权限**：不申请任何仓库 / 组织 scope
- 资格判定只认**冻结快照**：按 GitHub 用户 id（主）+ 用户名（辅）匹配
- **Fail-closed**：白名单不可用即拒绝所有人，绝不放行
- 密钥仅存于部署平台环境变量与本机配置，永不进仓库
- 浏览与入镜均需成员会话；会话令牌 48 位随机十六进制 + HttpOnly

## 隐私说明

本仓库为**公开安全版**：`members.json` / `whitelist.json` / `works.json` / `archive/index.html` 均为**演示数据**（虚构成员）。

真实数据（内测成员名单、合影留言）由活动维护者存放在**私有数据层**（如 `SenmuuuuW/dsh-group-photo-data`），通过文件挂载或环境变量（`GH_WHITELIST_FILE` / `GH_DATA_FILE` / `GH_WORKS_FILE`）注入运行环境：

- 真实数据**永不进入公开仓库**
- 冻结白名单机制保证：无论组织未来如何变化，**只有私有期快照中的内测成员**可以登录、浏览与入镜——"曾经的内测成员"永远有效
- 部署示例：Render Secret Files 挂载三件套 + 三个环境变量指向挂载路径
