-- Cancelamento só vale quando o provedor (Asaas) confirma que parou de cobrar.
-- Incidente de 06/11/2026: assinaturas criadas na conta PF antiga do Asaas continuaram cobrando depois do cancelamento pedido no Prumo,
-- porque o servidor (já na conta PJ) recebia 404 do provedor e tratava como "já cancelada". Agora:
--   cancel_verified: true = o provedor confirmou (assinatura encerrada e cobranças em aberto apagadas);
--                    false = não conseguimos confirmar (ex.: a assinatura é de outra conta): o dono é avisado e a varredura segue tentando;
--                    NULL  = não é cancelada ou ainda não passou pela verificação.
--   cancel_alerted_at: quando o último alerta de "cancelamento não confirmado" foi enviado (para não repetir o aviso toda hora).
ALTER TABLE app.billing_profiles ADD COLUMN IF NOT EXISTS cancel_verified boolean;
ALTER TABLE app.billing_profiles ADD COLUMN IF NOT EXISTS cancel_alerted_at timestamptz;

-- O que já está cancelado hoje nunca foi conferido no provedor: fica "não confirmado" e o dono já foi avisado (a varredura reavalia).
UPDATE app.billing_profiles SET cancel_verified = false, cancel_alerted_at = now() WHERE status = 'canceled' AND cancel_verified IS NULL;
