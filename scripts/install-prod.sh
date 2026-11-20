#!/usr/bin/env bash
set -euo pipefail

# 一键从 GHCR 拉取镜像并启动生产环境。
#   curl -fsSL https://raw.githubusercontent.com/southyouth-team/worldweave/main/scripts/install-prod.sh | sudo bash -s -- world.example.com
#
# 可选环境变量：
#   INSTALL_DIR=/opt/worldweave
#   IMAGE_PREFIX=ghcr.io/southyouth-team
#   IMAGE_TAG=latest
#   GHCR_USER / GHCR_TOKEN（私有镜像时需要）
#   DOMAIN / PUBLIC_ORIGIN / ADMIN_USERNAME / ADMIN_PASSWORD / POSTGRES_PASSWORD

DOMAIN="${1:-${DOMAIN:-}}"
[[ -n "$DOMAIN" ]] || { echo "用法：install-prod.sh <域名>" >&2; exit 1; }
DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"

REPO="${REPO:-southyouth-team/worldweave}"
REF="${REF:-main}"
RAW="https://raw.githubusercontent.com/$REPO/$REF"
INSTALL_DIR="${INSTALL_DIR:-/opt/worldweave}"
OWNER="${REPO%%/*}"
IMAGE_PREFIX="${IMAGE_PREFIX:-ghcr.io/$OWNER}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://$DOMAIN}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN%/}"

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    printf '%s%s' "$(date +%s%N)" "$RANDOM" | sha256sum | cut -c1-48
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  if [[ "${INSTALL_DOCKER:-}" == "1" ]]; then
    curl -fsSL https://get.docker.com | sh
  else
    echo "未安装 Docker。先安装 Docker，或用 INSTALL_DOCKER=1 重跑。" >&2
    exit 1
  fi
fi
docker compose version >/dev/null 2>&1 || { echo "需要 Docker Compose v2" >&2; exit 1; }

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
echo "下载部署文件到 $INSTALL_DIR ..."
curl -fsSL "$RAW/docker-compose.prod.yml" -o docker-compose.prod.yml
curl -fsSL "$RAW/Caddyfile" -o Caddyfile

if [[ ! -f .env.production ]]; then
  umask 077
  cat > .env.production <<EOF
DOMAIN=$DOMAIN
PUBLIC_ORIGIN=$PUBLIC_ORIGIN
IMAGE_PREFIX=$IMAGE_PREFIX
IMAGE_TAG=$IMAGE_TAG
POSTGRES_USER=worldweave
POSTGRES_DB=worldweave
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-$(gen_secret)}
ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
ADMIN_DISPLAY_NAME="${ADMIN_DISPLAY_NAME:-管理员}"
ADMIN_PASSWORD=${ADMIN_PASSWORD:-$(gen_secret)}
DB_MIGRATIONS_RUN=true
IMAGE_API_KEY=${IMAGE_API_KEY:-}
IMAGE_API_BASE_URL=${IMAGE_API_BASE_URL:-}
IMAGE_MODEL=${IMAGE_MODEL:-}
VISION_API_KEY=${VISION_API_KEY:-}
VISION_API_BASE_URL=${VISION_API_BASE_URL:-}
EOF
  chmod 600 .env.production
fi

if [[ -n "${GHCR_TOKEN:-}" ]]; then
  [[ -n "${GHCR_USER:-}" ]] || { echo "使用 GHCR_TOKEN 时必须同时设置 GHCR_USER" >&2; exit 1; }
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
fi

echo "拉取镜像 ..."
docker compose --env-file .env.production -f docker-compose.prod.yml pull
echo "启动服务 ..."
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --remove-orphans

ADMIN_USER="$(grep '^ADMIN_USERNAME=' .env.production | cut -d= -f2-)"
ADMIN_PASS="$(grep '^ADMIN_PASSWORD=' .env.production | cut -d= -f2-)"
echo ""
echo "部署完成：$PUBLIC_ORIGIN"
echo "管理员账号：$ADMIN_USER"
echo "管理员初始密码：$ADMIN_PASS"
echo "查看状态：cd $INSTALL_DIR && docker compose --env-file .env.production -f docker-compose.prod.yml ps"
