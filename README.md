# CloudSSH 独立前端（Vercel 部署版）

把 CloudSSH 的**同一套**前端 UI 单独部署到 Vercel，后端仍然跑在 Cloudflare Workers 上。

界面、交互、登录流程、终端行为与直接打开 CloudSSH **完全一致**——因为两边用的是**同一份源码**
（构建时从 Worker 工程同步），不存在「复制粘贴后逐渐漂移」的问题。

---

## 1. 工作方式

```
浏览器（Vercel 上的独立前端）
   │  ① fetch /api/*        → CORS + credentials: include（会话 Cookie）
   │  ② fetch /api/*        → Authorization: Bearer <session-token>（Cookie 被浏览器屏蔽时的兜底）
   │  ③ wss  /api/ssh       → ?auth_token=<session-token>（WebSocket 无法自定义请求头）
   ▼
Cloudflare Worker（后端 + Durable Objects）
   │  · 校验 Origin 是否命中精确白名单（FRONTEND_URL / FRONTEND_ORIGINS）
   │  · 剥离 auth_token 后再转发给 Durable Object
   ▼
SSH 服务器 / SFTP / AI Agent
```

后端侧的全部安全边界（精确 origin 白名单、CORS 回显、Cookie 属性、OAuth 落点）都在
CloudSSH Worker 工程里实现，参见 `CloudSSH-for cloudflare workers/src/worker/frontend-origins.ts`。

---

## 2. 目录结构

```
Front end for vercel/
├── package.json          # Vercel 应用的依赖与脚本
├── pnpm-lock.yaml        # 锁定版本（Vercel 用 --frozen-lockfile 安装）
├── pnpm-workspace.yaml   # pnpm 策略（供应链约束）
├── vercel.json           # Vercel 构建/输出/路由配置
├── vite.config.ts        # Vite 配置（root=frontend，运行时配置注入插件）
├── public/
│   ├── config.js         # ★ 运行时配置：后端地址（部署后改这里即可换后端）
│   └── favicon.svg
├── scripts/
│   ├── sync-frontend.mjs # 从 Worker 工程同步前端源码（构建前自动执行）
│   ├── sync-deps.mjs     # 把依赖版本对齐到 Worker 锁文件
│   └── lib/worker-deps.mjs
├── frontend/             # ← 同步副本，不要直接编辑
│   ├── src/**            #   与 Worker 工程 frontend/src 完全一致
│   ├── index.html
│   ├── tsconfig.json / tailwind.config.cjs / postcss.config.cjs
└── src/                  # ← 同步副本（与前端共享的 schema / 常量模块）
```

> **`frontend/` 与 `src/` 是同步生成的副本。**
> 要改 UI 请改 `CloudSSH-for cloudflare workers/frontend/src/`，然后在本工程执行
> `pnpm run sync` 并提交同步结果。直接改副本会在下次同步时被覆盖。

---

## 3. 部署步骤

### 步骤 1：先部署好 CloudSSH Worker

本前端依赖一个已经可用的 Worker 后端。请先按 CloudSSH 主文档完成 Worker 部署，
拿到后端地址（例如 `https://cloudssh.example.com` 或 `https://cloudssh.workers.dev`）。

### 步骤 2：配置 Worker 的跨源白名单（必需）

在 Worker 的环境变量里新增（Dashboard → Settings → Variables，或 `wrangler.toml`）：

| 变量 | 作用 | 示例 |
| ---- | ---- | ---- |
| `FRONTEND_URL` | 外部前端主地址，自动加入白名单；用作 OAuth 登录后跳转与分享链接目标 | `https://cloudssh-frontend.vercel.app` |
| `FRONTEND_ORIGINS` | 额外的白名单 origin，逗号分隔（预览部署 / 多域名时用） | `https://preview.example.com,https://staging.example.com` |

**安全约束（务必遵守）：**

- **只支持精确 origin，禁止通配符。** `https://*.vercel.app` 这类条目会被直接忽略并打印告警。
  通配符会让任意第三方站点（例如别人 fork 出来的 Vercel 预览部署）都能带着用户会话调用
  你的 Worker API，等同于把账号交出去。
- 必须是纯 origin：`https://` 开头、不带路径/查询串/片段/凭据、不带尾斜杠。
- 生产环境必须是 `https://`；明文 `http://` 只放行 `localhost` / `127.0.0.1` / `::1`（本地联调）。
- **两项都留空 = 保持纯同源部署**，Worker 行为与改造前完全一致（不返回任何 CORS 头，
  Origin 校验依旧严格）。也就是说：这两个变量是「opt-in」的，不配就不会意外放开跨源访问。

`wrangler.toml` 里已经带了注释模板，取消注释并填值即可：

```toml
FRONTEND_URL = "https://cloudssh-frontend.vercel.app"
FRONTEND_ORIGINS = "https://cloudssh-frontend.vercel.app"
```

> test 环境请在 `[env.test.vars]` 里**单独**配置，不要和生产环境共用同一份 origin。

### 步骤 3：配置前端的后端地址（必需）

编辑 `public/config.js`：

```js
window.__CLOUDSSH_CONFIG__ = {
  apiBaseUrl: 'https://cloudssh.example.com', // ← 改成你的 Worker 地址
};
```

- `apiBaseUrl` 留空 = 同源部署（前端由 Worker 自己托管），此时本工程不适用于独立部署场景。
- 这个文件是**运行时**配置：构建产物发布后，改这里再重新部署即可切换后端，无需改代码。
- **绝不要**把后端地址放到 URL 参数或 hash 里——那会让任何人都能用构造链接把访客的
  登录凭据引到他控制的服务器。前端只接受来自本文件或构建期环境变量
  `VITE_CLOUDSSH_API_BASE_URL` 的地址。

### 步骤 4：Vercel 项目设置

连接 GitHub 仓库后，在 Vercel 项目的 **Settings → General** 里设置：

| 项目 | 值 |
| ---- | ---- |
| Root Directory | `Front end for vercel` |
| Framework Preset | `Other`（`vercel.json` 里 `framework: null`） |
| Install Command | `pnpm install --frozen-lockfile`（`vercel.json` 已声明） |
| Build Command | `pnpm run build`（`vercel.json` 已声明） |
| Output Directory | `dist`（`vercel.json` 已声明） |
| Node.js Version | 22 或更高（`package.json` 的 `engines.node: >=22`） |

`vercel.json` 已把 `/(.*)` 重写到 `/index.html`，SPA 路由（刷新子页面不会 404）无需额外配置。

> **两种可选的构建形态**
>
> 1. **Root Directory = `Front end for vercel`（推荐，最简单）**
>    Vercel 只上传本目录，构建时拿不到同级的 Worker 工程，`sync` 脚本会自动使用**已提交的
>    同步副本**（`frontend/` 与 `src/`）。因此这两个目录**必须提交到版本库**。
>    Worker 前端有更新时，在本地执行 `pnpm run sync` 后提交即可。
>
> 2. **Root Directory = 仓库根目录**
>    构建命令改为 `cd "Front end for vercel" && pnpm run build`，
>    输出目录改为 `Front end for vercel/dist`，
>    安装命令改为 `cd "Front end for vercel" && pnpm install --frozen-lockfile`。
>    这样构建时能直接读到 Worker 工程，永远同步到最新源码（零漂移）。
>    但仓库根目录需要自行准备 `vercel.json`。

### 步骤 5：GitHub OAuth 回调（不要改）

OAuth 回调必须留在 **Worker 地址**上，不要指向前端：

- Worker 的 `BASE_URL` 仍填 Worker 自己的地址（如 `https://cloudssh.example.com`）。
- GitHub OAuth App 的 **Authorization callback URL** 也填 Worker 地址。
- 前端发起登录时请求的是 Worker 的 `/api/auth/github?target=frontend`；
  Worker 登录成功后把会话令牌放在 **URL 片段**（`#token=...`）里跳回 `FRONTEND_URL`。
  前端读到片段后立刻用 `history.replaceState` 抹掉，避免令牌残留在浏览器历史里。

片段不会随 HTTP 请求发往服务端，因此不会进入访问日志，也不会出现在 `Referer` 里。

### 步骤 6：Turnstile（如果启用了）

如果 Worker 配置了 `TURNSTILE_SECRET` / `TURNSTILE_SITEKEY`：

- 在 Cloudflare Turnstile 控制台里，把**前端域名**（如 `cloudssh-frontend.vercel.app`）
  加入 sitekey 的 **Hostname Management** 白名单。
- Token 仍由 Worker 服务端用 `TURNSTILE_SECRET` 校验，密钥不需要暴露给前端。

---

## 4. 本地开发

```bash
cd "Front end for vercel"

pnpm install --frozen-lockfile   # 安装依赖
pnpm run sync                    # 从 Worker 工程同步前端源码
pnpm run dev                     # Vite 开发服务器（默认 http://localhost:5173）
```

本地联调时：

1. `public/config.js` 填本地 Worker 地址（`http://localhost:8787`）。
2. Worker 侧设置 `FRONTEND_URL=http://localhost:5173`（回环地址允许明文 HTTP）。
3. 在 Worker 工程执行 `pnpm run dev` 起本地 Worker。

> 提示：Worker 工程自带的开发服务器代理 `/api` 到 `localhost:8787`，
> 所以直接用 Worker 工程里的前端调试是更省事的方式；本工程主要用于验证「独立部署」形态。

---

## 5. Worker 前端更新后如何同步

```bash
cd "Front end for vercel"
pnpm run sync        # 同步 frontend/src 与共享模块（src/）
pnpm run sync:deps   # 仅当 Worker 前端依赖发生变化时才需要
pnpm install         # sync:deps 之后必须重装，更新本工程锁文件
pnpm run build       # 本地验证构建
```

然后把 `frontend/`、`src/`、`package.json`、`pnpm-lock.yaml` 的变更一起提交。

`pnpm run sync` 会校验依赖版本是否与 Worker 锁文件一致，不一致时打印告警
（不会自动改写 `package.json`，因为 Vercel 用 `--frozen-lockfile` 安装）。

---

## 6. 安全说明

| 风险 | 防护 |
| ---- | ---- |
| 第三方站点盗用会话 | Worker 只接受**精确 origin** 白名单；通配符一律拒绝并告警 |
| CORS 通配放行 | 始终回显**具体** origin 并带 `Access-Control-Allow-Credentials: true`，绝不用 `*` |
| 预检探测 | 白名单外来源的 `OPTIONS` 一律 403（fail closed），不泄露任何放行信号 |
| 凭据外带（构造链接） | 后端地址只能来自 `public/config.js` 或构建期变量，**绝不**来自 URL 参数/片段 |
| 开放重定向 | OAuth 落点只接受固定字面量 `?target=frontend`，跳转目标始终取自服务端配置的 `FRONTEND_URL` |
| 令牌泄漏到日志 | 令牌经 URL **片段**传递（不进访问日志/Referer），且读入后立即从地址栏移除 |
| `auth_token` 泄漏到 DO | Worker 校验 Origin 后**在转发给 Durable Object 前剥离**该查询参数 |
| 第三方 Cookie 被拦截 | 备有 `Authorization: Bearer` 通道；令牌仅在跨源模式下存 localStorage，同源部署沿用 HttpOnly Cookie |
| 跨站 WebSocket 劫持 | `/api/ssh` 的 `Origin` 校验不放宽：缺失 Origin 一律拒绝，只有同源或白名单来源才放行 |
| 供应链 | 依赖版本锁定到 Worker 的 `pnpm-lock.yaml`；沿用 `minimumReleaseAge` / `blockExoticSubdeps` 策略 |

### 会话令牌存放在哪里

| 部署形态 | 会话凭据 |
| -------- | -------- |
| 同源（Worker 自带前端） | HttpOnly Cookie（`SameSite=Lax`），前端**不接触**令牌，行为与改造前完全一致 |
| 跨源（本工程） | ① `SameSite=None; Secure` Cookie（浏览器允许第三方 Cookie 时）<br>② `Authorization: Bearer`（Cookie 被拦截时的兜底，令牌存 localStorage，仅跨源模式启用） |

### 关于会话令牌存 localStorage

跨源模式下令牌保存在 `localStorage`（键名 `cloudssh_session_token`），这意味着**该前端域名的
XSS 就能拿到会话**。本工程复用 CloudSSH 主前端源码，其渲染路径与主前端一致（Markdown 经
DOMPurify 消毒、动态值均转义）；若你自行修改了同步副本里的渲染逻辑，请重新评估这一条。

---

## 7. 故障排查

| 现象 | 排查方向 |
| ---- | ---- |
| 浏览器控制台报 CORS 错误 | Worker 侧的 `FRONTEND_URL` / `FRONTEND_ORIGINS` 是否包含前端的**精确** origin（注意 `https://`、无尾斜杠、无路径） |
| 登录后跳回 Worker 而不是前端 | Worker 未配置 `FRONTEND_URL`，或前端没有请求 `?target=frontend` |
| 登录成功但提示未登录 | 浏览器拦截了第三方 Cookie。检查 `Authorization: Bearer` 通道是否生效（DevTools → Network → Request Headers） |
| WebSocket 连不上 | 检查 `Origin` 是否被放行；确认前端域名的 `auth_token` 在转发前已被剥离；确认后端没有要求登录但前端未携带令牌 |
| 401 / 403 反复出现 | 先看 Worker 日志里 `[FrontendOrigins]` 开头的告警——它说明某条白名单条目非法被忽略 |
| 构建时报 `找不到 CloudSSH Worker 工程目录` | Root Directory 指向了本工程但 `frontend/`、`src/` 没提交；见步骤 4 的两种形态 |
| 构建报依赖版本不一致 | 执行 `pnpm run sync:deps && pnpm install` 后提交锁文件 |

---

## 8. 已知限制

- **会话在浏览器侧可见**：跨源模式下令牌存 localStorage（同源模式不受影响）。
- **分享链接**：Worker 生成的分享链接会指向 `FRONTEND_URL`（若已配置），因此从外部前端
  打开的分享链接会落在外部前端上，行为一致。
- **CSP / 安全响应头**：Vercel 默认不注入 CSP。本前端是纯静态 SPA + 跨源 API，
  若你的组织要求严格 CSP，请在 `vercel.json` 的 `headers` 里补充，并确保
  `connect-src` 包含 Worker 地址、`script-src` 允许 `https://challenges.cloudflare.com`。
- **版本同步**：前端源码来自 Worker 工程。本工程不单独发版，Worker 前端更新后按第 5 节同步即可。
