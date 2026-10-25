-- Item 2: avisos inteligentes por notificação (assinatura que subiu, cobrança repetida, limite de categoria, resumo semanal).
-- push_sent guarda o que já foi avisado para não repetir (uma linha por assunto: ex. "preco:NETFLIX:2026-10-12", "resumo:2026-W43").
CREATE TABLE app.push_sent (
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  key           text NOT NULL,
  sent_on       date NOT NULL DEFAULT current_date,
  PRIMARY KEY (subscriber_id, key)
);
CREATE INDEX push_sent_day_idx ON app.push_sent (sent_on);

ALTER TABLE app.subscribers
  ADD COLUMN push_alerts  boolean NOT NULL DEFAULT true,   -- assinatura que subiu, cobrança repetida, limite de categoria
  ADD COLUMN push_summary boolean NOT NULL DEFAULT true;   -- resumo da semana (segunda de manhã)

-- O controle "já avisei esta conta a vencer" passa a ser por pessoa (push_sent): com conta compartilhada, titular e membro avisam cada um o seu.
-- A coluna criada na 053 nunca chegou a ser usada em produção (as notificações só ligam com a chave VAPID).
ALTER TABLE app.reminders DROP COLUMN push_notified_for;

-- Item 6: conta compartilhada com mais de uma pessoa e com nível de acesso.
-- Antes: um titular, um membro (owner_id UNIQUE). Agora: vários, até o limite do plano (checado no servidor).
ALTER TABLE app.household_members DROP CONSTRAINT household_members_owner_id_key;
ALTER TABLE app.household_members ADD COLUMN role text NOT NULL DEFAULT 'edita' CHECK (role IN ('edita', 'consulta'));
CREATE INDEX household_members_owner_idx ON app.household_members (owner_id);
