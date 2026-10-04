-- Guias pagos sob medida (fases futuras). Nascem DESLIGADOS: o dono liga cada um em "Produtos e preços" quando decidir o preço
-- e a comunicação. Preços sugeridos do roteiro (§4.6): renegociador R$ 15, dinheiro esquecido R$ 15, currículo R$ 19, comparador R$ 19.
INSERT INTO app.products (code, name, price_cents, access_days, active) VALUES
  ('guide_financing',  'Comparador honesto de financiamento', 1900, 30, false),
  ('guide_housebills', 'Renegociador de contas de casa',      1500, 30, false),
  ('guide_forgotten',  'Guia do dinheiro esquecido',          1500, 30, false),
  ('guide_resume',     'Currículo por vaga',                  1900, 30, false)
ON CONFLICT (code) DO NOTHING;
