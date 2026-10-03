-- Valor contratado da assinatura: o preço de tabela da época da assinatura (mudar o preço do plano vale só para novas assinaturas).
ALTER TABLE app.billing_profiles ADD COLUMN contract_cents bigint;
UPDATE app.billing_profiles b SET contract_cents = coalesce((SELECT max(unit_price_cents) FROM app.order_items oi JOIN app.orders o ON o.id = oi.order_id WHERE o.subscriber_id = b.subscriber_id), b.synced_value_cents);
