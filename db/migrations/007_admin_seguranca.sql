-- Backoffice: senha forte (scrypt) + código por e-mail (duas etapas), bloqueio por tentativas e redefinição só pelo dono.
ALTER TABLE app.admin_users ADD COLUMN password_hash       text;
ALTER TABLE app.admin_users ADD COLUMN password_set_at     timestamptz;
ALTER TABLE app.admin_users ADD COLUMN setup_allowed_until timestamptz;  -- janela para redefinir a senha depois que o dono libera
ALTER TABLE app.admin_users ADD COLUMN failed_attempts     integer NOT NULL DEFAULT 0;
ALTER TABLE app.admin_users ADD COLUMN locked_until        timestamptz;
