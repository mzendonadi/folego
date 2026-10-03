#!/usr/bin/env bash
# Instala as rotinas automáticas no cron do usuário: backup diário (03:15 UTC) e teste de restauração semanal (domingo 04:00 UTC). Idempotente.
set -euo pipefail
ROOT="$HOME/folego/deploy"
command -v crontab >/dev/null || { echo "crontab não está instalado neste servidor (peça ao root: apt install cron)."; exit 1; }
mkdir -p "$HOME/backups" && chmod 700 "$HOME/backups"
TMP=$(mktemp)
crontab -l 2>/dev/null | grep -v 'folego-ops' > "$TMP" || true
{
  echo "15 3 * * * bash $ROOT/ops/backup.sh >> $HOME/backups/backup.log 2>&1 # folego-ops"
  echo "0 4 * * 0 bash $ROOT/ops/restore-test.sh >> $HOME/backups/restore.log 2>&1 # folego-ops"
} >> "$TMP"
crontab "$TMP" && rm -f "$TMP"
echo "Rotinas instaladas:"
crontab -l | grep folego-ops
