# Windows 本地启动与开发指南

本文档面向 **Windows 11 / Windows 10** 用户,讲清楚两种运行方式:

- **方式 A:本机 Bun 跑 Next dev,Docker Desktop 跑 PostgreSQL + Redis**(推荐,改代码热更新)
- **方式 B:所有服务全部跑在 Docker Desktop 里**(贴近生产,适合验证发布镜像)

两种方式都需要先装好基础工具。

---

## 0. 前置准备

### 0.1 必装

| 工具 | 用途 | 安装方式 |
|------|------|---------|
| **Docker Desktop** | 跑 PG / Redis(方式 A);跑全部服务(方式 B) | https://www.docker.com/products/docker-desktop/ |
| **Bun** ≥ 1.3 | 包管理 + dev server(仅方式 A 需要) | PowerShell:`irm bun.sh/install.ps1 \| iex` |
| **Git** | 拉代码 | https://git-scm.com/download/win |

> Docker Desktop 安装后默认使用 WSL2 后端,**记得在设置里启用 WSL2 Integration**(Settings → Resources → WSL Integration),否则 `docker` 命令在 PowerShell 里可能找不到。

### 0.2 可选(用 Makefile 时才需要)

仓库自带的 `Makefile` 是 GNU make 语法,Windows 原生没有 `make`。三选一:

| 方案 | 说明 |
|------|------|
| **WSL2 Ubuntu**(推荐) | 装 Ubuntu 后 `sudo apt install make`,在 WSL 里 `make dev` 完整可用 |
| **Git Bash + make** | 用 [chocolatey](https://chocolatey.org) `choco install make`,然后 Git Bash 里执行 |
| **不装 make,直接走 docker compose / bun 命令** | 本文档后面给出的"原始命令"路径完全不依赖 make |

> 如果你不打算用 WSL,本文档后面所有命令都给了**不依赖 make 的等价 PowerShell 写法**。

### 0.3 端口占用检查

默认会用到这些端口,先确认本机没被占用:

```powershell
# PowerShell
Get-NetTCPConnection -LocalPort 5432,6379,13500,23000 -ErrorAction SilentlyContinue
```

冲突时:5432 / 6379 在 `docker-compose.dev.yaml` 里可以通过环境变量改;13500 是 `next dev` 默认端口(改 `package.json` 的 `dev` 脚本);23000 是 Docker app 对外端口(改 `APP_PORT`)。

### 0.4 拉代码

```powershell
git clone https://github.com/ding113/claude-code-hub.git
cd claude-code-hub
```

> 后续命令默认在仓库根目录执行。

---

## 1. 方式 A:本机 Bun + Docker DB(开发首选)

**适用场景**:改代码、调试、跑测试。Next dev 自带热更新,响应最快。

### 1.1 起 PG + Redis

仓库根目录有专门的开发用 compose 文件 `docker-compose.dev.yaml`,只起 PG(5432) + Redis(6379),并将端口暴露到 `127.0.0.1`,供本机 `bun dev` 直连。

```powershell
docker compose -f docker-compose.dev.yaml up -d
```

验证:

```powershell
docker compose -f docker-compose.dev.yaml ps
# 应看到 postgres + redis,STATE 都是 running/healthy
```

> 数据持久化在 Docker 命名卷 `db_dev_data`(PG)和 `./data/redis`(Redis)。停服务用 `docker compose -f docker-compose.dev.yaml down`,**加 `-v` 才会删数据卷**。

### 1.2 准备环境变量

复制根目录的 `.env.example` 为 `.env`,改两个值即可:

```powershell
Copy-Item .env.example .env
```

用编辑器打开 `.env`,**至少**修改:

```dotenv
# 必填:管理员登录令牌(自行设个强密码)
ADMIN_TOKEN=your-strong-admin-token

# 本机 bun dev 直连 Docker PG 的连接串
DSN=postgres://postgres:postgres@127.0.0.1:5432/claude_code_hub

# 本机 bun dev 直连 Docker Redis
REDIS_URL=redis://127.0.0.1:6379

# 自动建表/迁移(首次启动必须)
AUTO_MIGRATE=true

# 本机开发关掉 secure cookie,否则 http://localhost 收不到登录 Cookie
ENABLE_SECURE_COOKIES=false
```

> 其它字段保留默认即可。`.env.example` 是 `docker-compose.yaml` 用的,本机 `bun dev` 也会自动加载根目录 `.env`,共用一份没问题。

### 1.3 安装依赖

```powershell
bun install
```

### 1.4 启动 dev server

```powershell
bun run dev
```

执行流程:`tsgo` 预飞类型检查 → `next dev --port 13500`。看到 `Ready in xxx ms` 即可。

浏览器打开:**http://localhost:13500**,用 `ADMIN_TOKEN` 登录。

### 1.5 常用开发命令

```powershell
bun run typecheck       # 类型检查
bun run lint            # Biome 检查
bun run lint:fix        # Biome 自动修
bun run test            # Vitest 单测
bun run test:ui         # 交互式测试 UI
bun run build           # 生产构建(本地验证)
```

按 `CLAUDE.md` 约定,**提交前必须**全部跑过:`build` → `lint` → `lint:fix` → `typecheck` → `test`。

### 1.6 数据库迁移

修改 `src/drizzle/schema.ts` 后:

```powershell
bun run db:generate     # 生成 SQL 到 drizzle/
bun run db:migrate      # 应用(或者重启 dev server 让 AUTO_MIGRATE 处理)
bun run db:studio       # 可视化看库
```

### 1.7 停掉环境

```powershell
docker compose -f docker-compose.dev.yaml down       # 停容器,保留数据
docker compose -f docker-compose.dev.yaml down -v    # 停并清空数据(慎用)
```

---

## 2. 方式 B:全部在 Docker Desktop 里跑

**适用场景**:验证 Dockerfile / 生产镜像、给同事 / CI 复现、做发布演练。

仓库提供两个 Docker 路径:

| 路径 | Compose 文件 | App 镜像来源 | 适用 |
|------|-------------|------------|------|
| **B-1:用官方预构建镜像** | 根目录 `docker-compose.yaml` | 拉 `ghcr.io/ding113/claude-code-hub:latest` | 想最快跑起来,不改代码 |
| **B-2:本地构建镜像** | `dev/docker-compose.yaml` | 用 `deploy/Dockerfile` 在本机构建 | 想验证你自己改过的代码打成的镜像 |

### 2.1 路径 B-1:用官方镜像(最简单)

#### 准备 `.env`

```powershell
Copy-Item .env.example .env
```

修改 `.env`,**至少**确保:

```dotenv
ADMIN_TOKEN=your-strong-admin-token

DB_USER=postgres
DB_PASSWORD=a-strong-db-password
DB_NAME=claude_code_hub

# 容器内对外暴露端口(浏览器访问用)
APP_PORT=23000

# 容器内通信地址,不要改!
REDIS_URL=redis://redis:6379

# 自动迁移
AUTO_MIGRATE=true

# 本机 HTTP 访问需要关掉
ENABLE_SECURE_COOKIES=false
```

> `DSN` 这里**不需要**写 — `docker-compose.yaml` 的 `environment` 块会用 `DB_USER/DB_PASSWORD/DB_NAME` 拼出容器内连接串。

#### 起容器

```powershell
docker compose up -d
```

首次会拉镜像,可能要几分钟。验证:

```powershell
docker compose ps
docker compose logs -f app
```

浏览器打开:**http://localhost:23000**。

#### 拉新版本

```powershell
docker compose pull app
docker compose up -d
```

#### 数据持久化

数据落在仓库根目录 `./data/postgres`(PG)、`./data/redis`(Redis)、`./data/reports`(Node 崩溃诊断报告)。**别误删**。

### 2.2 路径 B-2:本地构建镜像

适合改了源码、想看在容器里跑得对不对的场景。compose 文件在 `dev/docker-compose.yaml`,app 服务带 `profiles: [app]` — 默认不启动,要显式启用。

#### 准备环境变量

`dev/docker-compose.yaml` 直接读 `${VARIABLE}`,可以两种方式提供:

**方式 1:用 `dev/.env`**(推荐)

```powershell
New-Item -ItemType File dev\.env
```

写入:

```dotenv
ADMIN_TOKEN=your-strong-admin-token
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=claude_code_hub
APP_PORT=23000
APP_VERSION=dev
AUTO_MIGRATE=true
ENABLE_RATE_LIMIT=true
```

> Compose 会自动读取**与 compose 文件同目录**的 `.env`,所以放 `dev\.env`。

**方式 2:PowerShell 临时变量**

```powershell
$env:ADMIN_TOKEN="your-strong-admin-token"
$env:APP_PORT="23000"
```

#### 构建并启动

```powershell
docker compose -f dev\docker-compose.yaml --profile app up -d --build
```

首次构建会比较慢(bun install + next build)。再次启动可省 `--build`。

#### 看状态 / 日志

```powershell
docker compose -f dev\docker-compose.yaml ps
docker compose -f dev\docker-compose.yaml logs -f app
```

浏览器打开:**http://localhost:23000**。

#### 强制重建

改了代码后:

```powershell
docker compose -f dev\docker-compose.yaml --profile app up -d --build --force-recreate
```

无缓存重建(排查构建缓存问题):

```powershell
docker compose -f dev\docker-compose.yaml --profile app build --no-cache app
docker compose -f dev\docker-compose.yaml --profile app up -d --force-recreate
```

#### 清理悬空镜像

每次 `--build` 都会留下 dangling 镜像(老的同名 tag 被顶掉):

```powershell
docker image prune -f
```

---

## 3. 装了 WSL2 / Git Bash 想用 Makefile?

仓库 `Makefile` 把所有命令转发到 `dev/Makefile`。在 **WSL2 终端** 或 **Git Bash** 里:

```bash
make help          # 看所有命令
make db            # 仅起 PG + Redis(等价于方式 A 的 1.1)
make dev           # 起 db 后跑 bun run dev
make app           # 本地构建并启动 Docker app(等价于方式 B-2)
make app-rebuild   # 强制重建
make logs          # 看所有日志
make status        # 看容器状态
make clean         # 停容器,保留数据
make reset         # 停容器并删除数据(危险)
```

> WSL2 里跑 `make dev` 时,`bun` 也需要装在 WSL 里(在 WSL 终端再跑一次 `curl -fsSL https://bun.sh/install | bash`)。Docker Desktop 的 WSL2 Integration 会让 WSL 里直接能用 `docker` 命令。

> **注意**:WSL 里如果跑 `bun dev`,而 PG/Redis 在 Windows Docker Desktop 里,**WSL 访问 Windows 服务的地址不是 `127.0.0.1`**,而是 `host.docker.internal` 或者 Windows 主机 IP。最简单的解决:整套都在 WSL 里跑(包括 docker compose)。

---

## 4. 常见问题

### 4.1 浏览器登录不上 / Cookie 拿不到

`.env` 里 `ENABLE_SECURE_COOKIES=true` 时,浏览器**只接受 HTTPS**(localhost 例外但有些浏览器策略仍会拒)。本机 HTTP 开发**务必设为 `false`**。

### 4.2 `bun install` 报 native 模块错

Windows 上少数 native 模块编译有坑。优先在 WSL2 里跑 `bun install`,或者升级 Bun 到最新版。

### 4.3 端口 5432 / 6379 被本机占用

改 `docker-compose.dev.yaml` 里的端口映射:

```yaml
ports:
  - "127.0.0.1:35432:5432"   # 本机用 35432 转发到容器 5432
```

然后 `.env` 里 `DSN` 改成 `...@127.0.0.1:35432/...`。

### 4.4 `tsgo` 报错

`tsgo` 是 `@typescript/native-preview`,首次安装比较慢。若卡住:

```powershell
bun run typecheck    # 单独跑看错误
```

也可以临时跳过 dev 预飞:把 `package.json` 里 `dev` 脚本前面的 `tsgo -p tsconfig.json --noEmit &&` 去掉(仅本地临时用,**别提交**)。

### 4.5 改了 `schema.ts` 启动后表没更新

确认 `.env` 里 `AUTO_MIGRATE=true`,并且 `drizzle/` 目录下有对应迁移文件(用 `bun run db:generate` 生成)。

### 4.6 Docker Desktop 占资源 / 启动慢

Settings → Resources 调小 CPU/Memory;Engine 里启用 `experimental` + 用 BuildKit(默认开启)。

### 4.7 想从 Windows 浏览器访问 WSL 里跑的 dev server

WSL2 通常会自动转发,直接 http://localhost:13500 可访问。访问不到时,在 WSL 里跑:

```bash
ip addr show eth0 | grep inet
```

拿到 WSL IP,用 `http://<wsl-ip>:13500` 访问。

---

## 5. 一图速查

| 你想... | 走哪条 | 一行命令 |
|---------|--------|---------|
| 改代码,要热更新 | 方式 A | `docker compose -f docker-compose.dev.yaml up -d && bun run dev` |
| 不改代码,跑官方最新版 | 方式 B-1 | `docker compose up -d`(配好 `.env` 后) |
| 验证我的镜像能不能跑 | 方式 B-2 | `docker compose -f dev\docker-compose.yaml --profile app up -d --build` |
| 用 WSL,享受 make 一键 | — | `make dev` / `make app` |

---

## 6. 参考

- 项目主 README:`README.md`(中文)/ `README.en.md`(英文)
- 开发工具链原始文档:`dev/README.md`
- 部署进阶:`docs/k8s-deployment.md`
- 环境变量全集:`.env.example`(逐项有中文注释)
- 数据库迁移工作流:`CLAUDE.md` → "Database Migration Workflow"
