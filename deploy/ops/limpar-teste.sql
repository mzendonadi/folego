-- Apaga TODOS os dados de teste/clientes e preserva a configuração. Roda numa transação e se desfaz sozinha se algo que deveria ficar mudar.
-- Preservado: admin_users, settings, legal_documents, market_indicators, products, ebooks, partners, email_campaigns.
BEGIN;
CREATE TEMP TABLE _antes AS
  SELECT 'admin_users' AS t, count(*) AS n FROM app.admin_users
  UNION ALL SELECT 'settings', count(*) FROM app.settings
  UNION ALL SELECT 'legal_documents', count(*) FROM app.legal_documents
  UNION ALL SELECT 'products', count(*) FROM app.products
  UNION ALL SELECT 'ebooks', count(*) FROM app.ebooks
  UNION ALL SELECT 'market_indicators', count(*) FROM app.market_indicators
  UNION ALL SELECT 'partners', count(*) FROM app.partners
  UNION ALL SELECT 'email_campaigns', count(*) FROM app.email_campaigns;

-- Primeiro os dados que dependem de sessão (casos, pedidos...); depois as sessões de visitantes. A sessão do dono do backoffice fica.
-- (Na ordem inversa o banco recusa: os casos ainda apontam para as sessões. Corrigido em 2026-10-08, ao rodar com dados reais.)
TRUNCATE app.subscribers, app.orders, app.cases, app.funnel_events, app.events, app.lead_contacts, app.email_sends,
         app.login_codes, app.payment_events, app.payments, app.access_tokens, app.consents CASCADE;
DELETE FROM app.sessions WHERE admin_user_id IS NULL;

TRUNCATE app.referral_optout; -- pedidos de descadastro de teste (e-mails de quem não quer convite)

-- Contas de teste (demo) ficam DESLIGADAS: ligada, a conta libera produtos sem cobrança. O dono liga de novo no backoffice só para testar.
UPDATE app.demo_accounts SET active = false;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT a.t, a.n AS antes,
      CASE a.t
        WHEN 'admin_users' THEN (SELECT count(*) FROM app.admin_users)
        WHEN 'settings' THEN (SELECT count(*) FROM app.settings)
        WHEN 'legal_documents' THEN (SELECT count(*) FROM app.legal_documents)
        WHEN 'products' THEN (SELECT count(*) FROM app.products)
        WHEN 'ebooks' THEN (SELECT count(*) FROM app.ebooks)
        WHEN 'market_indicators' THEN (SELECT count(*) FROM app.market_indicators)
        WHEN 'partners' THEN (SELECT count(*) FROM app.partners)
        WHEN 'email_campaigns' THEN (SELECT count(*) FROM app.email_campaigns)
      END AS depois
    FROM _antes a
  LOOP
    IF r.depois <> r.antes THEN
      RAISE EXCEPTION 'A limpeza mexeria em %: % -> % (desfeita)', r.t, r.antes, r.depois;
    END IF;
  END LOOP;
END $$;
COMMIT;

SELECT 'subscribers' AS tabela, count(*) FROM app.subscribers
UNION ALL SELECT 'orders', count(*) FROM app.orders
UNION ALL SELECT 'cases', count(*) FROM app.cases
UNION ALL SELECT 'admin_users (preservado)', count(*) FROM app.admin_users;
