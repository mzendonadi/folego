-- Primeiro parceiro do portal de gestão: Euro Multiplan (dados públicos do cartão CNPJ, emitido em 23/09/2024).
-- Ele nasce ATIVO, com uma campanha de consignado só de portal (sem webhook): os contatos que o Fôlego enviar aparecem na tela dele.
-- A senha NÃO é criada aqui: no backoffice, Parcerias > Editar > "Gerar nova senha do portal" (aparece uma vez só).
-- Valor por contato e comissão em % começam em zero: o dono define no backoffice antes de enviar o primeiro contato.
INSERT INTO app.partners(legal_name, cnpj, category, status, trade_name, contact_email, phone, city, uf, address)
VALUES ('JULHANA DOS SANTOS - COBRANCAS', '09242004000150', 'consignado', 'active', 'EURO MULTIPLAN INTERMEDIACOES', 'julhanaeuroemprestimos@hotmail.com',
        '(41) 9242-5338 / (41) 9568-0631', 'Curitiba', 'PR', 'R Presidente Faria, 51, conj 904, Cond Farid Surugi, Centro, CEP 80.020-290')
ON CONFLICT (cnpj) DO NOTHING;

INSERT INTO app.partner_users(partner_id, email, password_hash, role)
SELECT id, 'julhanaeuroemprestimos@hotmail.com', 'sem-senha-gerar-no-backoffice', 'admin' FROM app.partners WHERE cnpj = '09242004000150'
ON CONFLICT (email) DO NOTHING;

INSERT INTO app.partner_campaigns(partner_id, name, status, consent_category, price_per_lead_cents, commission_bps, daily_cap)
SELECT p.id, 'Consignado: Euro Multiplan & Fôlego', 'active', 'consignado', 0, 0, 50
  FROM app.partners p
 WHERE p.cnpj = '09242004000150' AND NOT EXISTS (SELECT 1 FROM app.partner_campaigns c WHERE c.partner_id = p.id);

-- O dono pediu para ligar as propostas de parceiros (podem ser desligadas de novo em Configurações).
INSERT INTO app.settings(key, value) VALUES ('leadsEnabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb, updated_at = now();
