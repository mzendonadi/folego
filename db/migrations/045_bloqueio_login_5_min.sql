-- O bloqueio por senha errada passou de 15 para 5 minutos: quem ainda está preso por mais de 5 minutos é liberado agora.
UPDATE app.admin_users SET failed_attempts = 0, locked_until = NULL WHERE locked_until IS NOT NULL AND locked_until > now() + interval '5 minutes';
