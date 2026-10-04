-- Cheque especial (LIS) na carteira de conta bancária: limite contratado, taxa ao mês e saldo de partida.
-- O uso do limite é calculado: quando o saldo da carteira fica negativo, o que passa de zero é o limite em uso.
ALTER TABLE app.wallets ADD COLUMN opening_balance_cents bigint NOT NULL DEFAULT 0 CHECK (opening_balance_cents BETWEEN -10000000000 AND 10000000000);
ALTER TABLE app.wallets ADD COLUMN overdraft_limit_cents bigint NOT NULL DEFAULT 0 CHECK (overdraft_limit_cents BETWEEN 0 AND 10000000000);
ALTER TABLE app.wallets ADD COLUMN overdraft_rate_bps integer NOT NULL DEFAULT 800 CHECK (overdraft_rate_bps BETWEEN 0 AND 2000);
