-- Metas com histórico: cada aporte é um registro (vale desfazer), e a meta guarda quando foi concluída.
-- O total guardado = goals.saved_cents (valor inicial informado ao criar) + soma dos aportes.
CREATE TABLE app.goal_contributions (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  goal_id       uuid   NOT NULL REFERENCES app.goals(id) ON DELETE CASCADE,
  subscriber_id uuid   NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  occurred_on   date   NOT NULL,
  note          text   NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goal_contributions_goal_idx ON app.goal_contributions (goal_id, occurred_on DESC);

ALTER TABLE app.goals ADD COLUMN completed_at timestamptz;
-- Metas que já estavam completas antes desta migração passam a constar como concluídas.
UPDATE app.goals SET completed_at = created_at WHERE saved_cents >= target_cents;
