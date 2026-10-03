#!/usr/bin/env bash
# Situação do servidor para quem opera: containers, disco, backups, rotinas e saúde.
cd "$(dirname "$0")/.." || exit 1
echo "== containers"
sudo docker compose ps --format 'table {{.Name}}\t{{.Status}}' 2>&1 | grep -v "unable to resolve host"
echo "== disco"
df -h / | tail -n1
echo "== backups"
ls -lht "$HOME"/backups/folego-*.sql.gz 2>/dev/null | head -5 || echo "nenhum"
echo "== rotinas (cron)"
crontab -l 2>/dev/null | grep folego-ops || echo "NÃO instaladas (rode a ação instalar_rotinas)"
echo "== registros no banco"
sudo docker compose exec -T postgres psql -U app_owner -d app -t -A -c "SELECT key || ' = ' || value::text FROM app.settings WHERE key IN ('last_backup','last_restore_test','worker_heartbeat')" 2>&1 | grep -v "unable to resolve host"
echo "== saúde profunda"
sudo docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/health/deep').then(r=>r.text()).then(console.log)" 2>&1 | grep -v "unable to resolve host"
