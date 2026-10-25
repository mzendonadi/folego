-- Apaga as 3 mensagens de teste que falharam com o erro 131053 (dois áudios e uma imagem PNG de teste) na conversa do próprio dono,
-- a pedido dele (24/10/2026), e os arquivos delas. Ids conferidos no backoffice antes de escrever esta migração.
DELETE FROM app.wa_messages WHERE id IN (
  '01a16ff5-e16b-722e-a8ef-e95474421d49',
  '01a17005-9a56-7706-837c-9881b54c6780',
  '01a17015-92a9-783a-8907-49dabed11ce4'
) AND status = 'falhou';
DELETE FROM app.wa_media WHERE id IN (
  '01a16ff5-e145-71cc-a07b-0627e12d7772',
  '01a17005-9a2a-7bfa-a181-ed24b9856f96',
  '01a17015-9271-7ea7-9b73-f6393da0322f'
) AND NOT EXISTS (SELECT 1 FROM app.wa_messages m WHERE m.media_id = app.wa_media.id);
