#!/usr/bin/env bash
# Últimos pedidos e pagamentos, só leitura e sem dados pessoais (nada de nome, e-mail, telefone ou CPF).
# Serve para conferir de ponta a ponta: pedido criado, Pix pago, aviso do provedor processado.
cd "$(dirname "$0")/.." || exit 1
q() { sudo docker compose exec -T postgres psql -U app_owner -d app -P pager=off -c "$1" 2>&1 | grep -v "unable to resolve host"; }
echo "== últimos 12 pedidos (horário UTC)"
q "SELECT to_char(o.created_at, 'MM-DD HH24:MI') AS criado, left(o.id::text, 8) AS pedido, o.status AS pedido_st, coalesce(p.provider, '-') AS provedor, coalesce(p.status, '-') AS pagto_st, to_char(p.amount_cents / 100.0, 'FM999990.00') AS valor_pago, (SELECT string_agg(i.product_code, ',') FROM app.order_items i WHERE i.order_id = o.id) AS itens, to_char(o.paid_at, 'MM-DD HH24:MI') AS pago_em FROM app.orders o LEFT JOIN app.payments p ON p.order_id = o.id ORDER BY o.created_at DESC LIMIT 12"
echo "== avisos do provedor (webhooks) recentes"
q "SELECT to_char(received_at, 'MM-DD HH24:MI:SS') AS recebido, provider, payload->>'event' AS evento, CASE WHEN processed_at IS NULL THEN 'pendente' ELSE 'processado' END AS situacao FROM app.payment_events ORDER BY received_at DESC LIMIT 10"
