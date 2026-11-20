#!/usr/bin/env bash
set -euo pipefail

# 生产环境变量初始化：只问域名，其余自动生成或推断。
#   ./scripts/setup-prod-env.sh
# 高级配置可用环境变量覆盖，例如：
#   DOMAIN=world.example.com ADMIN_USERNAME=owner ./scripts/setup-prod-env.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.production"

say() { printf '%s\n' "$*"; }
fail() { printf '错误：%s\n' "$*" >&2; exit 1; }

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    printf '%s%s' "$(date +%s%N)" "$RANDOM" | sha256sum | cut -c1-48
  fi
}

validate_domain() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fail "域名格式无效：$1"
}

if [[ -f "$ENV_FILE" && "${FORCE:-}" != "1" ]]; then
  read -r -p ".env.production 已存在，覆盖？[y/N]: " overwrite
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    say "已取消"
    exit 0
  fi
fi

DOMAIN="${DOMAIN:-}"
if [[ -z "$DOMAIN" ]]; then
  read -r -p "域名（例如 worldweave.example.com）: " DOMAIN
fi
DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
validate_domain "$DOMAIN"

PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://$DOMAIN}"
PUBLIC_ORIGIN="${PUBLIC_ORIGIN%/}"

IMAGE_PREFIX="${IMAGE_PREFIX:-}"
if [[ -z "$IMAGE_PREFIX" ]]; then
  IMAGE_PREFIX="ghcr.io/southyouth-team"
  REMOTE_URL="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
  if [[ "$REMOTE_URL" =~ github.com[:/]([^/]+)/ ]]; then
    IMAGE_PREFIX="ghcr.io/$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]')"
  fi
fi
IMAGE_PREFIX="$(printf '%s' "$IMAGE_PREFIX" | tr '[:upper:]' '[:lower:]')"
IMAGE_PREFIX="${IMAGE_PREFIX%/}"

POSTGRES_USER="${POSTGRES_USER:-worldweave}"
POSTGRES_DB="${POSTGRES_DB:-worldweave}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(gen_secret)}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_DISPLAY_NAME="${ADMIN_DISPLAY_NAME:-管理员}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(gen_secret)}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
DB_MIGRATIONS_RUN="${DB_MIGRATIONS_RUN:-true}"

umask 077
cat > "$ENV_FILE" <<EOF
# 由 scripts/setup-prod-env.sh 生成，请勿提交。
DOMAIN=$DOMAIN
PUBLIC_ORIGIN=$PUBLIC_ORIGIN
IMAGE_PREFIX=$IMAGE_PREFIX
IMAGE_TAG=$IMAGE_TAG
POSTGRES_USER=$POSTGRES_USER
POSTGRES_DB=$POSTGRES_DB
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_DISPLAY_NAME="$ADMIN_DISPLAY_NAME"
ADMIN_PASSWORD=$ADMIN_PASSWORD
DB_MIGRATIONS_RUN=$DB_MIGRATIONS_RUN
IMAGE_API_KEY=${IMAGE_API_KEY:-}
IMAGE_API_BASE_URL=${IMAGE_API_BASE_URL:-}
IMAGE_MODEL=${IMAGE_MODEL:-}
VISION_API_KEY=${VISION_API_KEY:-}
VISION_API_BASE_URL=${VISION_API_BASE_URL:-}
EOF
chmod 600 "$ENV_FILE"

say ""
say "已生成 $ENV_FILE"
say "站点：$PUBLIC_ORIGIN"
say "管理员账号：$ADMIN_USERNAME"
say "管理员初始密码：$ADMIN_PASSWORD"
say ""
say "下一步："
say "  docker compose --env-file .env.production -f docker-compose.prod.yml pull"
say "  docker compose --env-file .env.production -f docker-compose.prod.yml up -d"
