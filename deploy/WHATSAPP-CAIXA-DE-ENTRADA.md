# Caixa de entrada de WhatsApp (backoffice do Fôlego e portal do parceiro)

Uma tela "WhatsApp" completa, no estilo do WhatsApp Business, embutida nos dois lugares com o MESMO componente (`apps/web/assets/js/wa-inbox.js`) e o mesmo motor de conversas no servidor.

| Onde | Número | Provedor | Menu |
|---|---|---|---|
| Backoffice do Fôlego (`/gestao`) | **+55 11 91379-2370** | Bird (API do WhatsApp Business) | WhatsApp (permissão "WhatsApp do Fôlego") |
| Portal do parceiro Euro Multiplan (`/parceiros`) | **+55 41 9742-5502** (substitui o fixo +55 41 8742-8972) | Meta (Cloud API) | WhatsApp |

Os dois números **deixam de funcionar no aplicativo WhatsApp Business** do celular: passam a operar só pela API, e é por estas telas que a equipe atende.

## O que a tela faz

- **Conversas:** lista com busca, filtros (todas, não lidas, abertas, encerradas), contador de não lidas e prévia do que foi dito ("Foto: legenda", "Áudio"). Atualiza sozinha a cada 15 s.
- **Enviar mensagens** de texto (Enter envia, Shift+Enter quebra linha).
- **Novo número:** botão "Novo" (telefone, nome, "esta pessoa me autorizou" e, se quiser, o primeiro modelo aprovado).
- **Encaminhar:** em cada mensagem, ou "Selecionar mensagens" no menu; até 20 mensagens para até 5 conversas. Só chega a quem escreveu nas últimas 24 h; as demais aparecem como "não enviadas" com o motivo.
- **Anexos:** clipe para foto (JPG/PNG, até 5 MB), vídeo MP4, áudio (MP3, M4A/AAC, OGG, AMR) e documentos PDF, Word (doc/docx), Excel (xls/xlsx), PowerPoint (ppt/pptx) e TXT (até 16 MB). Pré-visualização e legenda antes de enviar. Fotos recebidas abrem ampliadas; documentos e áudios baixam ou tocam na própria conversa.
- **Mensagem de voz:** botão de microfone grava no navegador (até 5 min), com cancelar e enviar. Funciona no Chrome, Edge e Safari atuais (gravam em MP4/AAC) e no Firefox (OGG/Opus). O WhatsApp **não aceita WebM**; se algum navegador só gravar nesse formato, a tela avisa e pede para anexar um arquivo de áudio.
- **Perfil do contato:** nome, foto e observações (só a equipe vê) e a permissão ("autorizou receber"). O WhatsApp não entrega a foto do contato pela API, por isso a foto fica só no painel.
- **Perfil da empresa (portal do parceiro, aba Conexão):** recado, descrição, e-mail, site, endereço e foto do número, gravados na Meta. A foto exige o **ID do app da Meta** (campo na Conexão). No número do Fôlego (Bird) o perfil é editado no painel da Bird.
- **Janela de 24 h, SAIR e permissão** continuam valendo igual: fora da janela só modelo aprovado; "SAIR" encerra os envios na hora; o primeiro contato exige modelo aprovado e permissão.

## Segurança e privacidade (o que foi feito)

- Arquivos ficam **criptografados** (AES-256-GCM) no banco, por parceiro; o download exige login e é isolado (um parceiro nunca abre arquivo de outro). Observações do contato também ficam criptografadas.
- Tipo e **conteúdo** do arquivo são conferidos (um programa renomeado para .jpg é recusado). Documentos são sempre baixados, nunca executados no navegador.
- Para a Bird enviar mídia, o servidor expõe um link **público, assinado e de 30 minutos** (`/wa-media/<id>?e=...&s=...`) que só serve aquele arquivo.
- O nginx passou a aceitar corpo de até 16 MB **somente** em `POST /api/(gestao|partner)/wa/media`; o resto da API segue limitado a 64 KB. A política do site permite `blob:` para imagem e áudio e liberou o **microfone só para o próprio site**.

## Trocar o número da Euro Multiplan (você faz, na Meta)

1. No Meta Business (WhatsApp Manager), **adicione o número (41) 9742-5502** à conta do WhatsApp Business. Esse número **não pode estar em uso no aplicativo WhatsApp Business**: se estiver, desconecte/exclua a conta no aplicativo antes (as conversas antigas do aplicativo não migram).
2. A Meta confirma o número por **código de SMS ou ligação**. É um código que só chega a quem tem o chip; **não envie o código no chat**.
3. Copie o novo **ID do número de telefone** (Painel da Meta > WhatsApp > Configuração da API).
4. No portal da Euro: **WhatsApp > Conexão**, troque o "ID do número de telefone", clique em Salvar e depois em **Testar conexão**. O token e o segredo do app podem continuar os mesmos. Se quiser trocar a foto do perfil por aqui, preencha também o "ID do app da Meta".
5. No webhook da Meta, os dados (endereço e token de verificação) são os mesmos que já estão em Conexão; confirme o campo `messages` assinado para o novo número.
6. O número antigo (+55 41 8742-8972) deixa de ser usado; não precisa mais da verificação por ligação que estava pendente.

## Ligar o número do Fôlego (Bird)

O envio e o recebimento usam os mesmos segredos já cadastrados (`BIRD_API_KEY`, `BIRD_WEBHOOK_SECRET`, `BIRD_WHATSAPP_FROM`). Falta só garantir na Bird:

- O webhook `https://folego.online/webhooks/bird` precisa receber os eventos **`whatsapp.received`** (mensagens dos clientes) e `whatsapp.sent/delivered/read/failed` (status). Sem `whatsapp.received`, o convite continua saindo mas as respostas não aparecem na tela.
- Modelos para abrir conversa: cadastre em **WhatsApp > Modelos** (backoffice) com o mesmo identificador da Bird e marque "Aprovado" quando a Bird confirmar. O modelo do convite de indicação continua separado (`BIRD_TEMPLATE_INDICACAO`).

## O que ainda precisa ser confirmado num uso real

A documentação pública da Bird não detalha tudo; o que foi montado a partir dela e deve ser conferido no primeiro uso:

- o campo que identifica a mensagem recebida (usamos `data.id`, `data.message_id` ou `data.whatsapp_id`) e o texto/mídia em `data.text.body`, `data.image/audio/document/video` (`id`, `url`, `mime_type`, `caption`, `filename`, `voice`);
- o download de mídia recebida (a Bird responde 302 para um endereço assinado; o segundo pedido vai sem a chave);
- o formato do envio de mídia por endereço (`image`, `document`, `audio.voice`) e de texto livre.

Se algo diferir, o erro aparece na própria mensagem ("Não foi possível enviar") e o ajuste é local em `apps/api/src/wa-bird.ts`.
