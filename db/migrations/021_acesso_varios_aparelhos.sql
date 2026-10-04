-- Link de acesso do Mapa: vários aparelhos ao mesmo tempo.
-- Antes, abrir o link em outro aparelho TIRAVA o caso da sessão original. Agora o aparelho que abre o link ganha um acesso
-- (esta tabela) e o dono original continua com o dele. O caso segue tendo uma sessão "criadora"; as outras entram aqui.
CREATE TABLE app.case_access (
  case_id    uuid NOT NULL REFERENCES app.cases(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES app.sessions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, session_id)
);
CREATE INDEX case_access_session_idx ON app.case_access (session_id);
