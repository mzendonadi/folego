-- Dono aprovou os preços sugeridos: liga os quatro guias sob medida (2026-10-04).
UPDATE app.products SET active = true WHERE code IN ('guide_financing', 'guide_housebills', 'guide_forgotten', 'guide_resume');
