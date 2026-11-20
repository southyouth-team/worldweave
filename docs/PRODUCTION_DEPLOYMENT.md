# 生产部署

这份文档对应 **方案 B：GitHub Actions + 云主机 Docker Compose + Caddy HTTPS**。

生产结构：

```text
浏览器
  │ HTTPS
  ▼
Caddy :443
  ├─ /api/*  → server:3001
  └─ /*      → web:80
                │
                ├─ PostgreSQL/PostGIS
                └─ /data/uploads
```

GitHub Actions 只负责构建镜像和触发部署；NestJS、Postgres 和上传文件都由云主机长期运行。

## 1. 服务器准备

建议：

- Ubuntu 24.04
- 2 核 CPU / 4GB 内存起步
- 40GB 以上磁盘
- 公网 IP
- 已安装 Docker Engine 和 Docker Compose 插件

安全组/防火墙只开放：

- `22/tcp`：SSH
- `80/tcp`：Caddy 证书申请和 HTTP 跳转
- `443/tcp` 和 `443/udp`：HTTPS / HTTP3

不要把 `3001`、`5432` 暴露到公网。

## 2. 域名

给域名添加 A 记录：

```text
worldweave.example.com → 服务器公网 IP
```

等 DNS 生效后再启动 Caddy，否则 Let's Encrypt 证书申请会失败。

## 3. 服务器初始化

```bash
sudo mkdir -p /opt/worldweave
sudo chown "$USER":"$USER" /opt/worldweave
git clone https://github.com/southyouth-team/worldweave.git /opt/worldweave
cd /opt/worldweave
./scripts/setup-prod-env.sh
```

脚本只询问域名，其余自动处理：

- `PUBLIC_ORIGIN` 由域名推导；
- GHCR 前缀从 `git remote` 推断；
- 数据库密码、管理员初始密码自动生成；
- 写入权限为 `600` 的 `.env.production`，并打印管理员初始密码。

需要自定义数据库名、管理员用户名、AI Key 等高级项时，可以先用环境变量覆盖，或直接编辑生成后的 `.env.production`：

```bash
DOMAIN=worldweave.example.com ADMIN_USERNAME=owner ./scripts/setup-prod-env.sh
```

也可以手动复制模板：

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

至少修改：

```dotenv
DOMAIN=worldweave.example.com
PUBLIC_ORIGIN=https://worldweave.example.com
POSTGRES_PASSWORD=强随机数据库密码
ADMIN_PASSWORD=强随机管理员密码
IMAGE_PREFIX=ghcr.io/southyouth-team
IMAGE_TAG=latest
```

如果只是 Git 拉代码，服务器的仓库目录就是 `DEPLOY_PATH`。生成的 `.env.production` 不会被提交，也不会被部署时的 `git reset --hard` 覆盖。

## 4. GHCR 镜像权限

GitHub Actions 会把镜像推到：

```text
ghcr.io/<owner>/worldweave-server
ghcr.io/<owner>/worldweave-web
```

两种方式二选一：

### 方式 A：公开包（最简单）

在 GitHub 仓库的 Packages 设置里，把两个镜像设为 public。

### 方式 B：服务器登录 GHCR

在服务器上执行一次：

```bash
echo "<GitHub PAT，至少 read:packages>" | docker login ghcr.io -u <GitHub 用户名> --password-stdin
```

如果 fork 了仓库，记得把 `.env.production` 里的 `IMAGE_PREFIX` 改成自己的 GHCR 前缀。

## 5. GitHub Actions Secrets

在 GitHub 仓库 → Settings → Secrets and variables → Actions 添加：

| Secret | 说明 |
| --- | --- |
| `DEPLOY_HOST` | 服务器 IP 或域名 |
| `DEPLOY_USER` | SSH 用户名 |
| `DEPLOY_PORT` | SSH 端口，可留空，默认 22 |
| `DEPLOY_PATH` | 服务器仓库路径，例如 `/opt/worldweave` |
| `DEPLOY_SSH_KEY` | 用于部署的 SSH 私钥 |

生成部署密钥：

```bash
ssh-keygen -t ed25519 -C "worldweave-deploy" -f ~/.ssh/worldweave_deploy
```

把 `worldweave_deploy.pub` 追加到服务器 `~/.ssh/authorized_keys`，把私钥内容填到 `DEPLOY_SSH_KEY`。

如果仓库是私有的，服务器执行 `git fetch` 还需要部署密钥或 GitHub 凭据；公开仓库不需要。

## 6. 首次部署

方式一：等 GitHub Actions 构建完成后，在服务器执行：

```bash
cd /opt/worldweave
docker compose --env-file .env.production -f docker-compose.prod.yml pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

方式二：直接在服务器构建（不依赖 GHCR）：

```bash
cd /opt/worldweave
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

首次启动会自动执行 database migration，并创建初始管理员。检查：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f server
```

打开：

```text
https://worldweave.example.com
```

首次登录后立即修改管理员密码。

## 7. 日常发布

推送到 `main` 后：

1. GitHub Actions 先跑前后端测试和构建；
2. 测试通过后构建 `server` / `web` 镜像；
3. 推送 `latest` 和 `<commit-sha>` 标签；
4. 通过 SSH 到服务器；
5. `git reset --hard origin/main` 更新 Compose、Caddyfile 和代码；
6. 按当前 commit SHA 拉取镜像并重启。

`.env.production` 是未跟踪文件，不会被 `git reset` 覆盖。

## 8. 回滚

在服务器 `.env.production` 中把 `IMAGE_TAG` 改成旧版本 SHA：

```dotenv
IMAGE_TAG=<旧 commit SHA>
```

然后：

```bash
cd /opt/worldweave
docker compose --env-file .env.production -f docker-compose.prod.yml pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

数据库迁移默认向前执行；如果新版本包含不可逆迁移，需要先备份数据库再升级。

## 9. 备份

一键备份数据库和上传目录：

```bash
cd /opt/worldweave
./scripts/backup-prod.sh
```

输出到 `backups/`：

- `db-<时间>.sql.gz`
- `uploads-<时间>.tar.gz`

脚本默认保留最近 14 天。建议加入 cron：

```cron
0 3 * * * cd /opt/worldweave && ./scripts/backup-prod.sh >> /var/log/worldweave-backup.log 2>&1
```

再把 `backups/` 同步到另一台机器或对象存储。不要把备份放在同一块磁盘上作为唯一副本。

手动备份数据库：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip > "backups/db-$(date +%F-%H%M).sql.gz"
```

## 10. 日志与排查

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f server
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f web
```

常见问题：

- **Caddy 申请证书失败**：检查 DNS 是否指向本机、80/443 是否开放。
- **前端 502**：检查 `web`、`server` 是否 healthy。
- **登录后接口 401**：确认 `PUBLIC_ORIGIN`、HTTPS 和 Cookie 域一致。
- **上传/发布 413**：Caddy 已设 30MB，Express 也放宽到 30MB；如果外层还有 CDN/反代，也要同步调大。
- **AI 生成超时**：确认云主机到 AI 服务的网络和超时设置。

## 11. 迁移策略

生产 Compose 默认：

```dotenv
DB_MIGRATIONS_RUN=true
```

适合单实例部署。多实例部署时建议：

1. 先把所有实例设为 `DB_MIGRATIONS_RUN=false`；
2. 发布前单独启动一个临时 server 容器执行迁移；
3. 确认迁移完成后再滚动启动新实例。

## 12. 之后可以补的运维项

- 反向代理层限流：登录、加入申请、AI 生成接口。
- 备份恢复演练。
- 监控：Uptime Kuma、健康检查告警。
- 日志轮转。
- 数据库连接池和容器内存限制。
- 多实例时把上传目录迁到 S3 兼容存储，避免本地卷成为单点。
