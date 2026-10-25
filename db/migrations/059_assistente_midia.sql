-- Assistente do Prumo no WhatsApp com foto, áudio e anexo (PDF da fatura).
-- O que foi lido e espera uma resposta ("despesas mercado", "lançar") fica guardado por pouco tempo no vínculo.
ALTER TABLE app.assistant_links
  ADD COLUMN pending    jsonb,
  ADD COLUMN pending_at timestamptz;

-- Limite diário de leituras por pessoa (a leitura de foto, PDF e voz custa por uso): só conta, sem guardar o conteúdo.
CREATE TABLE app.assistant_media_log (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('image', 'document', 'audio')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_media_log_idx ON app.assistant_media_log (subscriber_id, created_at);
