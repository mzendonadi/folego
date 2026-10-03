#!/usr/bin/env bash
# Backup do banco do Fôlego: pg_dump comprimido em ~/backups, mantém os 14 mais recentes e registra o horário no banco
# (o monitor avisa se passar de 36 h sem backup). Uso: bash deploy/ops/backup.sh   (cron diário: install-cron.sh)
set -euo pipefail
cd "$(dirname "$0")/.." # deploy/
D="sudo docker"
DEST="$HOME/backups"
mkdir -p "$DEST" && chmod 700 "$DEST"
F="$DEST/folego-$(date -u +%Y%m%d-%H%M%S).sql.gz"
$D compose exec -T postgres pg_dump -U app_owner -d app --no-owner | gzip -9 > "$F.tmp"
gzip -t "$F.tmp"
SIZE=$(stat -c %s "$F.tmp")
[ "$SIZE" -gt 2000 ] || { echo "Backup suspeito (só $SIZE bytes)"; rm -f "$F.tmp"; exit 1; }
mv "$F.tmp" "$F" && chmod 600 "$F"
$D compose exec -T postgres psql -U app_owner -d app -v ON_ERROR_STOP=1 -q -c \
  "INSERT INTO app.settings(key, value) VALUES ('last_backup', jsonb_build_object('at', now(), 'bytes', $SIZE, 'file', '$(basename "$F")')) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()" >/dev/null
# guarda só os 14 mais novos
ls -1t "$DEST"/folego-*.sql.gz | tail -n +15 | xargs -r rm -f
echo "Backup ok: $F ($SIZE bytes)"
