#!/usr/bin/env bash
set -euo pipefail

# 备份生产数据库和上传目录。
#   ./scripts/backup-prod.sh
# 可用环境变量覆盖：
#   ENV_FILE=.env.production BACKUP_DIR=/srv/backups ./scripts/backup-prod.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.production}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/docker-compose.prod.yml")
STAMP="$(date +%F-%H%M%S)"

[[ -f "$ENV_FILE" ]] || { echo "找不到 $ENV_FILE" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"

echo "备份数据库..."
"${COMPOSE[@]}" exec -T db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "备份上传目录..."
docker run --rm \
  -v worldweave_worldweave-uploads:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf "/backup/uploads-$STAMP.tar.gz" -C /data .

# 保留最近 14 天，按需调整。
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.sql.gz' -o -name 'uploads-*.tar.gz' \) -mtime +14 -delete

echo "完成："
ls -lh "$BACKUP_DIR/db-$STAMP.sql.gz" "$BACKUP_DIR/uploads-$STAMP.tar.gz"
