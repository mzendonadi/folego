-- Banner do parceiro no Mapa da Virada (topo e fim). Cada campanha pode ter o seu: título, texto curto, imagem opcional e link (sempre https).
-- É publicidade: a tela mostra "Publicidade" e abre o link em outra aba, sem repassar dado nenhum da pessoa. O repasse do contato continua
-- sendo só pelo consentimento separado (app.consents, finalidade lead_sharing).
ALTER TABLE app.partner_campaigns
  ADD COLUMN IF NOT EXISTS banner_on        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banner_title     text CHECK (banner_title IS NULL OR char_length(banner_title) BETWEEN 1 AND 80),
  ADD COLUMN IF NOT EXISTS banner_text      text CHECK (banner_text IS NULL OR char_length(banner_text) BETWEEN 1 AND 200),
  ADD COLUMN IF NOT EXISTS banner_cta       text CHECK (banner_cta IS NULL OR char_length(banner_cta) BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS banner_url       text CHECK (banner_url IS NULL OR (banner_url ~ '^https://[^\s]+$' AND char_length(banner_url) <= 500)),
  ADD COLUMN IF NOT EXISTS banner_image_url text CHECK (banner_image_url IS NULL OR (banner_image_url ~ '^https://[^\s]+$' AND char_length(banner_image_url) <= 500));
