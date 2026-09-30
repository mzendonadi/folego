-- Tradutor de Cobrança (R$ 12,90): produto avulso com caso próprio (inputs.kind = 'translator').
INSERT INTO app.products(code, name, price_cents, kind, access_days)
VALUES ('collection_translator', 'Tradutor de Cobrança', 1290, 'one_off', 30)
ON CONFLICT (code) DO NOTHING;
