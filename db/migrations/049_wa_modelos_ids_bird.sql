-- Modelos aprovados na Bird (plataforma clássica) são chamados pelo ID do projeto e da versão publicada, não pelo nome.
ALTER TABLE app.wa_templates ADD COLUMN IF NOT EXISTS bird_project_id text;
ALTER TABLE app.wa_templates ADD COLUMN IF NOT EXISTS bird_version text;

-- Os dois modelos já aprovados do número do Fôlego (backoffice): retorno do chatbot e convite de indicação do Prumo.
UPDATE app.wa_templates SET bird_project_id = 'c6227d49-0400-4925-ba7d-07aa302ea3ad', bird_version = 'c3ffd3fe-2b02-4fd5-91cb-d7650f599e8b'
 WHERE name = 'folego-retorno-chatbot' AND bird_project_id IS NULL;
UPDATE app.wa_templates SET bird_project_id = '2ba1fa0a-3a45-4f82-9ba9-bae5fbe9dfc9', bird_version = 'c6603fc4-b3ce-416d-9a7e-35c6ed659d86'
 WHERE name = 'folego-indicacao-prumo' AND bird_project_id IS NULL;
