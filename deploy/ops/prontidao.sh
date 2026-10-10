#!/usr/bin/env bash
# Relatório de prontidão para o lançamento. SÓ LEITURA, sem segredos (só mostra se a variável existe) e sem dados pessoais.
cd "$(dirname "$0")/.." || exit 1
q() { sudo docker compose exec -T postgres psql -U app_owner -d app -P pager=off -t -A -F ' | ' -c "$1" 2>&1 | grep -v "unable to resolve host"; }
tem() { grep -Eq "^$1=.+" .env && echo "ok" || echo "AUSENTE"; }
val() { grep -E "^$1=" .env | head -n1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'$//"; }

echo "== chaves obrigatórias (ok/AUSENTE)"
for v in ASAAS_API_KEY ASAAS_PIX_KEY ASAAS_WEBHOOK_TOKEN TURNSTILE_SITE_KEY TURNSTILE_SECRET RESEND_API_KEY META_CAPI_TOKEN ANTHROPIC_API_KEY APP_SECRET POSTGRES_PASSWORD ADMIN_EMAILS; do echo "$v: $(tem $v)"; done
echo "== configuração (valores não secretos)"
for v in PAYMENT_PROVIDER ASAAS_BASE_URL SEO_OPEN LEADS_ENABLED SUBSCRIPTIONS_ENABLED ALLOW_FAKE_GATEWAY_IN_PRODUCTION REQUIRE_PRODUCTION_KEYS PUBLIC_URL EMAIL_FROM META_PIXEL_ID META_CAPI_PAGEVIEW AI_MAX_CALLS_PER_DAY; do echo "$v=$(val $v)"; done
echo "META_TEST_EVENT_CODE: $(tem META_TEST_EVENT_CODE) (no lançamento deve estar AUSENTE)"
echo "== Open Finance (opcional; só liga com as duas chaves do agregador)"
echo "PLUGGY_CLIENT_ID: $(tem PLUGGY_CLIENT_ID) | PLUGGY_CLIENT_SECRET: $(tem PLUGGY_CLIENT_SECRET) | OPENFINANCE_WEBHOOK_SECRET: $(tem OPENFINANCE_WEBHOOK_SECRET)"
sudo docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/features').then(r=>r.json()).then(j=>console.log('openFinance ligado no servidor:', j.openFinance))" 2>&1 | grep -v "unable to resolve host"
q "SELECT 'conexões ' || count(*) FILTER (WHERE status = 'active') || ' ativas, ' || count(*) FILTER (WHERE status = 'needs_action') || ' pedindo reconexão' FROM app.of_connections" 2>/dev/null
echo "== indexação"
cat nginx/seo.conf 2>/dev/null | head -3 || echo "sem seo.conf"
echo "== saúde"
sudo docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)" 2>&1 | grep -v "unable to resolve host"
echo "== migrações aplicadas (última)"
q "SELECT count(*) || ' aplicadas; última: ' || max(name) FROM app.schema_migrations"
echo "== produtos (código | preço R\$ | ativo)"
q "SELECT code || ' | ' || to_char(price_cents / 100.0, 'FM9990.00') || ' | ' || active FROM app.products ORDER BY code"
echo "== contas de teste (demo) ligadas (deve ser 0 no lançamento)"
q "SELECT count(*) FROM app.demo_accounts WHERE active"
echo "== configuração do site (settings)"
q "SELECT key || ' = ' || left(value::text, 80) FROM app.settings WHERE key NOT IN ('worker_heartbeat') ORDER BY key"
echo "== cadastros preservados"
q "SELECT 'admin_users ' || count(*) FROM app.admin_users UNION ALL SELECT 'legal_documents ' || count(*) FROM app.legal_documents UNION ALL SELECT 'partners ' || count(*) FROM app.partners UNION ALL SELECT 'ebooks ' || count(*) FROM app.ebooks"
echo "== dados de clientes (deve ser 0 no lançamento)"
q "SELECT 'subscribers ' || count(*) FROM app.subscribers UNION ALL SELECT 'cases ' || count(*) FROM app.cases UNION ALL SELECT 'orders ' || count(*) FROM app.orders UNION ALL SELECT 'payments ' || count(*) FROM app.payments UNION ALL SELECT 'sessions ' || count(*) FROM app.sessions UNION ALL SELECT 'events ' || count(*) FROM app.events"
echo "== rotinas (cron) e backup"
crontab -l 2>/dev/null | grep folego-ops || echo "rotinas NÃO instaladas"
ls -lht "$HOME"/backups/folego-*.sql.gz 2>/dev/null | head -2
echo "== webhooks recentes (pagamentos)"
q "SELECT to_char(received_at, 'MM-DD HH24:MI') || ' | ' || provider || ' | ' || coalesce(payload->>'event', '?') FROM app.payment_events ORDER BY received_at DESC LIMIT 3"
