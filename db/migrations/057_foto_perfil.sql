-- Foto de perfil do assinante (ícone no topo do Prumo). Fica criptografada (chave do servidor); o navegador já a reduz para um quadrado pequeno antes de enviar.
-- avatar_at serve para o navegador renovar a imagem quando ela muda.
ALTER TABLE app.subscribers
  ADD COLUMN avatar_enc  bytea,
  ADD COLUMN avatar_mime text,
  ADD COLUMN avatar_at   timestamptz;
