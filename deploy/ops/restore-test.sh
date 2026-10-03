#!/usr/bin/env bash
# Prova que o backup SERVE: restaura o dump mais recente num banco temporário, compara contagens com o banco real e apaga o temporário.
# Nunca toca no banco de produção. Registra o resultado em app.settings (last_restore_test).
set -euo pipefail
cd "$(dirname "$0")/.."
D="sudo docker"
P="$D compose exec -T postgres psql -U app_owner -v ON_ERROR_STOP=1 -q -t -A"
LAST=$(ls -1t "$HOME"/backups/folego-*.sql.gz 2>/dev/null | head -n1 || true)
[ -n "$LAST" ] || { echo "Nenhum backup encontrado em ~/backups"; exit 1; }
echo "Restaurando $LAST num banco temporário..."
$P -d postgres -c "DROP DATABASE IF EXISTS restore_test" -c "CREATE DATABASE restore_test"
trap '$P -d postgres -c "DROP DATABASE IF EXISTS restore_test" >/dev/null 2>&1 || true' EXIT
gunzip -c "$LAST" | $D compose exec -T postgres psql -U app_owner -d restore_test -v ON_ERROR_STOP=1 -q >/dev/null
OK=1
for T in subscribers orders cases deliverables admin_users settings; do
  A=$($P -d app -c "SELECT count(*) FROM app.$T")
  B=$($P -d restore_test -c "SELECT count(*) FROM app.$T")
  # o banco real pode ter recebido linhas depois do backup: a cópia nunca pode ter MAIS que o real
  if [ "$B" -gt "$A" ]; then OK=0; fi
  printf '  %-14s real=%-6s restaurado=%s\n' "$T" "$A" "$B"
done
[ "$OK" = 1 ] || { echo "FALHOU: contagens inconsistentes"; exit 1; }
$P -d app -c "INSERT INTO app.settings(key, value) VALUES ('last_restore_test', jsonb_build_object('at', now(), 'file', '$(basename "$LAST")')) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()" >/dev/null
echo "Restauração testada com sucesso."
