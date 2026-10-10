-- Mapa da Virada para assinantes: o prazo de acesso pode ser diferente do padrão do produto (Ousado: 90 dias; Desbravador: até o fim do período da assinatura).
-- O item do pedido guarda o prazo combinado; sem valor, vale o do produto como sempre foi.
ALTER TABLE app.order_items ADD COLUMN access_days integer CHECK (access_days IS NULL OR access_days BETWEEN 1 AND 1100);

-- O Mapa comprado por quem assina fica ligado à conta (e não só ao navegador): dá para abrir de outro aparelho e o "apagar minha conta" leva o Mapa junto.
ALTER TABLE app.cases ADD COLUMN owner_subscriber_id uuid REFERENCES app.subscribers(id) ON DELETE SET NULL;
CREATE INDEX cases_owner_subscriber_idx ON app.cases (owner_subscriber_id) WHERE owner_subscriber_id IS NOT NULL;
