-- Categorias próprias do assinante (além das 10 do sistema). O lançamento guarda o nome; apagar a categoria devolve os lançamentos a "Outros".
CREATE TABLE IF NOT EXISTS app.custom_categories (
  subscriber_id uuid NOT NULL REFERENCES app.subscribers(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 30),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS custom_categories_lower_idx ON app.custom_categories (subscriber_id, lower(name));
