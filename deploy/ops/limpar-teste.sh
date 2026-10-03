#!/usr/bin/env bash
# Faz um backup, depois apaga os dados de teste (limpar-teste.sql). Só roda com a palavra LIMPAR como argumento.
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${1:-}" = "LIMPAR" ] || { echo "Informe LIMPAR para confirmar."; exit 1; }
bash ops/backup.sh
sudo docker compose exec -T postgres psql -U app_owner -d app -v ON_ERROR_STOP=1 -q < ops/limpar-teste.sql
echo "Limpeza concluída. O backup anterior está em ~/backups."
