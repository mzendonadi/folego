-- Entrada com e-mail e senha para as contas de teste (so vale com a conta LIGADA). O hash abaixo e da senha inicial;
-- o dono gera outra no backoffice (Contas de teste > Nova senha) quando quiser.
ALTER TABLE app.demo_accounts ADD COLUMN IF NOT EXISTS password_hash text;
UPDATE app.demo_accounts SET password_hash = 'scrypt$ktjK9Uu2wwSpAi9do2J89A==$Zmrmq39GsIZtsd3ooJHwZh97UdfHE7EGfjV4RY8yJ6k=' WHERE email = 'demo@folego.online' AND password_hash IS NULL;
