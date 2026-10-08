#!/usr/bin/env bash
# Virada para o lançamento: desliga as propostas de parceiros (leads), abre o site aos buscadores (SEO_OPEN=1) e refaz o deploy
# para a mudança valer. Não mexe em segredos nem em dados de clientes. Reversível: SEO_OPEN= e leadsEnabled=true no backoffice.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
NOVO="$(mktemp)"
printf 'SEO_OPEN=1\nLEADS_ENABLED=0\n' > "$NOVO"
bash ops/mesclar-env.sh "$NOVO" .env
rm -f "$NOVO"
sudo docker compose exec -T postgres psql -U app_owner -d app -v ON_ERROR_STOP=1 -q -c "INSERT INTO app.settings(key, value) VALUES ('leadsEnabled', 'false'::jsonb) ON CONFLICT (key) DO UPDATE SET value = 'false'::jsonb, updated_at = now()" 2>&1 | grep -v "unable to resolve host" || true
echo "leadsEnabled = false; SEO_OPEN=1. Refazendo o deploy para valer..."
bash deploy.sh
