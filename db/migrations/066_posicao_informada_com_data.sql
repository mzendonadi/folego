-- A "posição informada" (o valor que o app da corretora mostra) ficava congelada: valia mais que a estimativa para sempre,
-- não andava com o tempo e ignorava a data da aplicação. Agora ela é um marco com data: vale na data em que foi informada
-- e, dali em diante, o Prumo continua atualizando pelo índice (CDI, prefixado...) até hoje.
ALTER TABLE app.investments ADD COLUMN IF NOT EXISTS position_on date;

-- Quem já tinha posição informada: o marco é o dia da última edição (é quando a pessoa digitou o valor).
UPDATE app.investments
   SET position_on = (updated_at AT TIME ZONE 'America/Sao_Paulo')::date
 WHERE position_cents IS NOT NULL AND position_on IS NULL;
