# DOCUMENTO OFICIAL DO PROJETO

> **Marca:** **Fôlego** · domínio **folego.online** (decisão D-018, ver §3).
> **Versão do documento:** 1.9 · **Última atualização:** 2026-09-27
> **Este é o ÚNICO registro do projeto.** Decisões, especificações, pendências e histórico vivem aqui.
> O código e o schema ficam ao lado, em pastas (`packages/`, `db/`), e são referenciados por este documento; não existem outros documentos de decisão.

---

## 0. Regras de manutenção deste documento

1. Toda decisão, mudança ou melhoria entra **aqui**, no mesmo dia, com data.
2. Uma decisão nova que substitui outra **não apaga** a antiga: a antiga vira "substituída por D-xxx" no registro (§2).
3. Todo item marcado **[PENDENTE]** tem dono e vira decisão ou é removido; nada fica solto.
4. Toda alteração relevante vai também para o **Changelog** (§14).
5. Segredos (chaves, senhas, tokens) **nunca** entram neste documento.
6. Valores que são premissas (taxas, prazos legais, descontos) ficam identificados como **PREMISSA** e listados em §5.10 até serem validados.

---

## 1. Visão e princípios

**Ideia:** aplicação web online, sem contrato e sem assinatura nos produtos avulsos. O cliente acessa o site, usa a ferramenta, vê o resultado na hora; **só paga se gostar**, por um preço justo e acessível. Se não gostar, descartamos e ele não paga nada. Se gostar, geramos a entrega completa e ela é dele.

**Produto de entrada:** Organizador de dívidas com roteiros de negociação. Depois, uma plataforma com vários módulos financeiros (§4.6) e, na fase 4, uma assinatura com planejador de IA.

**Princípios**
1. Sem login, sem CPF, sem assinatura nos produtos avulsos.
2. Pague só depois de ver: o preview é real; o conteúdo pago é travado **no servidor**.
3. Números calculados por código; a IA só escreve texto. Nunca o contrário.
4. Dados mínimos, apagados por prazo definido.
5. A recomendação ao usuário é independente do que parceiros pagam.
6. Preço acessível, pago por Pix.

**Público:** primeiro pessoa física; depois autônomo/MEI e pequena empresa.
**Construção:** solo, sem restrição de tempo.
**Tom da marca:** 80% amiga esperta e acolhedora, 20% consultoria séria. Frase curta, sem jargão, números concretos. O "sério" aparece nos números e nos avisos legais; o "amigo" aparece no resto.

---

## 2. Registro de decisões

| ID | Data | Decisão | Status |
|---|---|---|---|
| D-001 | 2026-09-26 | Modelo "pague só se gostar": preview grátis, entrega paga por Pix, sem assinatura nos avulsos | Ativa |
| D-002 | 2026-09-26 | Produto principal: **Organizador de dívidas**. Dinheiro esquecido entra como complemento: por ora só guia gratuito; versão elaborada e paga na fase 2 | Ativa |
| D-003 | 2026-09-26 | Jornada sem cadastro; consentimento (termos) marcado na tela ao final do formulário, com o documento completo disponível sob demanda | Ativa |
| D-004 | 2026-09-26 | Escada de preços: R$ 29 → +R$ 19 cartas → +R$ 19,99 calendário → R$ 15,99 renda extra; recorrência depois (Controle 19,99 / Ousado 39,99 / Desbravador 59,99) | Ativa |
| D-005 | 2026-09-26 | Formulário: mobile = um passo por tela; desktop = linha do tempo que nasce apagada e ganha vida a cada resposta | Ativa |
| D-006 | 2026-09-26 | Palavra "plano" evitada nos produtos avulsos (remete a assinatura). Nome do entregável: proposta "Mapa da Virada" | Ativa (nome sujeito à marca) |
| D-007 | 2026-09-26 | Banco: **PostgreSQL** (obrigatório). Restante da stack por decisão técnica do Claude | Ativa |
| D-008 | 2026-09-26 | Stack: TypeScript + Node 22 + Fastify; Astro + React (ilhas); monólito modular + worker; pg-boss (fila no Postgres); Docker Compose; gateway Pix atrás de interface | Ativa |
| D-009 | 2026-09-26 | Números por código (motor determinístico); IA só redige texto e só **depois** do pagamento | Ativa |
| D-010 | 2026-09-26 | Leads para consignado/instituições financeiras: consentimento **separado, opcional, desmarcado**, por categoria; parceiros com RLS; sem CPF coletado por nós | Ativa (revisão jurídica antes de operar) |
| D-011 | 2026-09-26 | Tom da marca 80/20 (amiga esperta / consultoria) | Ativa |
| D-012 | 2026-09-26 | Hospedagem: servidor dedicado 129.121.46.33 (zerado em 2026-09-26). O nome **CODHubs não pode aparecer** na marca pública | Ativa |
| D-013 | 2026-09-26 | Começar a construção pelo **motor de cálculo das dívidas** | Ativa |
| D-014 | 2026-09-26 | Dívida com possível prescrição fica **fora** dos cálculos (não se recomenda pagar antes de verificar) e aparece só como aviso | Ativa |
| D-015 | 2026-09-26 | Juros acumulados têm teto por tipo (cartão 100%, cheque especial e crédito de loja 100% por premissa) para evitar crescimento exponencial irreal | Ativa (validar §5.10) |
| D-016 | 2026-09-26 | Acesso por link mágico de 30 dias vir **incluso** no Mapa (não como item pago); Calendário é cobrado pelo que entrega | **[PENDENTE de confirmação do dono]** |
| D-017 | 2026-09-26 | Roteiros de negociação incluídos nos R$ 29 | **[PENDENTE de confirmação do dono]** |
| D-018 | 2026-09-26 | Marca escolhida: **Fôlego**. Domínio registrado pelo dono: **folego.online**. Entregável principal segue como "Mapa da Virada" | Ativa (verificações de marca pendentes, §3) |
| D-019 | 2026-09-26 | `folego.com.br` indisponível (terceiro). DNS do `folego.online` fica no **Cloudflare (plano Free)**; registrar novos domínios só com aprovação do dono (custo) | Ativa |
| D-020 | 2026-09-26 | A landing e o fluxo (E0) usam **HTML/CSS/JS nativos** (módulos ES), sem framework; `esbuild` só empacota o motor e o gerador de QR. Substitui, para essas telas, o "Astro + React" de D-008; Astro segue como opção para páginas de conteúdo/SEO na fase 2 | Ativa |
| D-021 | 2026-09-26 | Sem âncora numérica de preço ("consultoria custa R$ 200+") e sem prova social inventada enquanto não houver dados verificáveis | Ativa |
| D-022 | 2026-09-26 | Fontes hospedadas por nós (Fraunces e Figtree) e nenhum script de terceiros na landing: não enviar o IP do visitante a terceiros (LGPD) | Ativa |
| D-023 | 2026-09-26 | Back-end: Fastify 5 + PostgreSQL (`pg`); **PGlite em memória só para desenvolvimento e testes**. O **servidor** define a data de "hoje", os preços, as regras (ex.: cartas só com dívida possivelmente prescrita) e a trava do conteúdo pago. Sessão anônima por cookie `httpOnly` (hash no banco); CSRF por cabeçalho `x-folego` + `SameSite=Lax` | Ativa |
| D-024 | 2026-09-26 | TLS de origem com certificado **Origin CA do Cloudflare** e modo SSL/TLS **Full (strict)** (em vez de Let's Encrypt atrás do proxy); Nginx recusa (444) qualquer host desconhecido; IP real do visitante via `CF-Connecting-IP` | Ativa (não testado em servidor) |
| D-025 | 2026-09-26 | Pagamento atrás da interface `PaymentGateway`; hoje só existe o provedor de mentira (`fake`). O adaptador real (Asaas ou Mercado Pago) depende da resposta CPF x CNPJ/MEI | Ativa |
| D-026 | 2026-09-26 | O dono vende como **MEI** e o gateway é o **Asaas**, com **QR Code Pix estático, de uso único e valor fixo** (`POST /pix/qrCodes/static`, `allowsMultiplePayments: false`, `externalReference` = id do pedido). Não cria cliente nem pede CPF do pagador (o Asaas importa os dados quando o pagamento chega). O pagamento é ligado ao pedido pelo `pixQrCodeId` do webhook, e a API **reconsulta** `GET /payments?pixQrCodeId=` conferindo status e **valor pago** | Ativa (não testado contra o Asaas real) |
| D-027 | 2026-09-26 | Acesso do assistente ao servidor: usuário `deploy` (grupo `docker`, `sudo` só para `deploy/setup-server.sh`) com **chave SSH dedicada e sem senha**; a chave privada fica em `C:\Users\mzend\.ssh\folego_deploy_ed25519`, fora do projeto e nunca em documento ou memória. Revogação: apagar `/home/deploy/.ssh/authorized_keys` | **Superada por D-029** (a chave `folego_deploy` que eu gerei foi apagada) |
| D-028 | 2026-09-26 | Webhook: um evento só é marcado como **resolvido** quando o pagamento foi confirmado ou não é nosso; se a consulta ao provedor falhar ou ainda constar pendente, a retentativa do provedor é **reprocessada** (não descartada como duplicata). Em produção o provedor `fake` é **proibido** salvo autorização explícita (`ALLOW_FAKE_GATEWAY_IN_PRODUCTION=1`) | Ativa |
| D-029 | 2026-09-26 | Acesso do assistente ao servidor: o login **existente** `codhubs` (chave `codhubs_vps_ed25519`, porta 22022), que só tem `sudo` para o Docker (e para um caminho de scripts do projeto antigo). **Respeitar essa restrição:** implantação **somente por containers**, sem root, sem instalar pacotes, sem mexer em firewall e sem usar o Docker como atalho para virar root (nada de `--privileged` nem de montar `/`). **Uma conexão por vez**: o firewall bloqueia ~30 s quem abre mais de 5 conexões em 30 s | Ativa |
| D-030 | 2026-09-26 | Nginx **em container**; só aceita conexões vindas do **Cloudflare** (mapa `geo` + `real_ip`), acesso direto ao IP é derrubado; certificado de origem **autoassinado** porque o modo SSL/TLS do Cloudflare está em **Full** (confirmado no painel). Para **Full (strict)**, trocar por Origin CA | Ativa |
| D-031 | 2026-09-26 | **Pré-lançamento:** o site já responde em `https://folego.online`, mas com `noindex` (cabeçalho `X-Robots-Tag`) e `robots.txt` bloqueando tudo, porque o pagamento ainda é o de mentira. **Remover os dois no lançamento** | Ativa |
| D-032 | 2026-09-26 | **Build de produção com hash no nome:** `npm run build` (em `apps/web`) gera `apps/web/dist` com o pacote da aplicação em `assets/app/main-<hash>.js` (+ blocos sob demanda), `styles.css?v=<hash>` e o `index.html` reescrito. O `deploy.sh` publica **só o `dist`**. Motivo: o Cloudflare impõe cache de ~4 h nos scripts (mesmo com `no-cache` na origem) e visitantes ficavam com JavaScript velho depois de cada publicação. `config.js` fica **fora** do pacote (o deploy grava `API_BASE='/api'` e `DEV=false`) | Ativa |
| D-033 | 2026-09-26 | O aviso "Ambiente de demonstração" aparece sempre que o código Pix começar com `DEMO-` (inclusive em produção com o provedor `fake`). "Apagar meus dados" trata o clique nos botões diretamente e, se o servidor não conseguir apagar, **avisa** e mantém os dados locais em vez de fingir que apagou | Ativa |
| D-034 | 2026-09-27 | **A fila do worker é a própria tabela `deliverables`** (`FOR UPDATE SKIP LOCKED`, tentativas com espera, retomada de trabalho travado há mais de 10 min), sem pg-boss. Substitui a menção a pg-boss de D-008: menos uma dependência e o mesmo comportamento no banco de teste e no real | Ativa |
| D-035 | 2026-09-27 | **Geração dos roteiros:** os números (valores, descontos, teto mensal) vêm sempre do motor e a IA só escreve texto. A IA **nunca recebe nomes de credores** nem texto livre do usuário, só valores e categorias (`{{credor}}` é trocado depois). Um **verificador** reprova texto de IA com valor ou porcentagem fora dos permitidos, citação de lei/súmula, promessa, "limpar nome", link, CPF/telefone ou ids de dívida errados; reprovado, a IA tenta de novo com o motivo e, se persistir ou falhar, entra o **modelo determinístico**. Quem pagou **sempre** recebe conteúdo. Teto diário de chamadas à IA (`AI_MAX_CALLS_PER_DAY`) | Ativa (IA real não testada: sem chave) |
| D-036 | 2026-09-27 | **Cartas jurídicas só por modelos fixos** (nunca por IA), com campos entre colchetes para a pessoa preencher (não guardamos nome, CPF nem endereço), avisos para confirmar com advogado/Defensoria e a cláusula de que a carta **não reconhece a dívida**. Os textos citam dispositivos do Código Civil, do CDC e da LGPD e **precisam de revisão por advogado antes do lançamento** | Ativa |
| D-037 | 2026-09-27 | O worker roda em **container próprio** (`deploy-worker-1`, mesma imagem da API, comando `node src/worker.ts`); em desenvolvimento roda embutido na API (`WORKER_INLINE`) | Ativa |
| D-038 | 2026-09-27 | O Web Analytics (RUM) do Cloudflare foi **desligado** para `folego.online` (Cloudflare > Web analytics > Manage site > Disable), coerente com D-022. O erro de CSP no console sumiu | Feita |
| D-039 | 2026-09-27 | Depois do card "Comece por aqui" o preview mostra o card **"E tem mais no seu diagnóstico"**: contagens (`Preview.discoveries`: outras dívidas na fila, dívidas negociáveis, conta essencial em atraso) e a chamada "Liberar Mapa". Só números, nunca conteúdo pago | Feita |
| D-040 | 2026-09-27 | Cartas em **PDF gerado no navegador** (pdf-lib, carregado sob demanda): o formulário "preencha uma vez" (nome, CPF, cidade, e-mail, telefone) nunca vai ao servidor. Uma carta ou todas em um PDF, com rodapé de aviso. Os modelos ainda precisam de revisão de advogado | Feita |
| D-041 | 2026-09-27 | PDF das cartas redesenhado como carta formal (data à direita, destinatário, assunto, texto justificado, assinatura junta), sem título interno nem aviso impresso, marca-d'água discreta do Fôlego, numeração por carta e índice de uso na primeira página do PDF com várias cartas | Feita |
| D-042 | 2026-09-27 | **Pré-lançamento:** a rota de simulação de pagamento (`/api/dev/pay`) e o botão "Simular pagamento aprovado" passam a existir também em produção enquanto o gateway for o de mentira (`ALLOW_FAKE_GATEWAY_IN_PRODUCTION=1`), para o dono validar a entrega. Risco aceito pelo dono: qualquer visitante pode "pagar" de mentira. **Some sozinha quando o gateway for o Asaas**; conferir a ausência da rota no lançamento | Feita |
| D-043 | 2026-09-27 | **Identidade sem cadastro (a "conta" é o caso).** Cada navegador recebe uma sessão anônima (cookie httpOnly, 30 dias); pedidos, casos e direitos (`entitlements`) pertencem ao caso, nunca a uma pessoa identificada. `GET /api/me` reabre o Mapa pelo cookie (recarregar a página não perde nada). Para outro aparelho ou cookie apagado: **link de acesso** (token de 256 bits, só o hash em `access_tokens`, validade = a do Mapa, um link novo invalida o anterior); abrir o link passa o caso para a sessão de quem abriu (o aparelho antigo perde o acesso). Acesso = 30 dias a partir do pagamento. E-mail opcional para receber o link fica para quando houver provedor (fase seguinte) | Feita |
| D-044 | 2026-09-27 | **Catálogo genérico de produtos.** Pedido aceita `products[]` (Mapa, Kit de Cartas, Calendário 30 dias, Renda Extra); complementos só depois do Mapa, sem repetir; `items` da entrega = direitos ativos do caso; Calendário e Renda Extra são calculados no servidor só para quem comprou (`extras`). O Kit de Cartas passa a ser ofertado quando há dívida em atraso **ou** possivelmente prescrita (`lettersEligible`) | Feita |
| D-045 | 2026-09-27 | **Ferramentas grátis** (`#/ferramentas`, rodam no navegador): Calculadora de prescrição, Detector de golpe de "limpa nome", Guia de direitos do endividado (texto a revisar com advogado). Servem de gancho para o diagnóstico | Feita |
| D-046 | 2026-09-27 | **Tradutor de Cobrança** (produto `collection_translator`, R$ 12,90, agregador nº1 do roadmap). Cole o texto de uma cobrança; um analisador determinístico (sem IA, sem guardar o texto colado) classifica o tipo, o risco, extrai valores/datas/prazos citados, monta o que fazer / não fazer e uma mensagem pronta pedindo os dados do credor. Preview grátis só com contagens; caso próprio (`inputs.kind = 'translator'`), sem exigir o Mapa | Feita |
| D-047 | 2026-09-27 | **E-mail transacional** (agregador nº2), via Resend, opcional (`RESEND_API_KEY`; sem chave, os botões de e-mail somem — `GET /api/features`). Reenvia o link de acesso ao Mapa ou ao Tradutor; endereço usado só para enviar, nunca gravado. Em desenvolvimento, sem chave configurada, um `ConsoleSender` escreve no log e a resposta traz o código/link direto, para testar sem provedor real | Feita |
| D-048 | 2026-09-27 | **Kit Completo** (agregador nº3): pedir Mapa + Cartas + Calendário juntos fecha em R$ 59,90 (o desconto é calculado no servidor, nunca no navegador, e cai no item mais barato do pedido) | Feita |
| D-049 | 2026-09-27 | **Assinatura** Controle (R$ 19,99), Ousado (R$ 39,99) e Desbravador (R$ 59,99) (agregador nº4). Conta por e-mail **sem senha** (código de 6 dígitos, 10 min de validade); é a única parte do produto com cadastro — os avulsos continuam sem login. Pix mensal (sem cartão salvo), acesso por 30 dias por pagamento, cancelamento em um clique (só para de renovar; nunca corta o período já pago). Controle de gastos com categorização automática, importação de extrato CSV/OFX (lida no navegador, só os lançamentos vão ao servidor), alertas de limite por categoria, metas (Ousado+), treinador por regras explicáveis (limitado no Controle, completo no Ousado+) e simulador educativo de investimento (só Desbravador, com aviso de que não é recomendação). `SUBSCRIPTIONS_ENABLED` + e-mail configurado; sem isso a conta não existe | Feita |
| D-050 | 2026-09-27 | **Leads para consignado/renegociação** (agregador nº5), atrás de `LEADS_ENABLED` (desligado por padrão: aguarda revisão jurídica de LGPD/superendividamento, como já previsto no §4.7). Consentimento específico e separado (caixa desmarcada, categorias por checkbox, nunca embutido nos termos), só oferece categorias honestas para o caso (consignado só se `refinance.suitabilityOk`; renegociação só com dívida em atraso), contato criptografado (AES-256-GCM) separado do perfil derivado, entrega ao parceiro por webhook HTTPS assinado (HMAC, só domínio público, sem localhost/IP), limite de 3 parceiros por lead, retentativa com espera crescente, portal do parceiro (login por e-mail/senha, sem link público) só vê os próprios leads. Revogação a qualquer momento: apaga contato e perfil, cancela o que não foi enviado, e o parceiro que já recebeu é avisado (`revoked: true`) e perde o contato. CPF nunca é coletado por nós | Feita |
| D-051 | 2026-09-27 | **Migrações versionadas** (`db/migrations/*.sql`, tabela `app.schema_migrations`): a API aplica, no início, o schema completo só em banco vazio e SEMPRE as migrações pendentes (em ordem, uma por transação). Criadas 001 (tradutor), 002 (índice de reentrega de leads) e 003 (assinatura: `subscribers`, `login_codes`, `subscriptions`, `ledger_entries`, `budget_limits`, `goals`, e `orders.case_id` passa a aceitar `NULL` quando o pedido é de assinatura) | Feita |
| D-052 | 2026-09-27 | **Correção:** o botão "Gerar Pix" na tela de pagamento mostrava o valor de quando a tela abriu, sem atualizar ao marcar/desmarcar Kit de Cartas ou Calendário (o pedido enviado ao servidor já usava o valor certo; só o texto do botão ficava desatualizado). Corrigido: o botão agora se redesenha junto com o resumo a cada troca de complemento | Feita |
| D-053 | 2026-09-27 | **Tradutor de Cobrança: importar de PDF.** Botão "Importar PDF" lê o arquivo no navegador (pdf.js, lazy-loaded) e extrai o texto direto para o campo, sem enviar o arquivo ao servidor; a pessoa confere/edita antes de traduzir. Câmera/foto avaliada e **não construída nesta rodada**: OCR de foto teria peso grande no pacote, exigiria hospedar dados de treinamento e a precisão de uma leitura automática de foto não é confiável o bastante para uma ferramenta que aponta risco de golpe — em vez disso, a tela mostra uma dica (mobile) para tirar a foto e digitar/colar o texto, ou copiar direto do WhatsApp/e-mail | Feita |
| D-054 | 2026-09-27 | **Correção de um bug de implantação pré-existente (não introduzido nesta sessão, mas só percebido agora): `apps/web/assets/vendor/*.js` nunca era copiado para `dist/`.** Não quebrava nada que fosse importado por `import` normal (o empacotador já inclui esse código no pacote principal ou nos pedaços com hash, por import estático ou dinâmico) — mas o worker do pdf.js é referenciado por uma **string de caminho** (`new URL('./pdfworker.js', import.meta.url)`), que o empacotador não rastreia; em produção esse caminho apontava para dentro de `assets/app/` (onde não existe) e dava 404. Corrigido: o caminho agora é fixo a partir da raiz do site (`/assets/vendor/pdfworker.js`) e `scripts/build.mjs` copia esse arquivo para `dist/assets/vendor/`. Testado servindo o `dist/` real (não só o modo desenvolvimento) antes de publicar, exatamente para pegar esse tipo de gap | Feita |
| D-055 | 2026-09-27 | **Tradutor de Cobrança: ler foto (OCR).** Botão "Tirar foto ou escolher imagem" (`capture="environment"`, abre a câmera no celular). Leitura 100% no navegador via tesseract.js + WebAssembly, hospedado por nós (worker, motor e o pacote de português `por.traineddata`, ~1,4 MB) — nenhum CDN de terceiro, nenhuma imagem sai do aparelho. Sem custo de API (é uma biblioteca livre rodando local). Como leitura de foto erra (foco, luz, papel amassado), o texto reconhecido **sempre** vai para o campo para a pessoa conferir/editar antes de traduzir, nunca é usado direto | Feita |
| D-056 | 2026-09-27 | **CSP: acrescentado `'wasm-unsafe-eval'` a `script-src`** (`apps/api/src/security.ts` e `deploy/nginx/folego.conf`, que precisam continuar iguais). Necessário para rodar WebAssembly (o motor do OCR); essa diretiva libera só compilar/rodar Wasm — não libera `eval`/`Function` de JavaScript comum, então não abre brecha de XSS | Feita |
| D-057 | 2026-09-27 | **Correção de implantação: cache do Cloudflare servia versão velha de arquivos JS sem nome único** (`worker.js`, `pdfworker.js` do pdf.js — o mesmo problema da D-032, mas nos arquivos novos que ainda não tinham nome com versão). Hoje isso fez o Tradutor falhar em produção com um erro de CSP antigo mesmo depois do D-056 já estar no ar, porque o Cloudflare devolvia a resposta salva de antes da mudança. Corrigido builds futuros: `scripts/build.mjs` agora dá um nome de pasta/arquivo diferente a cada build para esses arquivos (`pdfworker-<versão>.js`, `tesseract-<versão>/`), do mesmo jeito que `main.js` já fazia. Corrigido também o problema pontual que causou isso: recriar (`--force-recreate`) o container do Nginx em vez de só `nginx -s reload` — nesse servidor, o reload sozinho não pegou a mudança de um arquivo de configuração montado (`deploy/nginx/folego.conf`); `deploy/deploy.sh` foi ajustado para sempre recriar | Feita |
| D-058 | 2026-09-27 | **E-mail (Resend) e assinatura: ATIVOS em produção.** Domínio `folego.online` verificado (autoconfiguração via OAuth Resend→Cloudflare, autorizada pelo dono); o dono colou a chave real em `deploy/.env` pelo Terminal (nunca inserida por automação, como já registrado); containers `api`/`worker` recriados para carregar. Verificado de fora: `GET /api/features` → `{"email":true,"subscriptions":true}`; um código de login de verdade foi enviado e aceito pela API (`POST /api/account/login-code` → 200). Restou só a limpeza de uma linha-placeholder duplicada que sobrou no `.env` de um teste anterior do dono | Feita |
| D-059 | 2026-09-27 | **Criador de Renda Extra 2.0 (reconstrução completa, via `/anthropic-skills:gerador-de-ideias`, direção C escolhida pelo dono).** O produto (R$ 15,99) era fraco: catálogo estático de ideias genéricas, plano de 4 semanas igual pra todo mundo, sem personalização real. Reconstruído com a regra explícita do dono: **nenhuma ação de IA antes do pagamento** (a oferta continua só uma chamada — "Podemos traçar um plano personalizado para você por R$ 15,99" —, sem prévia gerada por IA); **depois de pago**, uma entrevista curta (habilidades, horas/semana, capital disponível, veículo, presencial/online, tentativas anteriores) alimenta o motor (`packages/domain/src/income.ts`, reescrito: filtra ideias candidatas pelo vínculo e pelo modo de trabalho, calcula projeção mensal só por código para categorias por hora, monta a lista de plataformas e valores permitidos) e a IA (Claude, mesma disciplina das cartas/roteiros: só escreve texto sobre os fatos que o motor já calculou, nunca number nem plataforma nova; verificador dedicado `checkIncomeText` rejeita ideaId fora da lista, valor/plataforma não autorizados e qualquer promessa de "ficar rico"/"renda fácil"/pirâmide) escreve a nota de abertura, o "porquê" personalizado, uma frase extra por semana e um incentivo final — com modelo determinístico de reserva se a IA falhar, for reprovada ou o teto diário for atingido. Tom: **empreender, não só vender** (reforçado no prompt da IA e no verificador). Checklist de progresso por tarefa (`app.deliverables.generation_meta.progress`, chave `w{semana}t{tarefa}`), sem afetar o resto do Mapa. **Captura de lead com consentimento próprio:** como a pessoa já chegou a esse nível de comprometimento (comparável a assinar um plano), a entrevista também pede nome/telefone/e-mail (guardados criptografados, como os leads financeiros) e uma caixa **separada e desmarcada por padrão** para autorizar contato sobre parcerias de capacitação (SEBRAE, escolas técnicas, faculdades) — reaproveitando a infraestrutura de consentimento/entrega a parceiros já construída para os leads financeiros (D-010), agora com a categoria `empreendedorismo` (nenhum parceiro de capacitação existe ainda; a infraestrutura fica pronta antes de qualquer parceria real, do mesmo jeito que a de leads financeiros foi construída antes de qualquer instituição real). Migração `db/migrations/004_renda_extra.sql` (tabela `app.income_interviews`; `empreendedorismo` some às categorias aceitas por `partner_campaigns`/`partners`). Testes dedicados em `apps/api/tests/income.test.ts` (verificador, cliente do Claude, ponta a ponta com o worker, consentimento, progresso) | Feita (back-end e front-end; ver §6.9) |
| D-060 | 2026-09-27 | **Publicação e verificação ao vivo do Renda Extra 2.0, mais duas correções achadas no caminho.** Verificado em produção (caso de teste, apagado depois): `needs_interview` → entrevista (202) → worker gerou (`template`, IA desligada) → checklist salvo e persistido; consentimento `empreendedorismo` gravado e nome criptografado; migração 004 aplicada. **Bug 1 (pré-existente):** `replaceChildren()` é API nativa e, ao contrário do nosso `el()`, transforma `null` em texto "null" na tela — a página do Mapa mostrava "nullnull" onde faltavam seções (cartas, calendário, propostas), e a conta de assinante também (metas/simulador em planos menores). Corrigido em `results.js` e `account.js` com `.filter(Boolean)` (o tradutor e o checkout já faziam assim). **Bug 2:** o Nginx enviava `index.html` sem `Cache-Control`; os navegadores guardavam o HTML por heurística e seguiam apontando para o bundle antigo depois de publicar. Corrigido com `expires -1` em `location /` (`deploy/nginx/folego.conf`); confirmado `Cache-Control: no-cache` no ar | Feita |
| D-061 | 2026-09-27 | **Assinatura: nova área da conta em abas + metas com aportes (primeira etapa do plano da §6.5), com o skill de web design.** Crítica de UX da tela antiga: tudo numa rolagem só; **não havia botão de renovar com o plano ativo** (o e-mail de lembrete mandava "gerar um novo Pix na sua conta", mas a tela só mostrava planos depois de vencer); valor de gasto digitado com sinal negativo e sem máscara; meta com número "guardado" solto; abas de outro plano sumiam em vez de mostrar o que o upgrade traz; `window.confirm` nativo. **Feito:** `#/conta` virou uma área com abas e links diretos (`#/conta/metas`, `/lancamentos`, `/orcamento`, `/treinador`, `/simulador`, `/plano`): visão geral (saldo, entrou/saiu, gastos por categoria com barra e limite, alertas, metas), lançamentos (Gasto/Entrada em vez de sinal, campo de dinheiro com a mesma máscara do diagnóstico, importar extrato), orçamento (limite por categoria com barra do mês), metas, treinador, simulador e **Plano** (renovar +30 dias, trocar de plano — os dias que já tinha continuam —, não renovar, sair, apagar conta). Abas que o plano não inclui mostram o que o upgrade traz. Confirmações num diálogo no padrão do site. Aviso de "vence em N dias" com botão de renovar. **Metas:** tabela `app.goal_contributions` (migração `005_metas_aportes.sql`); total = valor inicial + soma dos aportes, calculado no servidor; concluída ao alcançar o alvo (`completed_at`), com histórico de concluídas; dá para desfazer um aporte (e a meta reabre). **Decisão:** o aporte é uma tabela própria, e **não** um `goal_id` em `ledger_entries` como o esboço da §6.5 previa — guardar dinheiro numa meta não é gasto e não deve distorcer o total de saídas do mês. **Fica para as próximas etapas:** carteiras, orçamento por mês (o limite ainda é fixo), lembretes (tabela `reminders`), schema de Open Finance, planejador de IA e cobrança recorrente automática (Asaas). Verificado no navegador (celular, tablet, desktop, claro e escuro): 0 violações de acessibilidade WCAG AA em todas as abas, renovação de ponta a ponta (+30 dias), aporte e deep link. Testes: API 79 (2 novos) | Feita (falta publicar) |
| D-062 | 2026-09-28 | **IA em produção: chave sem workspace exige o cabeçalho `anthropic-workspace-id`.** A chave criada pelo dono no Claude Platform estava correta (formato, 108 caracteres), mas a Anthropic devolvia HTTP 400 ("This API key is not scoped to a workspace...") e o sistema caía no modelo fixo, sem avisar. Diagnóstico feito dentro do container do worker, sem nunca imprimir a chave. Correção: variável opcional `ANTHROPIC_WORKSPACE_ID` (o ID do workspace não é segredo) enviada como cabeçalho pelos dois geradores; teste garante que o cabeçalho só vai quando configurado. Workspace *Default* da conta lido pelo console. **Segundo problema achado logo depois:** o modelo `claude-sonnet-5` recusa o parâmetro `temperature` ("is deprecated for this model"); removido dos dois geradores, com teste de regressão. Depois das duas correções, verificado em produção: o plano de renda extra e os roteiros saem com `source: ai`, passando no verificador. Chave nunca foi vista nem digitada por mim | Feita e verificada |
| D-063 | 2026-09-28 | **Backoffice `folego.online/gestao` (também `/gestão`).** Página própria (fora do site público), noindex, com menu lateral por permissão: **Painel** (funil visita→pagamento, "preencheram e não pagaram", receita por dia/produto/meio de pagamento, assinaturas, perfil dos clientes por vínculo/renda/estado/idade/dívida, origem do tráfego, horários, uso de IA), **Clientes** (compradores avulsos e assinantes, com gaveta de detalhe e jornada), **Assinaturas** (em dia, vencendo, não renova, **em débito**, com ações manuais de cortesia/plano/cancelar sempre com motivo), **Jornada e funil**, **Parcerias** (público potencial e pool com consentimento, contatos autorizados), **Produtos e preços** (edição de preço, dias, nome, à venda, usa IA; Kit Completo; recursos gratuitos), **Marketing** (insights por regras com o número que os sustenta, públicos e mensagens, quadro de planejamento, calendário) e **Configurações** (recursos do site e aviso, usuários e permissões, auditoria). **Entrada sem senha:** código de 6 dígitos por e-mail, sessão de 12 h; o primeiro dono vem de `ADMIN_EMAILS` (não é segredo); 5 papéis (dono, gestor, financeiro, marketing, suporte) que só sugerem as permissões; 11 permissões por área, incluindo `clientes_pii` separada; sempre resta ao menos um dono. **Dados pessoais:** listas nunca trazem nome/telefone/e-mail; contato só aparece para quem autorizou (consentimento vigente) e para quem tem `clientes_pii`, e cada visualização vai para a auditoria. **Rastreamento próprio e anônimo** (`app.events`, `POST /api/events`): só evento, tela, origem (UTM/site de origem) e tipo de aparelho uma vez por visita; sem IP, sem terceiros, respeita "Não rastrear", ignora robôs; `session_id` sem chave estrangeira para o histórico sobreviver à expiração da sessão. **Retenção LGPD:** o expurgo apaga o detalhe das dívidas mas mantém o caso; para os indicadores continuarem, cada caso guarda só totais anonimizados (`debt_total_cents`, `debt_count`, `has_overdue`, `debt_kinds`, `product_kind`). **Preços realmente editáveis:** o site deixou de ter valores fixos (landing, resultado, checkout, complementos) e lê `GET /api/catalog`; o servidor continua sendo quem cobra e calcula o Kit Completo (agora configurável); produto inativo não vende (422) e há "pausar vendas" (503). **Configurações em tempo de execução** (`app.settings`, releitura a cada 10 s na API e no worker): assinaturas, leads, IA, teto diário de IA, vendas pausadas, aviso no topo do site, preço do Kit e dias de antecedência do lembrete; dias por pagamento da assinatura vêm de `products.access_days`. Nginx: `/gestao/` sem cache; `robots.txt` bloqueia `/gestao`. Migração `006_backoffice.sql`. Testes: 15 novos em `admin.test.ts` (API 95); 0 violações axe (claro e escuro) em todas as telas | Feita (ver §6.10) |
| D-064 | 2026-09-29 | **Repositório oficial: https://github.com/mzendonadi/folego (privado, branch `main`).** Até aqui o projeto só existia na pasta local `C:UsersmzendProjeto Finanças` e no servidor, sem controle de versão. Regra daqui em diante: toda mudança termina com commit e envio para o GitHub, além deste documento. Ficam **fora** do repositório: segredos (`deploy/.env`, certificados, `*.pem`/`*.key`) e o que o build gera (`apps/web/dist`, `assets/vendor`, `assets/fonts`, `deploy/site`). Um clone novo precisa de `npm install` nas pastas e de `npm run build` em `apps/web` antes de rodar. O repositório deve continuar **privado**: este documento cita o IP do servidor, a porta e o usuário de SSH (nunca chaves) | Feita |
| D-065 | 2026-10-02 | **Mais valor no Mapa, no Calendário e no Renda Extra (pedido do dono: "muito pobre para quem está pagando").** (1) **Renda Extra:** a IA falhava em silêncio porque o texto passava de um limite de tamanho do schema e caía no modelo fixo. Agora a IA escreve o plano INTEIRO sob medida (negócio em uma linha, oferta, primeiro cliente, como cobrar, 4 semanas com objetivo e tarefas próprias, mensagem pronta para clientes, cuidados do caso), com limites folgados, até 3 tentativas (resposta fora do formato volta com o motivo) e verificador estendido a todos os campos (valor e plataforma fora da lista, promessa, número de semanas); botão "refazer a entrevista". (2) **Estratégias do Mapa** (`packages/domain/src/strategies.ts`, 100% determinístico): comparação de caminhos (como está, plano, avalanche, bola de neve), plano mês a mês dos 6 primeiros meses (simulador ganhou `traceMonths`), efeito de pagar mais por mês, uso de dinheiro extra (um salário), quitação à vista com desconto, troca por crédito mais barato, marcos e um roteiro de estratégias que só aparecem se se aplicam (fechar a conta, superendividamento, rotativo/cheque especial, desconto à vista, consignado/portabilidade, dinheiro extra, reserva, prescrição, descobrir taxas). Calculado na leitura da entrega (`strategies`), então casos antigos também recebem. (3) **Calendário:** o `.ics` já servia a Google, iPhone e Outlook; agora a tela diz isso, tem botões e passo a passo para cada um, link "adicionar ao Google Agenda" por item, e inclui estratégias, dia de pagar de cada mês e marcos (dívida quitada, metade, livre das dívidas) além dos 30 dias. Corrigido: desconto de negociação aparecia como "0,1%" no lugar de 10%. (4) **Formulário:** "Outra" agora abre "Qual dívida é essa?" (obrigatório), e a descrição aparece no Mapa. Testes: motor 57, API 98; 0 violações axe | Feita |
| D-066 | 2026-10-02 | **Calendário do plano: R$ 19,99 → R$ 24,99 e novo nome (antes "Calendário dos 30 dias").** O produto passou a entregar estratégias, dia de pagar de cada mês e marcos além dos 30 dias (D-065), então a escada de preços (Mapa 29 > Calendário 24,99 > Cartas 19 > Renda Extra 15,99) fica coerente e continua abaixo do Mapa. Kit Completo (59,90) mantido: soma dos três passa a ser 72,99 e o desconto sobe para 13,09. Alterado direto no banco de produção (com histórico de preço e auditoria) porque o backoffice exige código por e-mail. **Teste:** acompanhar 2 semanas em Painel → Produtos comprados; se as vendas do Calendário caírem a menos da metade do ritmo, voltar a 21,99 ou 19,99 em Produtos e preços | Feita |
| D-067 | 2026-10-02 | **Login do backoffice em duas etapas: senha + código por e-mail.** Antes, qualquer pessoa com um e-mail autorizado recebia código e entrava. Agora: senha forte (scrypt), código só é enviado se a senha estiver certa, 5 erros bloqueiam 15 min, mensagens de erro genéricas, sessão de 8 h. Primeiro acesso/esqueci a senha: código por e-mail + definir senha (janela só existe para quem ainda não tem senha ou foi liberado pelo dono, 24 h). Dono pode "Redefinir senha" de qualquer pessoa; trocar senha derruba as outras sessões | Feita |
| D-068 | 2026-10-02 | **E-mail de campanha pelo backoffice (aba Marketing → E-mails).** Só para assinantes; públicos prontos (renovar em 7 dias, em débito, sem uso há 14 dias, upgrade, todos ativos); teste obrigatório antes do envio; permissão própria `marketing_envio` (só dono); confere o número de destinatários; teto diário configurável (padrão 200); 1 campanha por semana por pessoa; descadastro por link assinado e List-Unsubscribe one-click (LGPD); e-mails de conta (login, lembrete de renovação) continuam chegando a quem se descadastrou | Feita |
| D-069 | 2026-10-02 | **Assinatura: carteiras e lembretes.** Carteiras (dinheiro, conta, cartão, poupança; até 10) com saldo por carteira; lançamento pode ou não ter carteira; apagar carteira solta os lançamentos. Lembretes de contas e prazos (até 100) com e-mail na antecedência escolhida (uma vez por vencimento) e renovação automática de contas mensais ao dar baixa. Orçamento por mês fica para outra rodada | Feita |
| D-070 | 2026-10-02 | **Backoffice: login só com e-mail e senha.** O código por e-mail ficou apenas no primeiro acesso e na redefinição de senha (valida que o e-mail é da pessoa). Decisão do dono; mantém bloqueio por tentativas e auditoria. Tela Configurações voltou a carregar (o arquivo `config.js` colidia com a regra do build que exclui o `config.js` do site; passou a `configuracoes.js`) e o layout de Produtos e preços foi alinhado | Feita |
| D-071 | 2026-10-02 | **Assinatura v2: Dívidas, orçamento por mês, resumo semanal e Planejador.** (a) Aba Dívidas: cadastro com saldo/juros/parcela, pagamentos que abatem o saldo e entram nos lançamentos, plano de quitação avalanche x bola de neve calculado pelo motor (`buildPayoffPlan`) com simulação de "pagar a mais por mês" — em todos os planos; (b) orçamento por mês (limite só do mês, copiar do mês anterior); (c) e-mail semanal de resumo (respeita o descadastro); (d) Planejador "Pergunte ao Fôlego" só no Desbravador: fatos por código, IA só escreve o texto, verificador reprova valor fora dos fatos, sem chave/erro cai em resposta por regras; 10 perguntas/dia; o texto da pergunta não é guardado. Cobrança recorrente automática (Asaas) segue adiada até o MEI | Feita |
| D-072 | 2026-10-02 | **A Assinatura vira um coach de finanças.** (a) **Saúde financeira**: nota 0–100 em 4 pilares (sobra do mês, peso das dívidas, reserva de emergência, hábito/controle), calculada pelo motor; (b) **Jornadas** com missões que se confirmam sozinhas pelos dados: Organizar o mês (Controle), Sair do vermelho e Montar a reserva (Ousado), Começar a investir com base sólida (Desbravador); (c) **Métodos** (50/30/20, pague-se primeiro, revisão semanal, avalanche, bola de neve, envelopes, regra das 24 h, juros compostos) aplicados à renda da pessoa; (d) **Mercado**: Selic, IPCA 12 meses, CDI e dólar lidos do Banco Central (SGS) a cada 12 h, com leitura personalizada (dívida cara x CDI, juro real, hora de renegociar). Sem fonte de notícias: só dado oficial, sempre com data. **Distribuição por plano**: Controle = nota, jornada Organizar, 3 métodos, Selic/IPCA/CDI; Ousado = + todas as jornadas de dívida e reserva, todos os métodos, leitura personalizada; Desbravador = + jornada de investir, dólar, histórico de 12 meses, Planejador com IA e simulador. Aba Coach passa a ser a entrada da conta | Feita |
| D-073 | 2026-10-02 | **Política de privacidade atualizada** com a conta de assinante, o uso de IA no Planejador, os e-mails de conta/resumo/novidades (com cancelamento) e o rastreamento anônimo; público de campanha "assinaturas vencidas nos últimos 30 dias" para recuperar quem não renovou; importação de extrato passa a aceitar a carteira de destino | Feita |
| D-074 | 2026-10-02 | **Coach: hábito diário.** Sequência de dias seguidos lançando; 3 desafios por semana (um fixo de registrar + dois que rodam conforme a conta: limites, dívida, meta, lembretes, sobra), confirmados sozinhos pelos dados; comparação do gasto do mês com o mesmo ponto do mês anterior (por categoria); e-mail de boas-vindas único, enviado pelo worker logo após a assinatura ativar, levando a pessoa à primeira jornada (quem já era assinante antes não recebe) | Feita |
| D-075 | 2026-10-02 | **Objetivo e metas prontas.** Ao entrar no Coach pela primeira vez a pessoa escolhe o objetivo (organizar, sair do vermelho, reserva, investir) e a jornada correspondente já começa (plano sem acesso cai em "Organizar o mês"). Na aba Metas há modelos prontos cujo valor sai da conta: reserva de 1, 3 e 6 meses do gasto médio, quitar dívidas (total devido), viagem, estudo, manutenção. **Adiado:** conta compartilhada com parceiro(a) (exige convite, permissões e regras de privacidade próprias; entra em rodada separada) e cobrança recorrente (Asaas, após o MEI) | Feita |
| D-076 | 2026-10-03 | **A área de assinatura se chama "Prumo"** (antes "Minha conta"; nome completo: "Prumo, o app de finanças do Fôlego"). "Estar no prumo" é estar em ordem, de pé e na direção certa, que é a promessa do produto. Constante única em `assets/js/brand.js`. **Prumo na landing**: seção própria com os três planos (Controle, Ousado, Desbravador) logo depois do preço do Mapa, item no menu, botão "Entrar" no cabeçalho e pergunta no FAQ; o Mapa continua sem cadastro e sem mensalidade | Feita |
| D-077 | 2026-10-03 | **Revisão de layout e UX.** Navegação do Prumo agrupada (Hoje, Dinheiro, Dívidas e metas, Inteligência, Conta): barra lateral fixa no desktop e abas roláveis com esmaecimento e rolagem até a aba ativa no celular (antes 13 abas cortadas na margem); métodos e jornadas com recuo e espaçamento corretos; gaveta do backoffice no celular sem vazar sombra nem receber foco quando fechada; campos de Produtos e preços alinhados em grade; cabeçalho da landing sem quebra de linha. Auditoria de estouro horizontal (375, 768 e 1280 px) em todas as telas: nenhuma | Feita |
| D-078 | 2026-10-03 | **Conta compartilhada (Ousado e Desbravador).** O titular convida UMA pessoa pelo e-mail; ao aceitar, ela entra com o próprio e-mail e passa a ver e editar a MESMA conta (lançamentos, dívidas, metas, lembretes, carteiras). Os dados continuam do titular, nada é copiado. Só o titular paga, cancela, convida e apaga a conta; o membro não assina enquanto estiver na conta compartilhada e pode sair a qualquer momento (volta à própria conta); o titular pode remover. Não aninha: quem é titular de uma conta compartilhada não entra na de outro. Termos e privacidade atualizados | Feita |
| D-079 | 2026-10-03 | **Tom sobre crédito: de "não faça" para "busque com consciência".** Os avisos "Não pegue empréstimo novo…" (estratégias) e "Não se endivide para começar" (renda extra) viraram "busque recursos de forma consciente… se precisar de mais ajuda, podemos te direcionar para um parceiro Fôlego!", com o botão "Quero falar com um parceiro Fôlego" logo abaixo, que leva ao formulário de autorização da própria página (a IA do Renda Extra recebeu a mesma regra de tom). O formulário agora aparece para todo diagnóstico quando o recurso de parceiros está ligado (sem atraso nem perfil de consignado, cai na categoria "renegociação e orientação") e o título passou a "Fale com um parceiro Fôlego". **Pendente de revisão jurídica:** o novo texto do consentimento da categoria e o fato de oferecer contato a todos | Feita |
| D-080 | 2026-10-03 | **Prumo passa a ser assinatura mensal recorrente SOMENTE no cartão de crédito (Asaas); Pix sai da assinatura.** Sem contrato: a pessoa aceita o mesmo termo de consentimento e a cobrança recorrente (aceite e versão dos termos gravados em `billing_profiles`). O cartão é digitado na página segura do Asaas (assinatura criada sem dados de cartão; invoiceUrl da 1ª cobrança): nenhum dado de cartão passa pelo Fôlego (fora do escopo PCI). Cada mensalidade confirmada soma 1 mês de calendário; renovações chegam por webhook e viram pedido/pagamento. Cartão recusado: aviso por e-mail, acesso segue até o fim do período; tolerância de 2 dias para a renovação chegar. **Eventos do Asaas a ativar no webhook:** PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_CREDIT_CARD_CAPTURE_REFUSED, SUBSCRIPTION_DELETED, SUBSCRIPTION_INACTIVATED. **Estrutura pronta e testada com provedor de mentira e com o adaptador simulado; falta só ligar a conta Asaas (após o MEI): PAYMENT_PROVIDER=asaas + chaves.** Não testado contra o Asaas real | Feita |
| D-081 | 2026-10-03 | **Cancelamento e dados.** Cancelar para a cobrança NA HORA (cancela a assinatura no provedor), não devolve o mês em andamento, e mantém acesso e download dos dados (planilha .xlsx e PDF) até o fim do mês já pago; o aviso aparece no cabeçalho, na aba Plano, na confirmação, no e-mail e nos termos. Depois do fim do acesso os dados são apagados automaticamente. **Janela de segurança:** para o dono baixar o pacote antes, os dados ficam guardados por `canceledPurgeDays` (padrão 15, ajustável de 1 a 180 em Configurações) depois do fim do acesso e então o sistema apaga sozinho; o termo informa "até 15 dias". Quem assina de novo dentro da janela continua de onde parou. Apagar a conta pela pessoa passa a apagar tudo (e cancela a cobrança) | Feita |
| D-082 | 2026-10-03 | **Backoffice: Assinaturas → aba Cancelados.** Lista ex-assinantes (plano, quando cancelou, acesso até, exclusão automática em, se os dados já foram baixados). "Baixar dados" gera um .zip com TUDO que o sistema guarda da pessoa (uma tabela por arquivo .json, descobertas no próprio banco pela coluna subscriber_id, mais pedidos, pagamentos, auditoria e LEIA-ME; sem segredos de sessão). "Excluir dados" só libera depois do download, exige digitar o e-mail do ex-assinante e apaga tudo; pedidos e pagamentos permanecem sem dado pessoal (e-mail anonimizado) por obrigação fiscal. Nova permissão `dados_exportar` (só o dono por padrão); baixar e excluir ficam na auditoria | Feita |
| D-083 | 2026-10-03 | **Perfil e preferências; cabeçalho mensal; preços dos planos sincronizados.** Aba Perfil (nome e e-mails que a pessoa quer: resumo semanal, lembretes, novidades; e-mails de segurança e cobrança sempre saem). O cabeçalho deixou de mostrar "N dias restantes" e passou a "Plano X · mensal · R$/mês · renova em dd/mm" (ou "Cancelado · acesso até dd/mm", "Cartão recusado"). **Correção:** os preços dos planos editados em Produtos e preços agora aparecem na landing, na escolha de plano e no cabeçalho (antes o site usava valores fixos). Produtos e preços e Configurações do backoffice foram ajustados ao modelo mensal no cartão | Feita |
| D-084 | 2026-10-03 | **eBook de presente "Respira. Organiza. Avança." (54 páginas) para quem assina Ousado ou Desbravador.** Guia ilustrado em PDF (capa, 15 capítulos com abertura em página cheia, caixas "Mão na massa" e "Fazendo a conta", tabelas calculadas, glossário, plano de 90 dias), gerado por `apps/web/scripts/ebook` (motor próprio com pdf-lib; saída em `apps/api/src/assets/folego-ebook.pdf`, importado como eBook padrão na primeira subida). Conteúdo educativo, sem recomendação de investimento, com aviso legal. **Automação:** o worker envia, uma única vez por pessoa, um e-mail com a identidade do Fôlego/Prumo (agradecimento + o que há no eBook + dica de uso + convite a indicar amigos) com o PDF em anexo; quem sobe de Controle para Ousado/Desbravador também recebe; quem já assinava antes não recebe de repente. **Backoffice → Marketing → "eBook de presente":** repositório com subir, atualizar arquivo (nova versão), trocar título, ativar versão, baixar, enviar teste ao próprio e-mail e excluir; um único eBook ativo; contador de enviados e fila. PDF fica no banco (até 15 MB); o Nginx aceita corpo grande só nessa rota | Feita |
| D-085 | 2026-10-03 | **Indicações.** (a) **Quem comprou produto no Pix** vê o cartão "Está curtindo o Fôlego? Indique para um amigo" na entrega: modal com o e-mail do amigo e o primeiro nome de quem indica; o amigo recebe e-mail no padrão do Fôlego dizendo quem indicou. **Só gera lead: sem desconto nem bônus.** Limite de 5 convites por comprador; mesmo amigo não recebe de novo por 30 dias; link de "não quero receber" bloqueia o e-mail na hora (guardado só como hash). (b) **Assinantes do Prumo** (aba "Indique e ganhe"): link com código pessoal e convite por e-mail; cada amigo que assina um plano qualquer (primeira cobrança confirmada) gera **1 crédito de 10% na próxima fatura** de quem indicou; os créditos se acumulam e cada fatura gasta um (10 indicações que assinam = 10 faturas seguidas com 10%). O valor da assinatura é ajustado no Asaas automaticamente pelo worker (valor com desconto enquanto houver créditos; volta ao preço cheio quando acabam), e quem indicou recebe e-mail de aviso. Atribuição pelo link (`?ind=`) ou pelo e-mail convidado; sem autoindicação, só a primeira assinatura conta; quem já assina não rende indicação. (c) **Backoffice → Indicações:** convites, conversão, descontos disponíveis/aplicados, ranking de quem mais indica, convites recentes (e-mail mascarado), ajuste manual de créditos com motivo (auditado); liga/desliga e percentual (0–50%) em Configurações. Apagar a conta apaga os e-mails de amigos indicados. Landing, termos e FAQ atualizados | Feita |
| D-086 | 2026-10-03 | **Correção crítica do worker + controle dos descontos + ajustes de layout/texto.** (a) **O container worker de produção não tinha e-mail nem o gateway real** (só a API tinha): por isso o eBook de presente ficava em "Aguardando envio" e nenhum e-mail de segundo plano (boas-vindas, lembretes, resumo semanal, campanhas, avisos de indicação) saía. Agora o worker usa o mesmo e-mail e o mesmo gateway da API, relê as configurações do backoffice a cada volta e **cada trabalho roda isolado** (um erro não derruba a fila; o log traz `trabalho_erro`). (b) **Desconto de indicação sob controle total:** o valor contratado (preço da época da assinatura) é guardado e o desconto incide sobre ele, então mudar o preço do plano vale só para novas assinaturas; cada crédito tem seu percentual; o pedido guarda preço de tabela e valor cobrado, e **Clientes → Pedidos mostra forma (cartão), tabela, cobrado e o desconto aplicado (com % de indicação)**; a **Jornada do cliente** registra aceite dos termos, indicações feitas, "chegou por indicação", desconto ganho, desconto aplicado na fatura (cobrado X em vez de Y), cancelamento, cartão recusado e eBook enviado; o cliente tem bloco "Indicações e descontos" (créditos disponíveis/aplicados com a fatura, valor esperado x valor no provedor); **Indicações → Conferência de valores** lista quem tem desconto pendente e se o valor no provedor confere. Aplicar crédito e ganhar crédito ficam na auditoria. (c) **Cenário econômico:** a busca no Banco Central agora tenta "últimos N" e, se recusar, o intervalo de datas; cada série é independente; o motivo da falha fica gravado; a API também busca na hora quando alguém abre a aba sem dados; em Configurações há "Indicadores econômicos" com última atualização, valores, erros e botão "Atualizar agora". (d) Landing: textos dos planos corrigidos (itens com negrito não quebram mais), retirada de "(não devolvemos o mês em andamento)" da landing (fica nos termos), botões dos planos com mesmo tamanho e alinhados; aviso de parceiros reduzido a "Crédito novo é dívida nova: só faz sentido se reduz o que você paga no total."; escolha de plano no Prumo passa a citar o eBook de presente no Ousado e no Desbravador; backoffice: lista "Outras versões guardadas" refeita e indicadores do Painel sempre em uma fila | Feita |
| D-087 | 2026-10-03 | **Indicadores econômicos com plano B.** O servidor de produção não consegue falar com o Banco Central pela rede ("fetch failed" em todas as séries), então cada série ganhou uma fonte alternativa pública: Selic e CDI pela BrasilAPI (espelho do Banco Central; só o valor do dia, a tendência de 3 meses passa a existir conforme o histórico se forma), IPCA em 12 meses pelo IBGE (SIDRA, tabela 1737) e dólar pelo Frankfurter (taxas do Banco Central Europeu), com AwesomeAPI e open.er-api como reservas (a AwesomeAPI chegou a responder 429, limite de uso). O Banco Central continua sendo a primeira tentativa; se ele não responde pela rede, as demais séries dele são puladas para não atrasar. O motivo de cada tentativa (inclusive o código de rede) aparece em Configurações → Indicadores econômicos | Feita |
| D-088 | 2026-10-03 | **Detector de cobranças recorrentes e simulador "e se...?" no Prumo.** Avaliação de ideias do mercado: (1) detector de cobranças indevidas/assinaturas esquecidas e (2) simulador de cenários financeiros **entram** (usam os lançamentos que a pessoa já tem, sem Open Finance); (3) cobrador automático de faturas para freelancers **fica de fora** (outro produto, outro público, B2B; decisão do dono). **Cobranças** (todos os planos, aba no grupo Dinheiro): acha no extrato o que se repete todo mês ou todo ano (chave pelo nome do lançamento + intervalo entre cobranças), mostra custo por mês e por ano e a próxima esperada, alerta **aumento de preço** (≥ 3% e ≥ R$ 1) e **possível cobrança em duplicidade**, e deixa marcar "mantenho" ou "vou cancelar" somando a economia anual; cobranças que pararam há mais de ~2 ciclos saem da lista; nova missão "Revise suas cobranças recorrentes" na jornada Organizar o mês. **E se...?** (Ousado e Desbravador; Controle vê o bloqueio): parte da média dos últimos 3 meses (renda, essencial, variável), das parcelas mínimas das dívidas e da reserva (metas + poupança); modelos prontos (mudar de emprego, reduzir jornada, cortar variáveis, atacar dívida, mudar de casa, renda extra); mostra o mês novo x o atual, saldo acumulado em até 60 meses (gráfico), quando o cenário passa o atual e alertas (mês no vermelho, reserva que não cobre a transição). Cálculo no motor (`recurring.ts`, `scenario.ts`) e no navegador, com testes. Landing e escolha de plano atualizadas | Feita |
| D-089 | 2026-10-03 | **Revisão total ponta a ponta.** Conferido o histórico completo (decisões D-001 a D-088, memória do projeto, código e produção). Roadmap §10 atualizado (E4 e E7 concluídos) e criado o **checklist de lançamento §11A** com 18 itens (bloqueios, autonomia) e a lista do que foi mencionado e continua fora do escopo | Feita |
| D-090 | 2026-10-03 | **Operação autônoma: saúde, backup, limpeza, SEO e anti-robô.** (1) `/api/health/deep` + batimento do worker + card no Painel + workflow Monitor (10 min). (2) `deploy/ops/*` e workflow Operações (status, instalar rotinas, backup, teste de restauração, limpeza de dados de teste com confirmação e backup prévio), cópia criptografada fora do servidor opcional. (3) Indexação preparada por `SEO_OPEN` (fechada até o lançamento). (4) Cloudflare Turnstile opcional (liga só com as duas chaves). (5) Script de endurecimento do servidor para rodar como root | Feita |
| D-091 | 2026-10-03 | **QA total e correção dos 22 achados** (`QA-RELATORIO.md`, scripts em `qa/`). Principais decisões de produto: (1) campos de dinheiro leem número sem vírgula como **reais** ("1700" = R$ 1.700,00), não como centavos; (2) dívida cuja parcela não cobre os juros, ou com quitação acima de 10 anos, **não** é mais apresentada como "livre em X meses": a manchete passa a dizer que do jeito atual não acaba e aponta para renegociar; (3) sem renda e com dívida a nota de saúde cai ao pior caso; (4) detector de cobranças ignora mercado e transporte por app, exige valor estável e acusa duplicidade também no mesmo dia; (5) o link de acesso do Mapa continua com **um único dono** (abrir em outro aparelho leva o Mapa para lá), agora dito na tela; (6) o código de login só aparece na resposta com `EXPOSE_DEV_CODES=1` em desenvolvimento; (7) validação de datas, meses e texto na API (400 em vez de 500), esquemas estritos nas rotas de escrita da conta, 401 em toda rota da conta sem sessão, erros do framework em português; (8) HSTS com `includeSubDomains`; (9) ajustes de layout/acessibilidade no celular e no backoffice | Feita |
| D-092 | 2026-10-03 | **Link de acesso em vários aparelhos, cheque especial (LIS) no Prumo e campos de detalhe para "Outra".** (1) O link de acesso do Mapa passa a **somar** aparelhos (tabela `case_access`, até 5 por caso) em vez de mover o Mapa: o aparelho original continua abrindo; quem não tem o link continua sem acesso; gerar link novo invalida o anterior (substitui a decisão do item 5 da D-091). (2) **Cheque especial (LIS)** na carteira "Conta bancária" do Prumo (aba Carteiras): saldo de partida, limite contratado e taxa ao mês (padrão 8%, o teto dos bancos); o app mostra o quanto do limite está em uso, uma barra de uso, o custo estimado de juros por mês e avisa na visão do mês (aba Visão geral) quando está no cheque especial ou passou do limite; dá para ajustar depois. Saldo de partida também vale para poupança no cálculo de reserva. (3) Revisão de todas as opções "Outra": tipo de dívida (já tinha campo), **vínculo de trabalho "Outra situação"** (novo campo opcional, guardado no caso e visível no backoffice), **tipo de carteira "Outra"** (o nome vira "Qual é essa carteira?") e **calculadora de prescrição** (explica o prazo geral usado); a categoria de lançamento "Outros" já tem o campo Descrição | Feita |
| D-093 | 2026-10-03 | **LIS integrado, guias das fases futuras, Open Finance (desligado) e identidade visual.** (1) **Cheque especial (LIS) integrado:** o uso do limite vira dívida "virtual" na aba Dívidas (entra no plano de quitação, sem editar nem pagar ali: o saldo vem da carteira), pesa na nota de saúde (juros do mês entram como parcela e conta como dívida cara), vira o **foco do dia** do Coach (passa na frente das jornadas), primeira dica do Treinador e nova missão "Zere o cheque especial" na jornada Sair do vermelho (só aparece para quem tem LIS). (2) **Quatro guias pagos sob medida** (mesmo desenho do tradutor: prévia grátis, Pix, conteúdo completo; o que a pessoa digitou não é guardado): **Comparador honesto de financiamento** (CET, total pago, Price/SAC, alertas de tarifa/seguro/prazo, custo de esperar), **Renegociador de contas de casa** (plano de acordo, roteiro de ligação, objeções, carta para ouvidoria, tarifa social, corte), **Guia do dinheiro esquecido** (roteiro personalizado das fontes oficiais; nunca estima valor; alertas de golpe) e **Currículo por vaga** (cruza a vaga com o que a pessoa já fez, sem inventar; nome e contatos ficam só no navegador). Nascem **desligados** (migração 022): preços sugeridos do roteiro R$ 19, 15, 15 e 19; o dono liga cada um em Produtos e preços. (3) **Open Finance** via agregador (Pluggy), só leitura de contas correntes e poupanças, plano Desbravador: adaptador, importação sem duplicar, saldo real na carteira, consentimento versionado, revogação e sincronização no worker. **Desligado até haver contrato e chaves** (`PLUGGY_CLIENT_ID/SECRET`); testado com respostas simuladas, **não** contra o ambiente do agregador. (4) **Identidade visual definitiva**: marca do Fôlego (anel aberto + ponto de ar âmbar + centro menta) e do Prumo (fio de prumo), paleta com contrastes, PNG de ícones, avatares, capas e modelos de publicação, `site.webmanifest`, guia de marca, dossiê de INPI e kit de redes sociais em `marca/` | Feita (com pendências do dono) |
| D-094 | 2026-10-03 | **Guias ligados, ajustes de layout, estratégias sem repetição, envio manual de contatos a parceiros e novo Prumo.** (1) Os 4 guias (financiamento R$ 19, contas de casa R$ 15, dinheiro esquecido R$ 15, currículo R$ 19) passam a nascer **ligados** (migração 024). (2) Subtítulos sem largura máxima dentro dos quadros (acabou a quebra no meio da frase); "Nova carteira" com campos de conta bancária alinhados em grade. (3) **Estratégias:** a tabela de caminhos só mostra os que dão resultado diferente do plano, com nota explicando quando coincidem. (4) **Parcerias:** envio manual de contatos autorizados ao parceiro por lote (até 100), com `lead_deliveries` impedindo reenvio, filtros por situação, repetir/cancelar e visão por parceiro. (5) **Novo Prumo** (prumo torneado com fio, argola, colar e brilho). (6) Passo a passo de Open Finance (`deploy/OPEN-FINANCE-PASSO-A-PASSO.md`) e INPI (`marca/INPI-PASSO-A-PASSO.md`) | Feita |
| D-095 | 2026-10-04 | **Correções do D-094 (entregue pela metade).** (1) **Gestão de parceiros no backoffice** (Parcerias → aba "Parceiros"): cadastrar (empresa, CNPJ, tipo, e-mail do portal e 1ª campanha), editar, suspender/reativar, excluir (só quem nunca recebeu contato; com histórico, suspende), nova senha do portal, campanhas (categoria, estados, vínculos, renda, valor, limite diário, orçamento, webhook https), novo segredo de webhook, excluir campanha sem envio. Senha e segredo aparecem uma única vez. (2) Alinhamento: campos da conta bancária (mesmas linhas por subgrade, sem a margem herdada que desalinhava), filtros e ações de Parcerias (`.bo-filters`), e o "null" no rodapé da aba Envios (rodapé de paginação vazio). (3) **Guias na landing**: preço em cada cartão, link "Guias sob medida" no menu e espera do catálogo de 1,5 s para 4 s (a vitrine sumia em conexão lenta). (4) **Dinheiro esquecido deixou de ser grátis dentro do Mapa:** a seção vira convite ao guia pago (prévia grátis) com o aviso de golpe. (5) Passo a passo de Open Finance e INPI entregues em Word (`entregas/`) | Feita |
| D-096 | 2026-10-04 | **Acesso de 30 dias com direito de refazer (todos os produtos pagos no Pix).** Depois de pagar, a pessoa tem o prazo do produto (padrão 30 dias, editável em Produtos e preços) e, dentro dele, **refaz com dados novos quantas vezes quiser, sem pagar de novo; a data final não muda**. Vale para o Mapa (o formulário volta preenchido; roteiros e cartas são gerados de novo, calendário e estratégias recalculam), o tradutor (outro texto) e os 4 guias (novas respostas). O cliente vê uma **contagem regressiva** (dias; horas no último dia; cor de atenção nos últimos 5 dias) com o botão de refazer, e o aviso aparece antes de pagar (checkout, prévia, FAQ e landing). Teto de proteção de 200 refeitos por acesso. **Backoffice:** nova tela **Acessos e prazos** (ativos, vencem em 7 dias, vencidos, quantas vezes refez; prorrogar +7/+30 dias e encerrar, com auditoria; a prorrogação também adia a eliminação dos dados). Migração 025. Prumo (mensalidade): dados já são editáveis a qualquer momento, sem mudança | Feita |
| D-097 | 2026-10-04 | **Asaas em conta pessoa física, chaves por segredos do GitHub, contas de teste e textos de responsável.** (1) A abertura de MEI deixa de ser pré-requisito: o Asaas é contratado em **CPF** (conta aprovada; o código não depende de PF ou PJ). (2) **Chaves sem passar pelo chat:** a publicação lê os segredos do GitHub (`ASAAS_API_KEY`, `ASAAS_PIX_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_BASE_URL`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`) e grava no `deploy/.env` do servidor com `deploy/ops/mesclar-env.sh` (cópia antes, nenhum valor impresso). Com as três do Asaas presentes, o pagamento passa para `asaas`, o gateway de mentira sai e `REQUIRE_PRODUCTION_KEYS=1` liga os bloqueios do `deploy.sh` (aborta sem Asaas ou Turnstile, mantendo a versão no ar). (3) **Contas de teste (demo):** tela Contas de teste no backoffice; ligada, a conta (já cadastrada: demo@folego.online) tem o Prumo Desbravador e libera produtos avulsos sem Pix nem cartão (pedido com valor 0, provedor `demo`, fora da receita); desligada, volta ao normal; o código de entrada é gerado no backoffice (15 min, uma vez). (4) Rodapé e termos: responsável **Fôlego**, encarregado **suporte@folego.online**, CPF não exibido (a LGPD pede identificar o controlador: confirme com seu advogado se isso basta). Migração 026 | Feita (falta o dono cadastrar os segredos) |
| D-098 | 2026-10-06 | **Dados de quem paga e Meta Conversions API.** Pix: e-mail e celular obrigatórios antes de gerar o código (sem login, sem CPF), criptografados no caso e apagados junto com ele (7 dias sem pagar, 30 dias depois de pago; gatilho no banco). Prumo (cartão): nome, CPF e celular criptografados no cadastro (CPF exigido pelo Asaas); backoffice mostra mascarado e revela com permissão e auditoria. Eventos Lead, InitiateCheckout e Purchase seguem para a Meta (servidor para servidor, e-mail e celular em hash, IP, navegador e fbc do clique) com base no aceite dos termos; PageView anônimo desligado (`META_CAPI_PAGEVIEW`). Token só por segredo do GitHub (`META_CAPI_TOKEN`) | Ativa (revisão jurídica do texto de privacidade pendente) |
| D-099 | 2026-10-08 | **Endereços limpos (sem `/#/`)** no site e no backoffice (`/conta`, `/pagamento`, `/gestao/clientes`); links antigos migram sozinhos; códigos de acesso e descadastro ficam no fragmento (`/acesso#código`). **Assinatura do Prumo em uma tela:** a página segura do Asaas abre em aba nova e a tela do Prumo confirma sozinha; mostra "Assinando como (e-mail)" com troca de conta | Feita |
| D-100 | 2026-10-08 | **Preparação do lançamento:** ação `prontidao` (relatório só de leitura), limpeza de produção também desliga as contas demo e zera descadastros de teste; ambiente local de testes na máquina do dono (`iniciar-local.cmd`, banco em arquivo, dados de exemplo sintéticos via `seed-local.mjs`); produção sem dados de cliente | Feita |
| D-101 | 2026-10-08 | **Lançamento.** Preços da landing seguem o backoffice na hora (padrões de reserva atualizados + cache do último catálogo). Canal de suporte `suporte@folego.online` (rodapé, pagamento, Prumo). Retorno automático do Asaas ao Prumo após pagar (`/conta/plano`), com plano B "aba nova" se o site não estiver cadastrado na conta do Asaas (cadastro depende do token SMS do dono). Extrato em PDF no Prumo (lido no navegador, conferência antes de importar). Alertas de custo de IA e e-mail no card "Sistema saudável" (80% dos limites; limites editáveis em Configurações). Runbook de incidentes no backoffice e em `deploy/RUNBOOK-INCIDENTES.md`. Leads desligado e `SEO_OPEN=1` (site aberto aos buscadores). `BACKUP_PASSPHRASE` cadastrada (cópia criptografada diária). Decisões do dono: advogado aprovou os textos legais; formalização do MEI adiada (opera como pessoa física); Origin CA e endurecimento do servidor exigem root/Cloudflare | Feita |

| D-102 | 2026-10-08 | **Mapa da Virada para quem assina o Prumo.** Controle não muda. **Ousado** vê na tela Dívidas um aviso para liberar o Mapa por **R$ 12,99 no Pix** (valor e **90 dias** de acesso em Produtos e preços > "Mapa da Virada para assinantes"); abre o mesmo formulário da landing (dívidas do Prumo já preenchidas), mostra a prévia grátis e só então cobra. Acabou o prazo, o Mapa se encerra e pode contratar de novo; enquanto ativo, o caminho é "Refazer". **Desbravador** usa o Mapa sem pagar enquanto a assinatura valer (acesso se estende a cada renovação), sem banner de preço nem botão de pagamento. Preço e prazo calculados no servidor (`map-offer.ts`; `order_items.access_days`, `cases.owner_subscriber_id`, pagamento "plan" de valor zero que não vira venda nem evento da Meta); o Mapa fica ligado à conta e some com "apagar minha conta" | Feita |
| D-103 | 2026-10-08 | **Cartões de crédito no Prumo (aba Cartões).** **Ousado:** até 3 cartões com limite, fechamento, vencimento e juros do rotativo; compra à vista ou parcelada (parcelas entram uma por mês e contam no limite); faturas aberta/fechada/vencida/paga; pagar a fatura abate o cartão e, se escolhido, o saldo da conta, sem virar gasto novo; alertas. **Desbravador:** até 10 cartões, fatura em PDF lida no aparelho (compras, parcelas, pagamentos, conferência com o total, sem duplicar), comparação entre faturas, simulação do rotativo, parcelas de 12 meses e estratégias. Regras em `packages/domain/src/cards.ts`, API em `apps/api/src/cards.ts`, migração 034. Leitor testado com PDFs sintéticos; faturas reais podem pedir ajuste | Feita |
| D-104 | 2026-10-08 | **Open Finance completo no código (desligado até haver contrato).** Cartões conectados, pagamento de fatura sem contar em dobro, botão Reconectar, validade do consentimento (12 meses) com e-mail 30 dias antes, webhook `/webhooks/openfinance` (`OPENFINANCE_WEBHOOK_SECRET`; só confere o estado no agregador), revogação no agregador ao apagar a conta, banco de mentira `OPENFINANCE_FAKE=1` (nunca em produção), segredos `PLUGGY_*` pelos Secrets do GitHub, migração 035. **Falta (dono):** contrato e DPA, teste no sandbox, textos jurídicos/RIPD, chaves | Código pronto; aguarda contrato |
| D-105 | 2026-10-10 | **Funil de parceiros, Mercado com bolsas e telas padronizadas.** (1) "Quer ter ainda mais tranquilidade financeira? Fale com um parceiro e tenha ainda mais Fôlego": faixa na landing e nas abas Visão geral e Dívidas do Prumo, e cartão com formulário (nome, telefone, e-mail, consentimento) que também serve a quem não comprou nada; o diagnóstico grátis passa a poder pedir parceiro sem o Mapa pago. Só aparece com a opção de parceiros ligada no backoffice (hoje desligada em produção). (2) Mercado ganha Bolsas pelo mundo: Ibovespa (B3), Nasdaq, NYSE, SSE e Euronext, fechamento diário (Yahoo Finance, sem chave); Ousado vê valor e variação, Desbravador também o gráfico, Controle vê só o bloqueio. (3) Cartões e Metas no mesmo formulário padrão, centralizado e alinhado; Categoria da compra no cartão com "＋ Nova categoria…" como em Lançamentos. (4) Simulador: "Salvar como meta" cria a meta com o valor final, o valor inicial já guardado e o prazo simulado. | Publicado; parceiros seguem desligados até o dono ativar |
| D-106 | 2026-10-10 | **Portal "Euro Multiplan & Fôlego" (segundo backoffice, do parceiro).** Parceira cadastrada e ativa por migração (037, dados do cartão CNPJ 09.242.004/0001-50, EURO MULTIPLAN INTERMEDIACOES, Curitiba/PR) com campanha de consignado **só de portal** (sem webhook): o contato enviado pelo Fôlego aparece na tela dela. Backoffice do Fôlego: campo **"Comissão do Fôlego (% por contrato)"** ao lado de "Valor por contato (R$)" (pontos-base; soma-se ao valor por contato), webhook opcional, nome fantasia/telefone, botão **"Contratos e comissão"** (lista de contratos fechados, valor, % congelado na entrega, **baixa da comissão**) e totais por parceiro. Portal (`/parceiros`, login por e-mail e senha gerada no backoffice, aparece uma vez): Painel (contatos, contratos, conversão, comissão a pagar, funil, meses), Contatos do Fôlego (contatar, descartar, **registrar contrato** com valor, produto, banco, prazo; comissão calculada na hora), **Minha base** (planilhas da Euro, separada dos contatos do Fôlego: busca por nome ou CPF, filtros por etapa/UF do órgão/situação funcional/margem livre, retorno do dia, ficha com notas, ligações e WhatsApp), Contratos e **Importar planilha**. Planilha (.xlsx) lida **no navegador** (sem enviar o arquivo), em lotes de 200; layout da Euro reconhecido sem cabeçalho (colunas A a BO, 987 linhas de exemplo todas válidas) e planilhas com cabeçalho pelo nome das colunas; **sem repetir**: o CPF (completado com zeros) é a chave; repetido no arquivo conta uma vez, existente igual não muda nada, existente diferente só ganha telefone/e-mail/margem novos e preserva etapa e anotações. Dados pessoais da base ficam criptografados (AES-256-GCM, CPF também em HMAC); revogar a autorização de um contato do Fôlego apaga o nome nos contratos e o histórico dele, mantendo valores. Migrações 036 e 037 (037 também liga as propostas de parceiros). Guia e mapa das colunas: `deploy/PORTAL-PARCEIRO-EURO.md`. **Falta (dono):** gerar a senha da Euro (Parcerias > Editar > Gerar nova senha), definir **valor por contato e o % de comissão** da campanha e confirmar o significado das colunas marcadas "a confirmar" | Publicado |
| D-107 | 2026-10-10 | **Ajustes do convite a parceiros.** Frases do banner: "Propostas sem compromisso" e "Crédito rápido e seguro"; aviso "Crédito novo: só faz sentido se reduz o que você paga no total."; **"Crédito consignado"** sempre disponível no formulário (subtítulo "Consignados para CLT, Aposentados e Concursados"); depois de autorizar, o botão passa a ser **"Concluir meu Mapa"** (leva ao mesmo botão de compra: R$ 29,99 no Pix; só assinante Desbravador logado tem o Mapa incluso). Textos da landing não sugerem mais Mapa grátis. A revogação por e-mail deixa de ter botão | Publicado |
| D-108 | 2026-10-10 | **Fale conosco, importação à prova de linha ruim e cadastro de parceiro editável.** (1) Na landing (e em qualquer tela), clicar em "Suporte" ou em `suporte@folego.online` abre uma janela com Nome, E-mail, Telefone e Comentário e o botão **Enviar**; a mensagem vira e-mail para o suporte (resposta direta a quem escreveu), nada é gravado, com limite de uso, Turnstile e isca anti-robô; sem JavaScript o link segue como mailto (`POST /api/contact`). (2) Importação de planilha: a causa da falha era **um e-mail inválido numa linha derrubar o lote inteiro** (200 contatos); agora cada linha é validada separadamente (uma ruim vira "descartada" e as outras entram) e telefone ou e-mail inválido é só descartado, sem barrar o contato. A planilha real (987 linhas) passa 100%. (3) Backoffice, Parcerias > Editar: agora edita o cadastro inteiro, **incluindo o e-mail de acesso ao portal** (a senha continua), CNPJ, cidade e estado; e-mail ou CNPJ repetido é recusado com aviso. (4) `iniciar-local.cmd` passa a gerar o site **sempre** ao iniciar (antes só se a pasta não existisse, e a landing local ficava atrás da publicada); o código local e o do GitHub/VPS estavam idênticos, só havia 21 imagens de carrossel soltas na raiz do GitHub | Publicado |
| D-109 | 2026-10-10 | **Importação corrigida de vez e portal no padrão do backoffice.** (1) A causa real da falha ("Não consegui agora"): o nginx limita o corpo das rotas `/api` a 64 KB e cada lote de 200 contatos tinha ~200 KB, então o servidor devolvia erro 413 sem JSON. O navegador agora monta lotes **por tamanho (até 40 KB, no máximo 250 linhas)**, repete automaticamente em caso de 429/502/503/504 ou queda de rede, e mostra o código do erro quando a resposta não traz mensagem; a rota ganhou limite de uso próprio (1.500 por minuto) para arquivos grandes. Teste ponta a ponta com a planilha real: 987 contatos em 28 lotes (maior 40 KB, simulando o corte de 64 KB), zero falhas e, ao reimportar, 987 "iguais" e nenhum duplicado; teste automático do fatiamento em `apps/web/tests/partner-batch.test.mjs`. (2) Layout de `/parceiros` no padrão do backoffice: barra lateral clara com a marca "Euro Multiplan & fôlego" e a etiqueta Parceiro, menu à esquerda (item ativo em verde-menta), cartões, indicadores com filete lateral, tabelas com cabeçalho em caixa-alta e gaveta lateral para a ficha do contato; site sem cabeçalho/rodapé nessa rota; no celular a barra vira gaveta com botão de menu (fecha ao tocar no conteúdo). Campos, filtros, indicadores e colunas centralizados e alinhados na mesma altura | Publicado |
| D-110 | 2026-10-10 | **WhatsApp no portal do parceiro (envio e recebimento) com gancho para agente de IA.** Decisão: **API oficial da Meta (Cloud API)**, cada parceiro conecta o PRÓPRIO número: sem mensalidade e sem intermediário (a Meta só cobra os modelos de marketing entregues; a conversa que o cliente começa e as respostas em até 24 h não são cobradas); rejeitadas as bibliotecas não oficiais (risco de banimento e violação dos termos, inaceitável para crédito) e o provedor intermediário (só se o volume justificar). Aba **WhatsApp** do portal: Conversas (caixa de entrada com bolhas, não lidas, janela de 24 h visível, encerrar, "não contatar"), Disparos (público por origem, etapa, UF do órgão e margem; cálculo antes de enviar; cancelar fila), Modelos (aprovação marcada no portal) e Conexão (ID do número, token e segredo do app **criptografados**, webhook e token de verificação por parceiro, teste, pausa, teto e silêncio) e Agente de IA. Atalhos "WhatsApp" nos contatos do Fôlego e na ficha da base. **Regras no servidor:** texto livre só na janela de 24 h, fora dela só modelo aprovado; disparo só para quem tem permissão (contato do Fôlego, base marcada "tem permissão" na importação ou na ficha, ou quem escreveu primeiro); SAIR/PARAR encerra na hora e confirma; teto diário (200) e silêncio 20h às 8h; quem recebeu modelo há menos de 3 dias não entra em outro disparo; webhook assinado (`X-Hub-Signature-256`) e idempotente; falha permanente não repete; textos e telefones criptografados, isolamento por parceiro. **Agente de IA:** interface `SalesAgent` pronta e **desligada, sem provedor instalado** (nenhuma chamada de IA); guardas já testadas (só em conversa marcada IA, palavras de passagem, limite por hora, aviso de assistente virtual, falha cai para humano, quem pediu SAIR nunca recebe IA). Migração 038; guia em `deploy/WHATSAPP-PARCEIRO.md`; `WHATSAPP_FAKE=1` só fora de produção. **Falta (parceiro/dono):** o parceiro criar o app e o número na Meta e colar os dados em Conexão; aprovar os modelos na Meta; escolher e instalar o provedor de IA quando quiser | Publicado; aguarda o parceiro conectar o número |
| D-111 | 2026-10-10 | **Painel do parceiro com a visão total da operação e novo menu.** O Painel (`GET /api/partner/summary`, campo novo `overview`) passa a mostrar a operação INTEIRA do parceiro, base própria somada ao que vem do Fôlego: contatos na operação, contratos fechados e ticket médio, volume contratado (e do mês, com variação sobre o mês anterior), **conversão geral** (e por origem), margem livre em aberto, retornos de hoje, não lidas do WhatsApp, comissão do Fôlego a pagar; funil único (base + Fôlego), contratos por mês, quadro "Origem dos contatos" (base × Fôlego × total), WhatsApp dos últimos 30 dias (conversas, não lidas, enviadas, recebidas, taxa de resposta e de leitura), atividade da equipe (ligações, WhatsApp, anotações) e comissão. Grade de 4 colunas com mesma altura, textos centralizados, 2 colunas no celular. **Menu:** Painel, Minha base, Contatos do Fôlego, WhatsApp, Contratos, Importar planilha | Publicado |
| D-112 | 2026-10-10 | **Sino de alertas, cartões padronizados, Nome fantasia e chatbot com IA (FôlIA).** (1) **Sino no backoffice** (canto superior direito; `GET /api/gestao/alertas`, `POST .../alertas/vistos`; `admin/alerts.ts`; tabela `bo_alert_seen`, migração 039): balança com contador enquanto houver alerta não visto; abrir a lista marca como visto e o sino volta ao normal; se o alerta piorar volta a tocar. Monitora: cada falha do "Sistema saudável" (banco, worker, fila, Pix sem processar, e-book, backup, disco, limites de IA/e-mail), cancelamentos (7 dias), assinaturas vencidas sem renovar, vencendo em 3 dias, envios a parceiros com falha, WhatsApp de parceiro com falha/fila parada, contatos do chatbot aguardando e atrasados (+24 h). Cada pessoa só vê o que as suas permissões alcançam. "Sistema saudável" foi para o fim do Painel. (2) **Cartões de indicador com padrão único** (fim de `styles.css`; backoffice, Prumo e portal do parceiro): grade que reparte por igual, mesma altura, rótulo numa linha, número centralizado, subtítulo em linha reservada; no celular o rótulo reserva duas linhas. (3) **Nome fantasia** no lugar da razão social em listas e envios a parceiros (reserva: razão social). (4) **Chatbot "FôlIA"** na landing e no Prumo (`chatbot.ts`; `/api/chat/start|history|message`; `chat_leads`, `chat_messages`): celular com DDD + e-mail + aceite obrigatórios antes da 1ª mensagem, tudo criptografado; prompt = PhD em finanças + secretária executiva + gestora de contas, preços lidos de `app.products` a cada resposta, limites jurídicos e de segredo; filtro de saída; sem chave de IA responde por regras; limites 25/h e 80/dia por conversa e 400 respostas de IA/dia. (5) **Tela "Chatbot"** (permissão `chatbot`): indicadores, funil, lista, transcrição, WhatsApp/telefone/e-mail com mensagem pronta, situação, registro de contato e anotações; convertido automático por e-mail que pagou depois. Guia: `deploy/CHATBOT.md`. |
| D-113 | 2026-10-11 | **Meta Conversions API: pixel certo e PageView anônimo LIGADO (decisão do dono).** O padrão do código era o pixel do navegador (`1643796570757610`); passa a ser o pixel "Folego" da Conversions API, `1085904724208873` (`config.ts`, `env.example`). O deploy grava `META_PIXEL_ID` e `META_CAPI_PAGEVIEW=1` no `.env` do servidor. **LGPD/D-022:** o PageView envia IP e navegador à Meta, então só sai **depois do aceite** no aviso de cookies (`consent.js`, `POST /api/consent`, cookie `folego_ads`; o servidor ignora o PageView sem o cookie). O aviso não bloqueia a página (a landing abre inteira), tem "Aceitar" e "Recusar" com o mesmo peso e diz explicitamente "dados de navegação... compartilhados com a Meta para fins de publicidade"; "Preferências de cookies" no rodapé reabre a escolha; o resumo de Termos e privacidade foi atualizado. Lead/InitiateCheckout/Purchase (dados informados no checkout) seguem como antes (revisão jurídica pendente). Para desligar o PageView: remover `META_CAPI_PAGEVIEW` do `publicar.yml` e do `.env`. |
| D-114 | 2026-10-12 | **Troca de plano sem cancelar, com pró-rata por dia** (`plan-change.ts`, migração 040, `GET /api/account/plan-change/quote`, `POST /api/account/plan-change`, cartão "Trocar de plano" na aba Plano). Diferença = (preço novo − preço atual) × dias que faltam ÷ dias do período já pago. **Upgrade:** paga hoje só a diferença, numa cobrança avulsa na página segura do Asaas (nenhum cartão passa por nós); o plano novo vale quando o pagamento é confirmado (o período e o dia da cobrança NÃO mudam; o pagamento não conta como mensalidade). **Downgrade:** vale na hora e a diferença vira crédito único na próxima fatura (`billing_profiles.plan_credit_cents`, zerado quando essa fatura é paga). Nos meses seguintes, preço cheio do plano escolhido (o `syncPrices` do worker ajusta o valor da assinatura no provedor). Upgrade com diferença abaixo de R$ 5,00 (mínimo do provedor) é liberado sem cobrança extra; a fatura nunca fica abaixo de R$ 5,00. Só para assinatura no cartão em dia (cancelada, em atraso ou sem cartão não troca). Troca abandonada é cancelada ao abrir outra; pagamento tardio dela fica no registro (`plan_change_paid_but_not_pending`) para devolver. |
| D-115 | 2026-10-12 | **Asaas: migração para a conta da empresa (EMEGETECH SOLUCOES EM TECNOLOGIA LTDA, CNPJ 08.896.800/0001-44) pelo plano B: conta nova de Pessoa Jurídica, migrar só depois de aprovada.** Trocar o tipo da conta atual (Pessoa Física) exclui as chaves Pix e exige novos documentos e contas bancárias, o que pararia o Pix do Mapa; por isso não foi feito e nada foi alterado na conta atual. Roteiro, dados do cadastro e a virada (Secrets `ASAAS_*`, webhook, texto do recebedor no modal do Pix) em `deploy/ASAAS-PJ-MIGRACAO.md`. O texto do recebedor só muda junto com a chave. Cartões guardados não migram entre contas: assinantes reais precisam assinar de novo na conta nova. |
| D-116 | 2026-10-12 | **Painel do backoffice: cada indicador é clicável e abre o detalhe do que o número mostra; indicativo animado discreto no chat.** Os cartões do Painel (Visitantes, Diagnósticos, Pagaram, Receita, Ticket médio, Receita recorrente, Assinaturas, Perfil, IA) viram botões acessíveis (teclado, `aria-haspopup`) que abrem uma gaveta com funil, origens, páginas, produtos, métodos, série por dia, planos e segmentos, com atalho para a tela completa respeitando a permissão. Os dados são os mesmos do Painel (sem consulta nova). No chat da FôlIA, uma pílula "Fale com a FôlIA" (letra pequena) aparece 2,5 s depois ao lado do botão redondo, flutua de leve (respeita "reduzir movimento"), some ao abrir o chat e não volta na mesma sessão. |
| D-117 | 2026-10-12 | **WhatsApp do Fôlego pela Bird (+55 11 91379-2370) no convite de indicação do Prumo; e-mail do convite deixa de mentir.** Na aba "Indique e ganhe" o assinante escolhe "pelo meu WhatsApp" (link `wa.me`, sem risco de política) ou "pelo WhatsApp do Fôlego" (modelo `indicacao_prumo` aprovado na Bird, fila no banco, só 8h–20h de Brasília, idempotência, tentativas, status Na fila/Enviada/Entregue/Lida/Falhou, webhook `/webhooks/bird` com assinatura Standard Webhooks, **SAIR** respeitado para sempre, limites 5/dia, 15 no total e 90 dias por telefone, telefone criptografado e achado só por HMAC). Só liga com `BIRD_API_KEY`; sem ela, só o caminho "meu WhatsApp". **Risco assumido e documentado:** convite de amigo não é opt-in do destinatário; a qualidade do número pode cair, por isso a recomendação de ligar aos poucos e vigiar a Qualidade no Meta (`deploy/BIRD-WHATSAPP.md`). O formato exato da API da Bird (autenticação, campo do parâmetro, endereço base, texto recebido) precisa ser confirmado no primeiro envio real. **E-mail do convite:** antes, bloqueio por prazo/descadastro era silencioso e a tela dizia "enviado", e a indicação era gravada antes do envio (falha gastava o convite). Agora a API devolve `sent`/`blocked`, grava só depois de enviar e desfaz se falhar. |

---

## 3. Marca e nome

**Regra inegociável (D-012):** "CODHubs" não aparece em nada público: site, e-mails, certificados TLS, nomes de imagem Docker, rodapés, termos, política de privacidade, nota fiscal.

**Onde o nome "escapa" e o que fazer**

| Vetor | Ação |
|---|---|
| Domínio/URL | Usar o **domínio novo da marca (folego.online)** apontando para 129.121.46.33; `codhubs.com` fica só para o outro projeto |
| Certificado TLS | Emitir só para o domínio novo. Certificados são públicos (Certificate Transparency): um certificado para `codhubs.com` expõe o vínculo |
| DNS reverso (PTR) do IP | Se estiver como `codhubs.com`, pedir ao provedor para trocar ou remover |
| E-mail (SPF/DKIM/DMARC) | Configurar no domínio novo; remetente com a marca nova |
| Cabeçalhos HTTP / páginas de erro | Sem nome interno; página 404/500 com a marca nova |
| Docker (nomes de imagem, rede, volume) e caminhos | Usar nome neutro/novo (ex.: `/srv/<marca>`); internos, mas evitam vazamento em logs e mensagens de erro |
| Usuário Linux do projeto | Criar usuário novo para este projeto; o usuário `codhubs` não deve ser reaproveitado |
| Documentos legais / nota fiscal | Razão social e nome fantasia corretos; **[PENDENTE: CPF ou CNPJ/MEI]** |

**Candidatos a nome** (nenhum foi verificado em Registro.br, INPI ou redes sociais)

| Nome | Ideia | Observação |
|---|---|---|
| **Fôlego** | Alívio de quem está sufocado pelas contas | Combina com "Mapa da Virada" |
| **Prumo** | "Ficar no prumo": equilíbrio, direção | Curto, sério e acolhedor |
| **Clareia** | "Clareia suas contas" | Verbo de ação, tom amigo |
| Destrava | Ação, saída do bloqueio | Comum; risco de já estar em uso |
| Sossego | Resultado emocional | Pode soar como serviço de descanso |
| Respiro | Alívio | Parecido com Fôlego |
| Rumo | Direção | Muito comum |
| Contas Claras | Descritivo, bom para busca | Fraco como marca |

**Decisão (D-018, 2026-09-26): a marca é Fôlego.** O dono registrou **folego.online**.

**Pendências da marca**
1. **INPI:** buscar "Fôlego" nas classes 35, 36 e 42 e conferir empresas homônimas no setor financeiro antes de investir em identidade visual. Este documento não substitui a busca oficial.
2. **DNS:** em 2026-09-26 o domínio ainda não resolvia (nenhum registro configurado). Criar registro A do apex e do `www` apontando para 129.121.46.33; e-mail (SPF, DKIM, DMARC) no mesmo domínio.
3. **Extensão `.online` e `folego.com.br`:** em finanças, parte do público e alguns filtros de e-mail confiam menos em extensões fora de `.com`/`.com.br`; mitigar com HTTPS, e-mail autenticado e página "quem somos" clara. **`folego.com.br` já está registrado por terceiro** (pessoa física, criado em 20/02/2025, com DNS em uso; consulta Whois do Registro.br em 2026-09-26): não está disponível. Isso também é um **sinal para a busca no INPI**: alguém já usa o nome "folego" na internet brasileira. Alternativas a avaliar (todas pagas, decisão do dono): outra extensão (`.com`, `.app`, `.com.br` com variação do nome).
4. **Redes sociais:** reservar o mesmo identificador (@folego...) onde estiver livre.
5. **Identidade:** logotipo, paleta e voz seguem o tom 80% amiga / 20% consultoria (D-011). **[PENDENTE: identidade visual]**
6. **Nomes dos produtos** passam a ser "Fôlego" + entregável (ex.: "Mapa da Virada da Fôlego"); revisar quando a identidade for definida.

---

## 4. Produto e jornada

### 4.1 Catálogo (nomes propostos; podem mudar com a marca)

| Código | Nome sugerido | Preço | O que libera |
|---|---|---|---|
| `recovery_map` | **Mapa da Virada** (alt.: Roteiro de Recuperação Financeira) | R$ 29,00 | Diagnóstico, orçamento mensal, ordem de pagamento, roteiros de negociação por credor, acesso por 30 dias (D-016/D-017) |
| `defense_letters` | **Kit de Cartas e Defesas** | R$ 19,00 | Cartas prontas: prescrição, contestação, enquadramento jurídico. Só ofertado quando o diagnóstico indicar que fazem sentido |
| `calendar_30d` | **Calendário dos 30 dias** | R$ 19,99 | Agenda de ações com datas e lembretes, exportável (.ics/PDF) |
| `extra_income_plan` | **Criador de Renda Extra** | R$ 15,99 | Plano de renda extra por perfil, gerado por IA |
| (bundle) | **Kit Completo** | a testar (ex.: R$ 59,90) | Os três primeiros com desconto |

Observações:
- O dono definiu a escada original (D-004). A proposta de incluir o acesso de 30 dias no Mapa (D-016) foi sugerida porque cobrar acesso ao que já foi pago contradiz "pague só se gostar"; aguarda confirmação.
- **Pix não tem "um clique":** cada upsell gera novo QR Code. Ofertar as cartas como item marcado no checkout (antes de pagar) e também após a entrega.
- Padronizar o formato de preço (ex.: sempre `,90` ou sempre inteiro) e testar variantes (R$ 19 / 29 / 49).

### 4.2 Jornada do organizador de dívidas

| # | Etapa | Detalhe |
|---|---|---|
| 1 | Chegada | Promessa única + 3 selos: sem login, sem CPF, só paga se gostar |
| 2 | Conversa | Formulário guiado (§4.3) |
| 3 | Consentimento | Só os **termos de uso** aqui (checkbox na tela); o documento completo abre se a pessoa quiser |
| 4 | Processamento | 5 a 10 s de animação curta |
| 5 | Preview grátis | Nota de saúde financeira, manchete em reais/meses, 1ª dívida da fila, aviso "possível prescrição" (só a contagem), trecho de roteiro; o resto borrado |
| 6 | Decisão | "Liberar meu Mapa completo por R$ 29 no Pix", âncora de preço ("consultoria custa R$ 200+"), promessa de apagar dados se não comprar |
| 7 | Pagamento | QR Pix na página; confirmação por webhook em segundos |
| 8 | Entrega | Painel web e PDF: diagnóstico, orçamento, ordem de pagamento, roteiros por credor (telefone/WhatsApp/e-mail), cartas modelo, checklist; acesso 30 dias por link mágico |
| 9 | Oferta contextual | Se endividado: guia gratuito de dinheiro esquecido; cartas (se aplicável); renda extra R$ 15,99 |
| 10 | Oferta de crédito (opcional) | §4.7, **consentimento separado** |
| 11 | Volta | Lembrete opcional em 30 dias: "atualizar seu Mapa" |

**Economia de IA:** antes do pagamento quase zero (motor de cálculo + textos-modelo); depois do pagamento a IA gera roteiros, cartas e planos em segundo plano (fila).

### 4.3 Formulário: mobile x desktop

- **Mobile:** um passo por tela.
- **Desktop:** linha do tempo vertical que já nasce completa porém apagada; cada resposta acende o nó e revela o próximo; painel lateral com resumo vivo ("3 dívidas, R$ 8.400"). Sem telas vazias com uma pergunta só.
- Mesmo componente e mesmo estado; muda só o layout (breakpoint).
- Último passo: checkbox dos termos; documento completo abre sob demanda.

**Campos mínimos** (servem ao diagnóstico **e** à qualificação de lead)

| Campo | Para quê |
|---|---|
| Vínculo (aposentado/pensionista INSS, servidor, CLT, autônomo/MEI, outro) | Diagnóstico + elegibilidade de consignado |
| Renda líquida mensal | Diagnóstico + faixa de lead |
| Faixa etária | Limites de idade em consignado |
| UF | Regionalização de campanhas |
| Gastos fixos | Orçamento |
| Dívidas: credor, tipo, saldo, parcela, parcelas restantes, taxa (se souber), dias em atraso, data do 1º atraso | Diagnóstico, prescrição |

Não coletamos CPF, senha nem dados bancários. Nome e telefone **só** se a pessoa optar pela oferta de crédito (§4.7).

### 4.4 Assinatura (fase 4)

| | Controle (R$ 19,99/mês) | Ousado (R$ 39,99/mês) | Desbravador (R$ 59,99/mês) |
|---|---|---|---|
| Controle de gastos e orçamento | ✔ | ✔ | ✔ |
| Importação de extrato (CSV/OFX) | ✔ | ✔ | ✔ |
| Alertas e lembretes | ✔ | ✔ | ✔ |
| Metas e "pé de meia" | | ✔ | ✔ |
| Treinador financeiro (IA) | limitado | ✔ | ✔ |
| Open Finance (contas conectadas) | | | ✔ |
| Simulações de investimento **educacionais** | | | ✔ |

Regras: cancelamento em um clique dentro do app; a promessa "sem assinatura" vale para os avulsos e a assinatura é linha separada com comunicação clara; **investimentos:** recomendação personalizada de valores mobiliários pode exigir registro na CVM, então o conteúdo é educacional e genérico até validar com advogado.

### 4.5 Fluxo "dinheiro esquecido" (complemento)

Fase atual: guia gratuito de instruções e dicas, exibido ao usuário identificado como endividado. Fase 2: versão elaborada e paga (R$ 15 sugeridos) com passo a passo personalizado. Sem acesso a contas gov.br: o preview seria estimativa por questionário, nunca valor real; cuidado com o nicho cheio de golpes.

### 4.6 Módulos da plataforma (o que mais teremos)

Regra de admissão de módulo novo: ele resolve o que a pessoa faz depois de perceber que o dinheiro está apertado?

- 🔴 **Sair do vermelho (núcleo):** Organizador de dívidas (R$ 29); Tradutor de cobrança (R$ 9 a 15; porta de entrada barata e de alta urgência); Calculadora de prescrição (gratuita, gancho).
- 🛡️ **Se proteger:** Cartas prontas de defesa (R$ 9 a 19 cada); Guia de direitos do consumidor endividado (grátis); Detector de golpe de "limpa nome" (grátis).
- 🧭 **Reorganizar a vida:** Orçamento de virada (R$ 19); Renegociador de contas de casa (R$ 15).
- 💰 **Ganhar mais:** Dinheiro esquecido; Currículo por vaga (R$ 19); Renda extra por perfil (R$ 15,99).
- 🛒 **Comprar melhor (depois):** Comparador honesto de financiamento, carro ou plano (R$ 15 a 29).
- 🏪 **B2B/MEI (fase 5):** cobrança de clientes inadimplentes; fluxo de caixa e precificação simples.

### 4.7 Leads para consignado e instituições financeiras

**Riscos que mudam o desenho**
1. **LGPD:** consentimento livre, informado e **específico por finalidade**; não pode ir embutido nos termos nem condicionar a compra.
2. **Superendividamento (Lei 14.181/2021) e CDC:** oferta de crédito a endividado exige cuidado; nada de "crédito fácil", pressão ou promessa enganosa.
3. **Conflito de interesse:** se o banco paga, a plataforma pode passar a empurrar crédito. O produto pago pelo usuário precisa continuar honesto mesmo quando isso não gera lead.
4. **Marca:** "dados mínimos e apagados" e "vendemos leads" só coexistem com transparência total.

Consultar advogado de LGPD e financeiro antes de operar (isto é desenho de produto, não parecer jurídico).

**Modelo: "propostas para você", não "venda de dados"**
- Depois da entrega, simulação honesta ("trocar sua dívida X por crédito mais barato reduziria o custo em R$ Y"). Se não reduz, **não mostra**. O motor calcula isso em `refinance` (§5.7).
- Botão "Quero receber propostas" → tela **separada**, caixa **desmarcada**, categorias (consignado, renegociação, crédito pessoal). Só então pedimos nome e telefone/WhatsApp.
- O parceiro recebe o lead **somente** com consentimento válido para aquela categoria; o usuário revoga quando quiser.
- Transparência: "Recebemos comissão dos parceiros. Isso não muda a ordem do seu Mapa."
- Qualificação mínima de lead: vínculo, faixa de renda, faixa etária, UF, faixa e tipos de dívida, telefone (só com opt-in). **CPF é coletado pelo próprio parceiro** no fluxo dele, nunca por nós.

**Arquitetura de leads:** consentimentos versionados e imutáveis; contato criptografado separado do perfil derivado; parceiros (tenants) com campanhas (critérios, preço por lead, teto diário, webhook); motor de distribuição (consentimento + critérios + teto + máximo de N parceiros por lead + deduplicação); filtro de adequação (`suitability_ok`); portal do parceiro com RLS; auditoria com hash encadeado.

---

## 5. Motor de cálculo das dívidas (especificação v0.1.0)

**Código:** `packages/domain/`. **Estado:** implementado; 27 testes passando; `tsc --noEmit` sem erros (2026-09-26).
Função pura, sem I/O, sem relógio, sem IA: `diagnose(input) → Diagnosis` e `buildPreview(diagnosis, debts) → Preview`.

### 5.1 Entradas e unidades
- Dinheiro em **centavos inteiros**; taxas em **bps ao mês** (1 bps = 0,01% a.m.); datas `YYYY-MM-DD` sem fuso; `asOf` é passado pelo chamador (o motor não lê relógio).
- Perfil: renda líquida, gastos fixos, vínculo, faixa etária, UF.
- Dívida: id, credor, tipo, saldo, parcela mensal, parcelas restantes, taxa mensal, dias em atraso, data do 1º atraso.
- Tipos: `credit_card`, `overdraft`, `personal_loan`, `payroll_loan`, `financing`, `store_credit`, `utility`, `rent`, `other`.
- Validação de invariantes (`EngineInputError`): valores inteiros e não negativos, ids únicos, taxa até 100% a.m., data válida e não futura. Validação de formato/UX fica na camada de contratos (Zod).

### 5.2 Resolução da taxa de cada dívida
1. **Declarada** pelo usuário.
2. **Implícita:** para dívidas parceladas (empréstimo, consignado, financiamento, crédito de loja, outros) com parcela e prazo informados, resolve-se por bisseção a taxa que quita o saldo (tabela Price). Dados inconsistentes (parcela não quita no prazo) descartam a inferência.
3. **Padrão** por tipo (PREMISSA §5.10). Cartão, cheque especial, serviços e aluguel nunca usam taxa implícita.

### 5.3 Simulação
Mensal, determinística, juros arredondados por dívida e por mês. Dois modos:
- **independent (baseline, "seguir como está"):** cada dívida paga só a própria parcela.
- **pooled (plano):** valor mensal fixo (`pool`); pagam-se os mínimos e o restante segue a fila de prioridade. **A parcela de uma dívida quitada "rola" automaticamente** para a próxima.
- **Teto de juros (D-015):** juros acumulados por dívida limitados a uma fração do saldo declarado (cartão 100%; cheque especial e crédito de loja 100% por premissa). Sem teto, cartão a 14% a.m. crescia sem limite e gerava números absurdos.
- Horizonte máximo 600 meses; se não quita, `months = null` (o aviso `baseline_never_pays_off` ou `plan_never_pays_off` é emitido).
- **Invariante testada:** `pago + saldo restante = saldo inicial + juros`.

### 5.4 Prescrição (indicativa, nunca conclusiva)
- Prazo presumido: 5 anos para a maioria; 3 anos para aluguel (PREMISSA §5.10).
- Conta a partir da data do 1º atraso (declarada) ou `asOf − dias em atraso` (derivada).
- Estados: `not_in_default`, `not_prescribed`, `approaching` (faltando até 1 ano), `possible` (prazo atingido).
- **D-014:** dívida `possible` fica **fora** da fila e dos cálculos (`heldAsideIds`, `rank = null`). Motivo: pagar dívida possivelmente prescrita é o erro que o produto quer evitar.
- **Aviso obrigatório ao usuário:** reconhecer a dívida, negociar, pagar parcialmente ou ser acionado judicialmente pode interromper ou reiniciar o prazo. Confirmar com advogado antes de agir. Cada parcela tem a própria data; a mais antiga prescreve primeiro.

### 5.5 Ordem de pagamento (recomendada)
1. **Essenciais em atraso** (moradia, serviços, bem financiado), mais atrasadas primeiro.
2. **Demais por juros decrescentes** (desempate: menor saldo).
3. **Fora da fila:** possível prescrição (§5.4).
Também são calculadas, só para comparação: *avalanche* (juros decrescentes puro) e *snowball* (menor saldo primeiro).

### 5.6 Orçamento e nota de saúde
- **Sobra** = renda − gastos fixos − soma das parcelas declaradas de **todas** as dívidas (premissa conservadora: parcelas das dívidas "de lado" seguem sendo pagas e não são redirecionadas).
- **Extra para dívidas** = 90% da sobra (PREMISSA de produto; o resto é reserva). Se houver déficit, extra = 0 e a lacuna mensal é calculada.
- **Pool** = parcelas das dívidas incluídas + extra.
- **Nota 0–100** = 100 menos quatro penalidades:
  - *Comprometimento de renda* (parcelas ÷ renda): 0 até 15%; sobe linearmente até 40 pontos em 55%.
  - *Atraso*: 0 sem atraso; 8 até 30 dias; 16 até 90; 25 acima de 90.
  - *Juros médios ponderados por saldo*: 0 até 2% a.m.; sobe linearmente até 20 pontos em 10% a.m.
  - *Déficit*: 15 pontos.
  - Faixas: ≥75 sob controle; 50–74 atenção; 25–49 apertado; <25 crítico. O motor devolve **códigos**, os textos ficam na camada de cópia.

### 5.7 Troca por consignado (estimativa e filtro de adequação de leads)
- Só para vínculo elegível (INSS, servidor, CLT). Taxa de referência e prazo em §5.10.
- Candidata: dívida não consignada com taxa ≥ mínimo configurado. Economia = custo de manter (simulação com teto, no mesmo horizonte) − custo do novo empréstimo (parcela Price × prazo).
- Aprovação gulosa por maior economia, com três travas: economia > 0; soma de consignado dentro da margem (35% da renda menos consignado existente); sobra depois da troca ≥ 0.
- `suitabilityOk` alimenta o filtro de leads (§4.7). **É estimativa com taxa de referência, não oferta.**
- Correção registrada: a primeira versão mostrou economia irreal (R$ 146 mil sobre R$ 4,2 mil) por falta de teto de juros; corrigido pela D-015 e coberto por teste de regressão.

### 5.8 Manchete, avisos e confiança
- **Manchete** (uma só, ordem de prioridade): déficit → `monthly_gap`; senão juros poupados > 0 → `interest_saved`; senão quitação → `debt_free_in`; senão `none`.
- **Potencial de negociação:** faixa de 10% a 50% de desconto sobre dívidas em atraso incluídas; rotulado como estimativa que depende do credor. **Não** é a manchete.
- **Avisos** (códigos): `deficit`, `rates_estimated`, `essential_overdue`, `prescription_check_before_paying`, `baseline_never_pays_off`, `plan_never_pays_off`.
- **Confiança:** alta se nenhuma taxa foi estimada; média se menos de 50% do saldo incluído usa taxa padrão; baixa caso contrário.

### 5.9 Preview (o que sai antes do pagamento)
Montado por **lista branca**: versão do motor, quantidade e total de dívidas, nota e faixa, manchete, **primeira** dívida da fila (credor, tipo, saldo, tier), contagem de "possível prescrição", confiança e lista de seções bloqueadas. Teste automatizado garante que não vazam `order`, `plan`, `baseline`, `budget`, `refinance`, `alternatives`, `debts` nem o credor de dívidas fora da primeira posição.

### 5.10 PREMISSAS a validar antes do lançamento
| Premissa | Valor atual | Como validar |
|---|---|---|
| Taxas padrão por tipo (bps a.m.) | cartão 1400, cheque especial 800, empréstimo pessoal 550, consignado 180, financiamento 200, loja 1000, serviços 100, aluguel 100, outros 300 | Séries de taxas de juros do Banco Central; revisar periodicamente |
| Prazos de prescrição | 5 anos (maioria), 3 anos (aluguel) | Advogado |
| Teto de juros | cartão 100% (Lei 14.690/2023), cheque especial e loja 100% (premissa) | Advogado; dados reais |
| Extra para dívidas | 90% da sobra | Teste com usuários |
| Desconto de negociação | 10% a 50% | Dados reais de acordos |
| Consignado (referência) | 200 bps a.m., 36 meses, margem 35% | BC/regras vigentes do consignado (INSS/servidor/CLT) |
| Gatilhos da nota de saúde | §5.6 | Calibrar com casos reais |
| Saldo atual como proxy do "valor original" no teto de juros | — | Perguntar valor original, se relevante |

### 5.11 Limitações conhecidas
- Não trata amortização SAC nem carência; parcela fixa é o modelo.
- Juros de mora e multa de dívidas em atraso entram só via taxa; não há regra separada de multa de 2% e mora de 1%.
- Não verifica valores contra bureaus (não temos CPF, por princípio).
- Prescrição é por dívida, não por parcela.
- O motor não decide se o usuário "deve" contratar crédito; só estima e filtra adequação.

### 5.12 Testes e como rodar
`cd packages/domain && npm i && npm test` (27 testes: matemática Price, taxa implícita, simulação e rolagem, conservação em 200 cenários aleatórios, prescrição, ordem, déficit, confiança, refinanciamento, regressão de números absurdos, vazamento do preview, determinismo, validação, e propriedade "plano nunca paga mais juros que o baseline" em 300 cenários). `npm run demo` imprime um caso completo. `npm run typecheck` roda o `tsc`. Requer Node 22.18+ (type stripping nativo); testado em Node 24.

---

## 6. Arquitetura técnica

Premissas: dev solo, servidor único, Postgres obrigatório, custo baixo, operação simples.

### 6.1 Decisões

| Decisão | Escolha | Por quê | Alternativa descartada |
|---|---|---|---|
| Back-end | **TypeScript + Node 22 + Fastify** | Um idioma no front e no back, SDK da IA, validação compartilhada (Zod), poucos MB de RAM | Go: menos RAM, mais lento para dev solo |
| Front-end | **HTML/CSS/JS nativos** (módulos ES) + esbuild só para empacotar o motor e o QR (D-020) | Zero framework, carrega rápido, menos superfície de erro para dev solo; o motor de cálculo roda igual no navegador (demo) e no servidor | Astro + React: fica como opção para páginas de conteúdo/SEO na fase 2 |
| Arquitetura | **Monólito modular** + 1 worker | Menos processos, deploy único, ACID entre módulos | Microsserviços: overhead sem benefício |
| Banco | **PostgreSQL 18** | `uuidv7()` nativo, RLS, JSONB | — |
| Fila/jobs | **pg-boss** (dentro do Postgres) | Sem Redis; jobs transacionais | Redis + BullMQ: mais um serviço |
| Cache/rate limit | Em memória + tabela + Turnstile | Suficiente nas fases 1–2 | Redis só se escalar horizontalmente |
| PDF | `pdfmake` ou `@react-pdf/renderer` | JS puro, leve | Chromium headless: 300 MB+ por render |
| Pagamento | **Interface `PaymentGateway`**; 1º adaptador Asaas ou Mercado Pago | Troca de provedor sem reescrever; Pix dinâmico + webhook; assinatura depois | Integrar direto ao PSP |
| IA | API da Anthropic: **Haiku 4.5** (classificação/extração), **Sonnet 5** (roteiros, cartas, planos) | Custo × qualidade | Modelo único |
| Arquivos | Disco do servidor + backup; bucket S3-compatível se crescer | Menos peças | — |

### 6.2 Multi-tenancy (parceiros)

| Estratégia | Isolamento | Custo | Escolha |
|---|---|---|---|
| Database por tenant | Máximo | Alto | Não |
| Schema por tenant | Alto | Médio (migrações × N) | Não |
| **RLS em schema único** | Bom, com papel restrito | Mínimo | **Sim**, só em `partner_campaigns` e `lead_deliveries` |

Consumidores **não** são tenants (não têm conta). O parceiro nunca lê `cases`, `lead_profiles` nem `lead_contacts`: recebe o lead por webhook assinado.

### 6.3 Módulos (monólito modular)

```
apps/
  web/                 Astro (landing, guias, calculadoras, fluxo do organizador)
  api/                 Fastify (HTTP) + worker (pg-boss) no mesmo código, 2 processos
packages/
  domain/              regras puras, sem I/O   <- JÁ IMPLEMENTADO (§5)
  contracts/           schemas Zod compartilhados front/back
modules (dentro de api/src):
  intake/  preview/  checkout/  payments/  entitlements/  deliverables/
  ai/  pdf/  consent/  leads/  partners/  audit/  purge/
```
Regra de dependência: `domain` não importa nada; `modules` dependem de `domain` e de interfaces; adaptadores (Postgres, gateway, IA) ficam nas bordas.

### 6.4 Fluxos críticos

**Preview (custo de IA ≈ 0)**
1. `POST /cases` cria sessão anônima (cookie httpOnly, hash no banco) e o caso.
2. `PUT /cases/:id/intake` valida com Zod e grava colunas tipadas + `debts`.
3. `diagnose()` calcula tudo; `buildPreview()` grava **só o seguro** em `diagnoses.preview`.
4. `GET /cases/:id/preview` devolve apenas o preview; o conteúdo pago **não existe** nessa resposta.

**Pagamento e liberação**
1. `POST /orders` com `Idempotency-Key`; congela preço em `order_items`.
2. Gateway gera o Pix; grava `payments` (copia-e-cola, expiração).
3. Webhook: valida assinatura/segredo → `INSERT` em `payment_events` com `UNIQUE (provider, provider_event_id)` (repetição vira no-op) → transação: `payments=confirmed`, `orders=paid`, cria `entitlements`, enfileira `generate_deliverable`.
4. **Confirmação dupla:** o webhook só dispara a consulta ao gateway (`GET payment`); vale a resposta oficial, não o corpo recebido.
5. Worker gera o conteúdo pago (IA + PDF); `deliverables.status = ready`.
6. `GET /cases/:id/deliverables/:code` só responde com `entitlement` não expirado + token válido.

**Retorno sem login:** link mágico (`access_tokens`, 30 dias) mostrado na tela e, se a pessoa quiser, enviado por e-mail. Token aleatório de 32 bytes; no banco fica o SHA-256.

**Lead (fase 3):** tela dedicada com checkbox desmarcado → `consents` (`grant`, categoria, versão do documento) → grava `lead_contacts` (criptografado) e `lead_profiles` (faixas, `suitability_ok` vindo do motor) → job `distribute_lead` (`SELECT … FOR UPDATE` no perfil, campanhas compatíveis, teto diário, máximo de N parceiros, insere `lead_deliveries` com o `consent_id` usado) → job `deliver_webhook` (POST assinado por HMAC, retentativa com backoff). Revogação = nova linha `consents` (`revoke`); o distribuidor consulta `v_current_consents` antes de cada envio.

**Expurgo:** job diário chama `app.purge_expired_cases()`. Prazos: sem compra, 7 dias após a criação; com compra, 30 dias após o último acesso; pedidos e pagamentos ficam pelo prazo fiscal e não contêm dados pessoais além de referências.

### 6.5 Planejador com IA e assinatura (fase 4)

```
Fontes de dados ──► Estado financeiro (Postgres) ◄── Motor determinístico
(import CSV/OFX,        contas, transações,           (orçamento, metas,
 manual, WhatsApp,      metas, orçamentos)             projeções, alertas)
 Open Finance*)                 ▲
                                │ ferramentas (tool use)
                         Treinador de IA (Claude)
                                │
                     Agendador (pg-boss cron)
                  revisão semanal, alerta de meta,
                  mensagem por WhatsApp/e-mail
```
1. **A IA nunca calcula saldo, juros ou projeção**; chama funções do motor e explica o resultado.
2. **A IA age por ferramentas** (`get_budget`, `list_transactions`, `simulate_goal`); não recebe o banco inteiro no prompt.
3. **Rotinas automáticas** (jobs agendados): fechamento semanal, alerta de estouro de categoria, lembrete de meta.
4. **Open Finance** só no plano mais alto, via agregador regulado (ex.: Pluggy, Belvo); custo por conexão a validar antes de prometer.
5. **Cobrança recorrente:** cartão e/ou Pix Automático pelo mesmo gateway; tabelas novas: `accounts`, `subscriptions`, `subscription_invoices`, `transactions`, `goals`, `budgets`. O caso avulso pode ser adotado por uma conta (mesmo e-mail) para não perder o histórico.
6. **Investimentos:** simuladores e conteúdo educacional; nada de indicar produto específico sem validação regulatória.

**Atualização (2026-09-27, doc v1.9):** a Assinatura descrita acima **já foi construída e está em produção** (D-049, D-058), com um desenho mais simples que o esboço original: sem `pg-boss` (a fila já existente em `app.deliverables`, com `FOR UPDATE SKIP LOCKED`, cobre o volume desta VPS), sem tabela `accounts` separada (o assinante É a conta) e sem cobrança recorrente automática ainda (Pix avulso mensal; a pessoa gera um novo a cada ciclo, com lembrete por e-mail 3 dias antes). Estado real das tabelas: `subscribers`, `login_codes`, `subscriptions`, `ledger_entries`, `budget_limits`, `goals` (§7 e `db/migrations/003_assinatura.sql`).

**Plano de evolução (planejado em 2026-09-27 com o skill de arquitetura; NÃO implementado ainda — próxima etapa quando o dono confirmar):**
- **Dados:** `wallets` (carteiras: dinheiro, banco, cartão — hoje é uma carteira implícita única); `ledger_entries.goal_id` (liga um lançamento a uma meta; `goals.saved_cents` deixa de ser um número solto e passa a ser somado dos lançamentos); `goals.completed_at`/`archived_at` (histórico de metas concluídas, hoje não existe); `budget_limits` vira `budget_plans` com chave por mês (hoje o limite é fixo pra sempre); `reminders` (tabela nova, unifica lembretes de conta/prazo de meta/renovação, visitados pelo mesmo worker); `open_finance_connections` (só o schema, reservando o lugar para o recurso "em breve" do Desbravador, sem fornecedor nem lógica ainda).
- **Cobrança recorrente:** por enquanto continua manual (Pix avulso); quando o Asaas entrar (depois do MEI), avaliar assinatura nativa do Asaas como opção adicional — o fluxo manual continua existindo para quem não quer deixar nada salvo. Decisão de produto, não desta sessão.
- **Navegação:** `#/conta` vira uma mini-SPA com abas próprias (`#/conta`, `/carteiras`, `/metas`, `/lembretes`, `/treinador`, `/simulador`, `/plano`), reaproveitando o padrão visual da barra de âncoras que o Mapa já usa, mas com rotas reais (porque passa a ter ações, não só leitura).
- **Planejador com IA:** mesma superfície do treinador por regras já construído (`GET /account/coach`), diferenciado por um campo `source: 'rules' | 'ai'`; a IA recebe só os fatos que o motor já calculou (nunca dado bruto do ledger), mesma disciplina dos roteiros de negociação.
- **Extensibilidade:** recurso novo = valor novo em `Feature` (`packages/domain/src/account.ts`) entrando no array de um plano; `requireFeature()` já aplica o bloqueio sozinho, sem arquitetura nova.
- **Sessão multi-aparelho:** reusa o link de acesso já existente para os avulsos (D-043: token de 256 bits, só o hash gravado) em vez de mecanismo novo — troca só o que ele resolve (assinante em vez de caso).

**Atualização (2026-09-27, doc v1.11):** desta lista, foram feitos o layout em abas com rotas reais (`#/conta/<aba>`) e as **metas com aportes**; o aporte virou tabela própria (`goal_contributions`) em vez de `goal_id` no ledger (D-061). Continuam planejados: carteiras, orçamento por mês, lembretes, schema de Open Finance, planejador de IA e cobrança recorrente.

### 6.6 Front-end: landing e fluxo (E0), estado em 2026-09-26

**Onde:** `apps/web/`. **Como rodar:** `cd apps/web && npm i && npm run dev` (abre em `http://localhost:4173`); `npm run contrast` confere o contraste das cores; `npm run build` empacota o motor e o QR, gera `apps/web/dist` (pacote com hash, ver D-032) e é **obrigatório antes de empacotar para o servidor**. O desenvolvimento local (`apps/api`, `npm run dev`) continua usando os módulos soltos de `apps/web`, sem `dist`.

**Situação (atualizada):** o front-end tem **dois modos**, escolhidos por `assets/config.js`: **simulado** (`API_BASE = null`, site estático sem back-end; o motor roda no navegador e **não protege** o conteúdo pago, só serve para demonstração) e **API real** (`API_BASE = '/api'`, `assets/js/api-http.js`; o resultado completo só sai do servidor depois do Pix confirmado, §6.4 e §6.7). O servidor de desenvolvimento da API serve a página já no modo real. Em produção o deploy grava `API_BASE = '/api'` e `DEV = false` (o aviso de demonstração e o botão "simular pagamento" somem).

**Telas e rotas** (por `#`): `#/` landing · `#/diagnostico` formulário · `#/processando` · `#/resultado` preview grátis · `#/pagamento` Pix · `#/mapa` entrega. Voltar/avançar do navegador funciona; recarregar restaura o diagnóstico a partir do rascunho (`sessionStorage`); quem já pagou e volta ao pagamento é levado ao Mapa.

**Direção de design:** "editorial calmo": papel quente, tinta verde-escura, uma cor de ação, muito respiro; tom 80% amiga esperta / 20% consultoria (D-011). Sem gradientes chamativos nem visual de template.
- **Tipografia:** Fraunces (títulos, calorosa; com itálico) + Figtree (texto). Corpo em 17 px, escala fluida, `text-wrap: balance`.
- **Cores (claro / escuro):** papel `#F6F3EC` / `#0E1714`; superfície `#FFFFFF` / `#15221E`; tinta `#13231D` / `#EAF1EC`; ação `#0E5B49` / `#5FD6AB`; bordas de campo `#78867F` / `#6A8479` (3:1 exigido para componentes). Tons de situação: ok, atenção, apertado, urgente (cada um com cor **e** texto, nunca só cor). Tema escuro automático (`prefers-color-scheme`).
- **Movimento:** entrada suave ao rolar, medidor que enche, nó da linha do tempo que "acende", respiração no processamento; tudo respeita `prefers-reduced-motion`.
- **Componentes:** botões (primário, secundário, discreto, perigo; 48 a 56 px), cartões, pílulas de situação, medidor semicircular, campos com máscara de dinheiro, cartões de escolha, cartão de dívida repetível com "detalhes opcionais", linha do tempo/passos, resumo vivo, barra de compra fixa (celular), QR + copia e cola, diálogos nativos (`<dialog>`), aviso rápido (toast), barra de orçamento, linha do tempo de quitação.

**Formulário (D-005):** seis passos. Celular (< 1024 px): um passo por vez, barra de progresso e botões fixos no rodapé. Desktop (≥ 1024 px): linha do tempo vertical, passos futuros apagados e inativos, concluídos com resumo e "Editar", painel lateral "O que você contou" com a sobra do mês em tempo real. Validação com mensagem amigável, campo marcado como inválido, foco no primeiro erro e anúncio para leitor de tela. Detalhes opcionais (parcelas restantes, juros, mês do 1º atraso) ficam recolhidos para reduzir atrito. Termos: caixa na tela final, com o resumo em janela sob demanda (minuta).

**Preview:** nota (medidor), manchete, primeira dívida da fila, aviso de possível prescrição (só a contagem), nota de confiança quando há taxas estimadas, lista do que vem no Mapa com **esqueletos que não contêm conteúdo real** (nada escondido por CSS). A "simulação de troca por crédito" fica de fora (é fluxo opt-in separado, §4.7). Botão "Apagar meus dados agora" sempre à vista.

**Pagamento:** resumo do pedido; item extra "Kit de Cartas e Defesas" só é oferecido quando o motor indica dívida possivelmente prescrita; Pix com QR, copia e cola, validade de 30 minutos, estado "aguardando"/"expirado"; **aviso visível de ambiente de demonstração** (o código não é um Pix real).

**Entrega:** resumo, ordem de pagamento (com motivo, taxa e origem da taxa), orçamento em barra, linha do tempo de quitação, avisos (déficit, dívida que não acaba, prescrição), "Salvar em PDF" (impressão com folha de estilo própria), guia gratuito de dinheiro esquecido (fontes oficiais; aviso contra golpes). Roteiros e cartas aparecem como "em preparação": a geração por IA ainda não existe.

**Qualidade verificada (2026-09-26):**
- Motor: 27 testes passando (§5.12).
- Acessibilidade: axe-core (WCAG 2.0/2.1 A e AA + boas práticas) com **0 violações** em landing, formulário, resultado, pagamento e entrega, em desktop claro e celular escuro. Dois problemas encontrados no caminho e corrigidos (lista de definição com botão dentro; duas regiões com o mesmo nome).
- Contraste: `npm run contrast` verifica todos os pares de cor nos dois temas (texto 4,5:1; componentes 3:1).
- Sem rolagem horizontal em 375 px. Teclado: link "pular para o conteúdo", foco visível, passos futuros `inert`, foco levado ao título do passo. Suporte a `forced-colors` e impressão.
- Fluxo ponta a ponta testado com dois perfis (CLT com cinco dívidas; aposentado do INSS com uma).

**Bugs de implementação já corrigidos (para não repetir):** o `deploy.sh` apagava a pasta `site` montada no container do Nginx (o Nginx passava a ver tudo vazio e respondia `403`; agora só o conteúdo é trocado e há checagem da página inicial); o botão "Apagar meus dados" dependia do evento `close` do `<dialog>`, que não disparou no navegador de teste (agora usa o clique direto); scripts velhos presos no cache do Cloudflare (D-032); marcar o `<body>` com o mesmo atributo usado para alternar telas escondia a página inteira; regex com barra invertida quebrou o servidor de desenvolvimento.

**Ainda não feito neste front-end:** gateway Pix real; Turnstile; textos legais definitivos; razão social e contato do encarregado no rodapé; `og:image`, `robots.txt`, `sitemap.xml`; medição de funil; teste com usuários; teste em dispositivos reais e navegadores diversos (feito só em um navegador de desenvolvimento).

### 6.7 Back-end: API (E3), estado em 2026-09-26

**Onde:** `apps/api/`. **Rodar:** `cd apps/api && npm i && npm run dev` (abre em `http://localhost:3000`, já servindo a página; banco em memória; pagamento simulado). **Testar:** `npm test` (43 testes, banco em memória) e `npm run typecheck`. Node 22.18+.

**Rotas:** `POST /api/cases` (cria sessão e caso, devolve **só o preview**) · `GET /api/cases/:id/preview` · `DELETE /api/cases/:id` · `POST /api/orders` (exige `Idempotency-Key`) · `GET /api/orders/:id` · `GET /api/orders/:id/delivery` (conteúdo pago) · `POST /webhooks/pix` (gateway) · `GET /api/health` · `POST /api/dev/pay/:orderId` (**só fora de produção**; passa pelo mesmo caminho do webhook real).

**Como o conteúdo pago fica protegido:** o diagnóstico completo é gravado em `deliverables` (status `pending`) na criação do caso e só é lido por `GET /api/orders/:id/delivery` quando o pedido está `paid` **e** existe `entitlement` não expirado **e** o pedido é da sessão do requisitante. Antes disso a resposta é `402` sem nenhum dado.

**Garantias cobertas por teste:** preview sem `order/plan/baseline/budget/...` nem credores fora da fila; escrita sem `x-folego` recusada (`403`); cookie `HttpOnly` + `SameSite=Lax`; validação de entrada com mensagens por campo; **"hoje" definido pelo servidor** (data do cliente ignorada); isolamento entre sessões (`404`, sem revelar existência); pedido idempotente; **preços vindos do banco**; cartas só quando há dívida possivelmente prescrita (`422` caso contrário); `402` antes do pagamento e `200` depois; webhook com assinatura inválida (`401`); **evento repetido não libera duas vezes**; webhook **não confia no corpo** (reconsulta o provedor); entitlement expirado (`403`); apagar caso remove dados e mantém o pedido; expurgo por prazo; consentimento com **hash** de IP; limite de taxa (`429`).

**Verificado no navegador (2026-09-26):** fluxo completo com a API real e sob a CSP de produção: preview, pedido com item extra (R$ 48,00 calculado pelo servidor), Pix, entrega; tentativa de abrir a entrega antes de pagar deu `402`, com CSRF `403` e pedido inexistente `404`.

**Segurança de borda:** limite de taxa (300/min geral; 12/min criar caso; 20/min criar pedido), CSP e cabeçalhos idênticos aos do Nginx (`src/security.ts`), `Cache-Control: no-store` em `/api`, corpo máximo de 64 KB, logs sem cookie.

**Asaas (D-026):** classe `AsaasGateway` em `src/gateway.ts`, escolhida por `PAYMENT_PROVIDER=asaas` (variáveis `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_PIX_KEY`, `ASAAS_WEBHOOK_TOKEN`). Autenticação do webhook pelo cabeçalho `asaas-access-token` (comparação em tempo constante); eventos aceitos: `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED`; demais eventos recebem `200` e são ignorados. Erros do provedor viram `502` **sem repassar o corpo** (pode citar dados da conta) e o pedido não fica órfão. O front-end gera o QR a partir do `payload` (copia e cola) devolvido. Testes cobrem: formato da requisição (sem cliente/CPF), valor pago menor que o do pedido **não libera**, provedor fora do ar durante o webhook (`502` e a retentativa libera), duplicata só depois de resolvido, token errado (`401`), e a configuração (produção sem `asaas` falha ao subir).

**Ainda não feito:** validar o adaptador contra o **sandbox real** do Asaas; worker/fila (pg-boss) e geração dos roteiros e cartas por IA (os entregáveis extras ficam `pending`); Turnstile; login do banco com privilégio mínimo (`app_rw`; hoje a API usa o dono do banco); migrações versionadas (hoje `db/schema.sql` roda na criação do banco); RLS e papéis do schema ainda **não testados** em Postgres real; e-mail do link mágico; funil (`funnel_events`).

### 6.8 Geração em segundo plano: roteiros e cartas (2026-09-27)

**Fluxo:** o pagamento confirmado (`confirmPayment`) grava o entregável `negotiation_scripts` como `pending` (os roteiros fazem parte do Mapa de R$ 29, D-017) e, se o Kit foi comprado, `defense_letters`. O worker (`src/worker.ts`; embutido na API em desenvolvimento) pega um por vez, gera e grava em `deliverables.content`. `GET /api/orders/:id/delivery` devolve `generated: { scripts, letters }` com `status` (`pending`, `generating`, `ready`, `failed`), `source` (`ai` ou `template`) e o conteúdo quando pronto. O front-end consulta a cada 4 s (por ~10 min) e **troca só as seções** de roteiros e cartas.

**Arquivos (`apps/api/src/generation/`):** `facts.ts` (fatos calculados por código; só valores e categorias), `schema.ts` (formato dos roteiros e cartas), `templates.ts` (modelos determinísticos de roteiro e as cartas), `guardrails.ts` (verificador), `ai.ts` (cliente do Claude com saída estruturada por ferramenta; modelo padrão `claude-sonnet-5` em `AI_MODEL`), `worker.ts` (fila e geração), `setup.ts`.

**Conteúdo dos roteiros (um por dívida da fila, na ordem de prioridade):** resumo, "antes de ligar", abertura, argumentos, proposta, mensagem pronta (WhatsApp/e-mail) com botão de copiar, o que evitar e o que fazer se recusarem. Propostas numéricas (abertura, alvo e limite, com os descontos) existem só para dívida **em atraso que não seja conta essencial**; contas essenciais em atraso recebem proposta de parcelar o atraso dentro do teto mensal; dívidas em dia recebem roteiro de redução de juros. Dívida possivelmente prescrita **não recebe roteiro**: só um aviso. Há dicas gerais e o teto mensal para todos os acordos somados.

**Cartas (só com o Kit):** notificação de prazo/negativação (só para dívida possivelmente prescrita, sem reconhecer a dívida), pedido de informações e memória de cálculo (dívida em atraso ou prescrição próxima) e contestação de juros e encargos (cartão, cheque especial, empréstimo pessoal e crediário em atraso). Com botões de copiar e baixar `.txt`.

**Resiliência:** falha do worker volta o item para a fila com espera (30 s × tentativas) e desiste em `failed` na 5ª (o front-end mostra "não conseguimos preparar agora"); trabalho `generating` parado há mais de 10 min é retomado; IA fora do ar, reprovada ou acima do teto diário cai no modelo determinístico.

**Verificado:** 18 novos testes (43 no total do back-end): privacidade do que vai à IA, o verificador (valor, porcentagem, lei, promessa, link, "limpar nome", ids), o cliente do Claude com resposta simulada (requisição, ferramenta obrigatória, erro HTTP, falta de `tool_use`, formato inválido, feedback na 2ª tentativa), os modelos passando no mesmo verificador, fila ponta a ponta, reprovação com fallback, teto diário, cartas só com o Kit e sem IA, backoff e retomada. No navegador (API real + worker): 3 roteiros e 6 cartas, sem `{{credor}}` sobrando, valores do motor, e **0 violações no axe** nos temas claro e escuro. **Na produção:** `deploy/remote/check-worker.sh` rodou o `scripts/smoke.ts` dentro do container contra o Postgres real: pagamento confirmado, roteiros e cartas prontos em 2 s (origem `template`, IA desligada), todas as verificações OK e o caso de teste apagado.

**Ainda não feito:** validar a IA com uma **chave real** (a Anthropic exige conta e chave; sem chave o sistema usa os modelos, que é o comportamento padrão) e revisar por advogado os textos das cartas; medir custo por caso quando a IA for ligada (o worker registra origem, modelo e tokens em `generation_meta`); download em PDF/DOCX das cartas (hoje `.txt` e impressão).

### 6.9 Criador de Renda Extra 2.0 (D-059, 2026-09-27)

**Por quê:** o produto original (fase 1, catálogo estático em `packages/domain/src/income.ts`) entregava uma lista genérica de ideias e um plano de 4 semanas igual para todo mundo — fraco para R$ 15,99. Reconstruído via `/anthropic-skills:gerador-de-ideias` (brainstorm A/B/C com o dono) escolhendo a **direção C** (produto de plataforma, com dados prontos para parcerias futuras), com duas condições explícitas do dono: **nenhuma IA antes do pagamento** e tom de **empreender, não vender**.

**Fluxo:** a oferta pré-compra continua uma chamada simples, sem prévia gerada por IA (`apps/web/assets/js/catalog.js`). Depois do pagamento, `GET /api/orders/:id/delivery` devolve `generated.income.status = 'needs_interview'` e o front-end (`apps/web/assets/js/income.js`) mostra um formulário curto (habilidades, horas/semana, capital disponível, veículo, presencial/online/tanto faz, tentativas anteriores, nome, telefone, e-mail opcional, e uma caixa **separada e desmarcada** para autorizar contato sobre parcerias de capacitação). `POST /api/cases/:id/income-interview` grava a entrevista (`app.income_interviews`), grava o contato como lead criptografado (reaproveitando `app.lead_contacts`/`leadDocumentId` de D-010) e, só se a caixa de parceiros foi marcada, grava um consentimento (`app.consents`, `purpose='lead_sharing'`, categoria **`empreendedorismo`**) usando a mesma tabela e o mesmo endpoint de revogação dos leads financeiros — sem nenhum código novo de entrega a parceiro, porque o pipeline (`app.partner_campaigns`, `deliverPendingLeads`) já é agnóstico de categoria. O entregável `extra_income_plan` volta a `pending` e o worker (`apps/api/src/generation/worker.ts`, função `generateIncome`) gera o plano.

**Motor (`packages/domain/src/income.ts`, reescrito):** `buildIncomeFacts(diagnosis, profile, interview)` filtra as ideias candidatas do catálogo pelo tipo de vínculo e pelo modo de trabalho informado, calcula a projeção mensal **só por código** (nunca a IA) para categorias por hora (faixa de horas × taxa de referência), e monta as listas de valores e plataformas que qualquer texto gerado pode citar. `buildIncomePlanTemplate(facts)` é o modelo 100% determinístico (idea, plataformas, taxa, 4 semanas com tarefas por categoria, cuidados) usado quando a IA está desligada, falha, é reprovada ou o teto diário é atingido.

**IA e verificador (`apps/api/src/generation/income-*.ts`):** mesma disciplina das cartas e dos roteiros — a IA (`AnthropicIncomeGenerator`, ferramenta forçada `entregar_plano_de_renda_extra`) só escreve texto (nota de abertura, "porquê" personalizado, uma frase extra por semana, incentivo final) sobre a ideia e os números que o motor já escolheu; nunca inventa valor, plataforma ou promessa. `checkIncomeText` rejeita: `ideaId` fora da lista de candidatas, qualquer valor ou plataforma fora das listas permitidas, "ficar rico"/"renda fácil"/pirâmide, e o número errado de notas semanais. Falha na 1ª tentativa gera retentativa com o motivo da reprovação; falha na 2ª cai no modelo. Defesa contra injeção: o prompt deixa explícito que os campos livres da entrevista (habilidades, tentativas anteriores) são só dado, nunca instrução.

**Progresso:** cada tarefa das 4 semanas tem uma chave (`w{semana}t{tarefa}`); `POST /api/cases/:id/income-progress` marca/desmarca e persiste em `generation_meta.progress`, só depois do plano estar `ready`. Reenviar a entrevista (a pessoa pode corrigir algo) descarta o plano antigo e refaz do zero.

**Banco:** `db/migrations/004_renda_extra.sql` — tabela `app.income_interviews` (uma por caso); `partner_campaigns.consent_category` e `partners.category` passam a aceitar `empreendedorismo`/`capacitacao`.

**Verificado:** 21 testes novos em `apps/api/tests/income.test.ts` (77 no total do back-end) — privacidade do que vai à IA, projeção crescendo com mais horas, verificador aprovando o modelo e rejeitando cada regra nova, cliente do Claude, ponta a ponta com o worker (`needs_interview` → `pending` → `ready`), consentimento de parceiro só quando a caixa é marcada, contato sempre criptografado no banco, IA válida gravada e IA reprovada caindo no modelo, progresso só depois de pronto. Front-end: build completo sem erros (`scripts/build.mjs`).

**Ainda não feito:** parcerias reais de capacitação (SEBRAE, escolas técnicas, faculdades) — a captura de consentimento fica pronta, sem nenhum parceiro cadastrado ainda; revisão do texto do formulário por quem for negociar essas parcerias.

### 6.10 Backoffice (D-063, 2026-09-28)

**Acesso:** `folego.online/gestao`. Login por código no e-mail (`POST /api/gestao/login-code` e `/login`); sessão vale 12 h e some se o usuário for desativado. Sem `ADMIN_EMAILS` e sem usuário cadastrado, ninguém entra. O primeiro dono é o e-mail listado em `ADMIN_EMAILS`; depois, em Configurações → Usuários e permissões, o dono cria os demais (a pessoa entra com o próprio e-mail, sem senha).

**Código:** `apps/api/src/admin/` (`auth.ts`, `permissions.ts`, `metrics.ts`, `customers.ts`, `manage.ts`, `marketing.ts`, `events.ts`, `routes.ts`) e `apps/api/src/runtime.ts`. Front-end: `apps/web/gestao/index.html`, `apps/web/assets/js/admin/` (uma tela por assunto em `screens/`) e `apps/web/assets/admin.css`, empacotado pelo `build.mjs` com hash no nome.

**Como ler o funil:** "Visitaram" e "Começaram" vêm do rastreamento anônimo (só existem depois de ligado); do diagnóstico em diante os números vêm dos registros reais de casos, pedidos e pagamentos. "Em débito" é a assinatura que venceu sem renovar. "Receita recorrente" é a soma dos planos pagando, por mês.

**Marketing:** cada insight é uma regra sobre os dados dos últimos N dias, com o número que a sustenta e ações; o botão "Planejar" leva a ideia ao quadro. Públicos mostram só o tamanho, o canal possível e a base legal (assinantes: relacionamento com quem tem conta; compradores avulsos são anônimos e só podem ser abordados dentro do site; leads: só com consentimento da categoria).

**Ainda não feito:** envio de e-mail de campanha pelo backoffice (exigiria descadastro e base legal por público), exportação de listas, cobrança recorrente automática e outros meios de pagamento (o painel já mostra por meio quando existirem), retenção/limpeza de `app.events` (hoje ficam), e revisão jurídica do texto de rastreamento na política de privacidade.
---

## 7. Banco de dados

**Arquivo:** `db/schema.sql` (v0.1). PostgreSQL 18 (`uuidv7()` nativo; em 16/17 gerar UUIDv7 na aplicação e remover os `DEFAULT uuidv7()`).
**Validação:** rodou sem erro em Postgres 17 embutido (PGlite) com `uuidv7()` trocado por `gen_random_uuid()`; expurgo e auditoria imutável testados. Aplicado sem erro em **Postgres 18 real** no servidor (2026-09-26); RLS e papéis ainda **não** exercitados.

| Grupo | Tabelas |
|---|---|
| Sessão e legal | `sessions`, `legal_documents` |
| Caso | `cases`, `debts`, `diagnoses` (preview), `deliverables` (pago) |
| Comércio | `products`, `orders`, `order_items`, `payments`, `payment_events`, `entitlements`, `access_tokens` |
| Consentimento e leads | `consents` (append-only), `v_current_consents`, `lead_contacts`, `lead_profiles` |
| Parceiros | `partners`, `partner_users`, `partner_campaigns`, `lead_deliveries` |
| Operação | `audit_log` (hash encadeado, imutável), `funnel_events`, função `purge_expired_cases()` |
| Papéis | `app_rw` (API/worker), `partner_portal` (RLS por `app.partner_id`) |

Regras: valores em centavos; preview e conteúdo pago em tabelas **separadas**; `UNIQUE (case_id, partner_id)` impede reenvio; limite de N parceiros por lead aplicado na aplicação com `FOR UPDATE` no perfil.

---

## 8. Infraestrutura e servidor

### 8.1 Servidor (dados fornecidos pelo dono em 2026-09-26)
- **IP:** 129.121.46.33 (dedicado; antes usado pelo projeto CODHubs, que fica para depois).
- **Acesso SSH:** porta **22022**, autenticação **só por chave**. O painel do provedor mostra usuário `root`; a mensagem anterior citava o usuário `codhubs`. **[PENDENTE: confirmar qual usuário existe e como será o acesso deste projeto]**
- **Estado após limpeza:** 0 containers, 0 imagens, 0 volumes, `/srv` vazio, 181 GB livres; removidos `/srv/codhubs`, certificados Let's Encrypt, cache de build e arquivos enviados à pasta pessoal.
- **Mantido de propósito:** Docker 29.8; SSH por chave na 22022; firewall com 80 e 443 abertos.
- **Memória reservada (huge pages):** 1.100 páginas grandes (~2,2 GB de RAM) reservadas pelo `bootstrap` antigo. Este projeto **usa** PostgreSQL, então a reserva é útil: configurar `huge_pages = try` e manter `shared_buffers` dentro do reservado (até ~2 GB). Se a reserva não for usada, ela desperdiça RAM; medir com `grep Huge /proc/meminfo` depois do Postgres subir.
- **Docker `no-new-privileges` por padrão:** pode atrapalhar imagens que precisem elevar privilégios. A imagem oficial do Postgres deve funcionar; testar no primeiro `up`.
- **Servidor (medido em 2026-09-26):** Ubuntu 22.04.5, 4 vCPU, 7,8 GiB de RAM, disco de 196 GB (180 GB livres), Docker 29.8.1 e Compose 5.5.1, OpenSSH 8.9p1 na porta 22022. Só a porta 22022 estava em escuta antes da primeira implantação; nenhum container.
- **Permissões do `codhubs`:** `sudo` sem senha apenas para `/usr/bin/docker` e `/srv/codhubs/app/infra/scripts/*` (caminho do projeto antigo, hoje inexistente; só o root cria `/srv/codhubs`, então a regra é inofensiva, mas vale o dono remover). O `ssh-keyscan` do Windows não conversa com o servidor; o `ssh` normal sim. Aviso inofensivo do `sudo`: "unable to resolve host" (o nome do servidor não está no `/etc/hosts`).
- **Acesso do assistente (D-029):** login `codhubs` com a chave `codhubs_vps_ed25519` da pasta `.ssh` do dono; o servidor já estava no `known_hosts` (verificação estrita de identidade). Uma conexão por vez.
- **Pasta do projeto no servidor:** `/home/codhubs/folego` (dados do banco no volume Docker `deploy_pgdata`).

### 8.2 Ações recomendadas no servidor (ainda **não executadas**)
1. Criar usuário de deploy próprio deste projeto (nome neutro, sem "codhubs"); depois desativar login de `root` por SSH mantendo a chave.
2. Firewall: manter 80/443 e a porta SSH; **5432 nunca exposta** (Postgres só em `127.0.0.1`).
3. Instalar fail2ban (SSH) e atualizações automáticas de segurança.
4. Nginx no host + certbot para o **domínio novo**; ver §3 sobre `codhubs.com`.
5. Diretório `/srv/<marca>` e rede/volumes Docker com nomes neutros.
6. Backup diário fora do servidor.

### 8.3 Processos (Docker Compose, versão inicial; recalibrar limites com a RAM real)

```yaml
# deploy/docker-compose.yml
services:
  postgres:
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app_owner
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_owner_password
    secrets: [pg_owner_password]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./postgresql.conf:/etc/postgresql/postgresql.conf:ro
    command: ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
    ports: ["127.0.0.1:5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app_owner -d app"]
      interval: 10s
    shm_size: 256mb
    mem_limit: 1800m

  api:
    image: registry.local/app-api:${TAG}
    restart: unless-stopped
    env_file: .env.api
    depends_on: { postgres: { condition: service_healthy } }
    ports: ["127.0.0.1:3000:3000"]
    mem_limit: 400m

  worker:
    image: registry.local/app-api:${TAG}
    command: ["node", "dist/worker.js"]
    restart: unless-stopped
    env_file: .env.api
    depends_on: { postgres: { condition: service_healthy } }
    mem_limit: 500m

secrets:
  pg_owner_password:
    file: ./secrets/pg_owner_password

volumes:
  pgdata:
```
O front estático é servido pelo Nginx do host. **PgBouncer não é necessário agora:** 2 processos Node com pool pequeno (`max` 10 e 5); entra com mais de ~50 conexões concorrentes.

### 8.4 PostgreSQL (assumindo 4 GB de RAM; recalibrar com a RAM real)

```conf
# deploy/postgresql.conf
listen_addresses = '*'
max_connections = 50
shared_buffers = 1GB
effective_cache_size = 2500MB
work_mem = 16MB
maintenance_work_mem = 256MB
huge_pages = try                # aproveita as páginas grandes reservadas no host
wal_compression = on
max_wal_size = 2GB
checkpoint_timeout = 15min
checkpoint_completion_target = 0.9
random_page_cost = 1.1          # SSD
effective_io_concurrency = 200
autovacuum_max_workers = 3
log_min_duration_statement = 300ms
shared_preload_libraries = 'pg_stat_statements'
```

### 8.5 Nginx (host) + SSL

```nginx
# /etc/nginx/sites-available/folego.conf
server {
  listen 80;
  server_name folego.online www.folego.online;
  return 301 https://folego.online$request_uri;
}
server {
  listen 443 ssl http2;
  server_name folego.online;
  ssl_certificate     /etc/letsencrypt/live/folego.online/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/folego.online/privkey.pem;

  root /var/www/app/web;               # build do Astro
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;
  add_header Strict-Transport-Security "max-age=31536000" always;

  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 2m;
  }
  location /webhooks/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Real-IP $remote_addr;
  }
  location / { try_files $uri $uri/ /index.html; }
}
```
Certificado: `certbot --nginx -d folego.online -d www.folego.online` (renovação automática pelo timer do certbot).

### 8.6 Backup e observabilidade
- **Backup:** `pg_dump -Fc` diário + arquivamento de WAL se quiser recuperação pontual; cópia **fora do servidor** (bucket); testar restauração todo mês.
- **Logs:** JSON estruturado (pino) para stdout; `docker logs` com rotação (`max-size: 10m`, `max-file: 5`).
- **Métricas:** `/metrics` (prom-client) + Uptime Kuma externo; alertas: pagamento confirmado sem entrega em 5 min, fila parada, disco > 80%, erro de webhook.
- **Negócio:** eventos em `funnel_events` → conversão por etapa e por variante de preço.


### 8.7 DNS e Cloudflare (estado em 2026-09-26)

- **Registro do domínio:** `folego.online` registrado no **HostGator** (Portal do Cliente). Nameservers atuais: `dns3.hostgator.com.br` e `dns4.hostgator.com.br`.
- **Cloudflare:** conta do dono; `folego.online` adicionado no **plano Free (US$ 0)**; status **pendente** até os nameservers serem trocados. Não contratar planos pagos nem o "Advanced Certificate Manager" (o SSL universal gratuito cobre o domínio raiz e o `www`).
- **Registros na zona do Cloudflare:** `A folego.online → 129.121.46.33` (proxy ligado, **já ajustado**); `CNAME www → folego.online` (proxy ligado, mantido). Restam registros herdados do HostGator que devem ser **excluídos**: `CNAME ftp`, `CNAME mail` e `MX folego.online`.
- **Nameservers a configurar no HostGator** (substituir os dois atuais): `katelyn.ns.cloudflare.com` e `vern.ns.cloudflare.com`. **Feito pelo dono em 2026-09-26.** (O sistema de permissões bloqueou a alteração de DNS por automação; a etapa foi executada pelo dono.)
- **Depois da ativação:** (1) e-mail anti-falsificação até haver provedor de e-mail: TXT `v=spf1 -all` no domínio raiz e TXT `_dmarc` com `v=DMARC1; p=reject`; ao configurar o e-mail transacional, atualizar SPF/DKIM/DMARC; (2) SSL/TLS do Cloudflare em **Full (strict)** com certificado de origem (Cloudflare Origin CA) instalado no Nginx; (3) Nginx com `server` padrão que responde 444 para hosts desconhecidos; (4) liberar 80/443 no firewall só para os IPs do Cloudflare; (5) DNSSEC: manter desligado no HostGator antes da troca e religar pelo Cloudflare depois.
- **Estado após a troca (2026-09-26):** zona com só `A @ → 129.121.46.33` e `CNAME www → folego.online`, ambos com proxy. O painel do Cloudflare mostra "Waiting for your registrar to propagate your new nameservers". Consultas públicas ainda dão `SERVFAIL` em alguns resolvedores (1.1.1.1, 8.8.8.8) e o antigo IP em outros (9.9.9.9); o servidor do Cloudflare já responde certo e não há DS (DNSSEC) no registro. É a transição normal; conferir de novo depois de algumas horas.
- **Atenção:** a zona `codhubs.com` (mesma conta) ainda tem registros apontando para 129.121.46.33 (ex.: `admin.codhubs.com`, com proxy). Enquanto isso for verdade, requisições a esses nomes chegam ao servidor deste projeto. O Nginx precisa recusá-las (item 3) e o dono deve decidir se remove esses registros. Nada foi alterado em `codhubs.com`.

### 8.8 Implantação (kit em `deploy/`, executado em 2026-09-26)

**O que roda (tudo em containers, sem root):** `postgres:18` (banco, **sem porta publicada**), `deploy-api` (Node 24, sem porta publicada), `deploy-worker` (mesma imagem, gera roteiros e cartas; D-037) e `nginx:1.27-alpine` (portas 80 e 443). Arquivos: `Dockerfile.api`, `docker-compose.yml`, `postgresql.conf`, `nginx/folego.conf`, `env.example`, `deploy.sh`, `remote/inventory.sh` (levantamento só de leitura) e `remote/check-worker.sh` (estado do worker + teste de fumaça da geração; usar `< /dev/null` no `docker compose exec` para ele não engolir o resto do roteiro). O `.dockerignore` fica na raiz.

**Resultado da primeira implantação:** o schema aplicou sem erro num **Postgres 18 real** (RLS e papéis ainda não exercitados), a API subiu saudável e o site respondeu de fora, pelo Cloudflare. Verificado com `curl` (2026-09-26): `https://folego.online/api/health` = 200 (`db: postgres`, `env: production`, `gateway: fake`); `https://folego.online/` = 200; `www` redireciona (301) para o domínio principal; cabeçalhos de segurança e CSP presentes; **acesso direto ao IP é derrubado**; `assets/config.js` de produção ativo (`DEV = false`); a rota `/api/dev/pay` **não existe** (404).

**Como publicar uma nova versão** (do computador do dono; **uma conexão por vez**):
1. `cd apps/web && npm run build` (gera `apps/web/dist` com o pacote de hash; o `deploy.sh` recusa continuar se `dist` não existir).
2. Na raiz do projeto: `tar -czf folego.tgz --exclude=node_modules --exclude=.git --exclude=.claude --exclude="*.log" --exclude=deploy/.env --exclude=deploy/certs --exclude=deploy/site --exclude=deploy/nginx/cloudflare-ips.conf apps deploy db packages .dockerignore`.
3. Enviar e extrair sem apagar segredos nem dados: `ssh -i <chave> -p 22022 codhubs@129.121.46.33 "cd ~/folego && tar -xzf -" < folego.tgz`.
4. Publicar: `ssh ... "cd ~/folego && bash deploy/deploy.sh"`. O script é idempotente: gera `deploy/.env` (segredos aleatórios, permissão 600) e o certificado autoassinado só se não existirem, baixa as faixas de IP do Cloudflare, copia o site estático (gravando `API_BASE='/api'` e `DEV=false`), sobe/atualiza o Compose, recarrega o Nginx e confere `/api/health`.

**Configurar o Asaas (feito pelo dono, com o servidor no ar):**
1. No painel do Asaas (sandbox primeiro): gerar a chave de API e criar uma **chave Pix aleatória** na conta.
2. Cadastrar o **webhook**: URL `https://folego.online/webhooks/pix`, eventos de cobrança **recebida** e **confirmada**, e um token de 32+ caracteres (é o `ASAAS_WEBHOOK_TOKEN`; **não** é a chave da API). O Asaas pausa a fila depois de 15 falhas seguidas e guarda eventos por 14 dias.
3. No `deploy/.env` **do servidor**: `PAYMENT_PROVIDER=asaas`, apagar `ALLOW_FAKE_GATEWAY_IN_PRODUCTION`, e preencher `ASAAS_API_KEY`, `ASAAS_BASE_URL` (sandbox: `https://api-sandbox.asaas.com/v3`), `ASAAS_PIX_KEY` e `ASAAS_WEBHOOK_TOKEN`. **A chave do Asaas começa com `$`: colocar entre aspas simples**, senão o Docker interpreta o `$` como variável e corrompe a chave sem avisar (a API registra um aviso se não começar com `$aact_`). **Nunca colar chaves no chat.**
4. `cd ~/folego/deploy && sudo docker compose up -d` e testar um pagamento no sandbox (o sandbox tem `POST /v3/pix/qrCodes/pay`, que exige chave Pix cadastrada na conta de destino).
5. Só depois trocar para a chave e a URL de **produção**.

**IA dos roteiros (opcional, depois do Asaas):** para ligar, criar a chave na Anthropic e pôr no `deploy/.env` **do servidor** `ANTHROPIC_API_KEY=...` (e, se quiser, `AI_MODEL` e `AI_MAX_CALLS_PER_DAY`), depois `sudo docker compose up -d`. Sem a chave tudo funciona com os modelos. Nunca colar a chave no chat. O worker registra no log `ia: <modelo>` ao iniciar.

**Lançamento:** remover o `X-Robots-Tag` de `nginx/folego.conf` e o `apps/web/robots.txt` (D-031); trocar para o certificado Origin CA e o modo "Full (strict)" (D-030); conferir os textos legais, a razão social e o contato do encarregado no rodapé.

**Cache e Cloudflare (2026-09-26):** o Cloudflare força ~4 h de cache em `.js` (o cabeçalho `max-age=14400` chega ao navegador mesmo com `no-cache` na origem; provavelmente a configuração "Browser Cache TTL"). Por isso os arquivos do pacote têm **hash no nome** (URL nova a cada versão) e só o `index.html` e o `config.js` mudam de conteúdo. O Cloudflare também injeta o script de análise `beacon.min.js`; a CSP o **bloqueia** (gera um erro inofensivo no console e impede o envio de dados dos visitantes, coerente com D-022). Para o erro sumir, desligar a injeção automática em Web Analytics no painel do Cloudflare (**ação do dono**).

**Cuidados:** manter `deploy/.env` fora de qualquer pacote e de qualquer versionamento; a política CSP existe em dois lugares (`apps/api/src/security.ts` e `nginx/folego.conf`) e precisa ficar igual; as faixas de IP do Cloudflare mudam raramente (o `deploy.sh` as baixa a cada publicação); sem `PAYMENT_PROVIDER=asaas` o servidor só sobe com `ALLOW_FAKE_GATEWAY_IN_PRODUCTION=1` e nenhum Pix é real.

---

## 9. Segurança, LGPD e conformidade

| Tema | Medida |
|---|---|
| Trava de conteúdo | Servidor só envia conteúdo pago com entitlement; preview em coluna/tabela separada; preview montado por lista branca (§5.9) |
| Dados em repouso | Contato criptografado na aplicação (AES-256-GCM, chave fora do banco); disco criptografado se possível |
| Tokens | Só hash no banco; comparação em tempo constante |
| Webhooks de entrada | Segredo + reconsulta ao gateway + idempotência |
| Webhooks de saída | HMAC por campanha, timestamp, retentativa limitada |
| Abuso | Turnstile no início do formulário, rate limit por IP/sessão, teto diário de previews |
| Dados enviados à IA | Sem nome, telefone, CPF ou e-mail; só valores e categorias. Provedor no exterior = transferência internacional: constar no aviso de privacidade |
| Logs | Sem corpo de requisição com dados financeiros; correlação por `case_id` |
| Auditoria | `audit_log` com hash encadeado; consentimentos e entregas append-only |
| Encarregado/RIPD | Definir encarregado (DPO) e elaborar RIPD antes da fase 3 |
| Prescrição / conteúdo jurídico | Texto revisado por advogado; sempre "pode estar prescrita", nunca "está" |
| Investimentos | Educacional; sem indicar produto específico (CVM) |
| Superendividamento | Ofertas de crédito só quando reduzem custo (§4.7) |

---

## 10. Roadmap e status

| Fase | Entrega | Status |
|---|---|---|
| Descoberta | Ideia, domínio, jornada, preços, arquitetura | ✅ Concluída |
| **E1 (motor)** | `debt-engine` com testes | ✅ **v0.1.0 pronto, 27 testes** |
| Marca | Nome e domínio ✅ (Fôlego, folego.online); INPI, DNS e identidade visual ⏳ (§3) |
| Servidor | Usuário de deploy, firewall, Nginx, domínio novo, TLS | ⏳ Pendente (§8.2) |
| E0 | Landing + preview + Pix (testar R$ 19/29/49) | Front-end ✅, back-end ✅ e **no ar em folego.online** (pré-lançamento, pagamento de mentira, §8.8); Asaas real e testes de preço ⏳ |
| E2 | Intake completo (timeline/passos) + preview automático (≤ 2 s, sem IA) | ✅ |
| E3 | Checkout Pix + webhook idempotente + entitlements | ✅ com gateway de mentira (17 testes); adaptador real ⏳ |
| E4 | Geração pós-pagamento (IA + PDF) + link mágico (< 60 s) | ✅ Roteiros, cartas (PDF no navegador), Renda Extra com IA e link de acesso em produção |
| E5 | Upsells (cartas, calendário, renda extra) + bundle | Upsells ✅ (D-044); bundle e teste de preços ⏳ |
| E6 | Consentimento + leads + portal do parceiro (após revisão jurídica) | Construído (D-050); **desligado** (`LEADS_ENABLED=0`) até a revisão jurídica |
| E7 | Assinatura (Prumo) + coach + planejador com IA | ✅ **Prumo em produção em modo simulado** (D-049 a D-088): coach, dívidas, carteiras, lembretes, orçamento, cobranças, "e se...?", planejador IA, mercado, conta compartilhada, eBook, indicações. **Falta ligar a cobrança real (Asaas, aguarda o MEI)**. Open Finance: não construído |
| Fase 5 | B2B/MEI, comparadores de compra | Comparador de financiamento ✅ (desligado, D-093); B2B/MEI descartado |

Critérios de pronto: E1 revisado por você contra planilha; E3 pagamento duplicado não gera duas entregas; E4 entrega em < 60 s.

---

## 11. Pendências e perguntas em aberto

1. ~~Nome da marca e domínio~~ **Resolvido (D-018).** Restam: busca no INPI (agora reforçada: `folego.com.br` tem outro dono), redes sociais e identidade visual (§3).
1a. ~~DNS/Cloudflare~~ **Feito pelo dono (2026-09-26):** registros herdados excluídos e nameservers trocados. Aguardando a propagação (Cloudflare: "Waiting for your registrar to propagate"; de 1 a 24 h) (§8.7).
2. **Acesso ao servidor:** usuário a usar (`root` do painel x `codhubs`), chave para este projeto; especificação (CPU/RAM/SO) (§8.1).
3. ~~CPF ou CNPJ/MEI~~ **Resolvido (D-026): MEI.** Restam: confirmar com o contador se a atividade (CNAE) do MEI cobre este serviço, o teto anual de faturamento do MEI (conferir o valor vigente) e a emissão de nota fiscal do município.
4. **Conta Asaas (dono):** abrir a conta como MEI, gerar a chave de API do **sandbox** e cadastrar uma **chave Pix aleatória**; depois cadastrar o webhook (§8.8). As chaves vão **direto no `.env` do servidor**, nunca no chat.
5. **Provedor de e-mail transacional** (sugestão: Resend ou Amazon SES).
6. **D-016 e D-017** (acesso de 30 dias incluso; roteiros nos R$ 29).
7. **Validar premissas do motor** (§5.10), principalmente taxas padrão e prazos de prescrição.
8. **Revisão jurídica** (LGPD, superendividamento, prescrição, consignado, CVM) antes de operar leads e de publicar textos jurídicos.
10. ~~Implantação no servidor~~ **Feita e verificada (2026-09-26, §8.8).** Restam: configurar o Asaas no servidor (§8.8), remover o `noindex` no lançamento, trocar para Origin CA + Full (strict) e, se quiser, desligar o Web Analytics automático do Cloudflare.
10a. ~~Gateway Pix real~~ **Adaptador do Asaas implementado e testado com provedor simulado (25 testes)**; falta validar contra o **sandbox** do Asaas (formato real das respostas e do webhook).
10b. ~~Worker e geração dos roteiros~~ **Feitos (§6.8).** Restam: ligar a IA com chave real (opcional), revisão jurídica das cartas, PDF/DOCX das cartas, Turnstile e medição de funil (`funnel_events`).
10c. ~~Cinco agregadores (Tradutor de Cobrança, e-mail, Kit Completo, assinatura, leads)~~ **Construídos e testados (D-046 a D-051, §14).** Tradutor e Kit Completo já valem em produção; e-mail, assinatura e leads estão no código mas **desligados** (env vars `RESEND_API_KEY`, `SUBSCRIPTIONS_ENABLED`, `LEADS_ENABLED`, `PARTNER_ADMIN_TOKEN`, todas em `deploy/env.example`). Restam: revisão jurídica dos leads e das cartas, contratar Resend, revisar os textos do Tradutor com advogado.
11. **Publicação:** textos legais definitivos (hoje é minuta), razão social/CNPJ e contato do encarregado no rodapé, `og:image`, `robots.txt` e `sitemap.xml`, teste com usuários reais.
9. ~~Onde guardar o projeto~~ **Resolvido em 2026-09-26:** pasta permanente `C:\Users\mzend\Projeto Finanças`.

---

## 11A. Checklist de lançamento público (revisão total de 2026-10-03, D-089)

**Bloqueia o lançamento**
1. **MEI + conta Asaas** (produção): chave de API, chave Pix, webhook com os 5 eventos (`deploy/GO-LIVE-ASAAS.md`); teste ponta a ponta no sandbox; trocar `PAYMENT_PROVIDER=asaas` e **remover** `ALLOW_FAKE_GATEWAY_IN_PRODUCTION` (some o "Simular pagamento").
2. **Textos legais definitivos** (revisão por advogado): Termos de Uso, Política de Privacidade, Política de Cancelamento/Reembolso (inclui "sem devolução do mês em andamento", retenção de 15 dias, indicações, eBook), cookies/rastreamento anônimo, dados enviados à IA (transferência internacional). Hoje é uma minuta em diálogo.
3. **Identificação no rodapé:** razão social, CNPJ, canal de contato e encarregado (DPO) da LGPD; RIPD elaborado.
4. **Parceiros/leads:** `LEADS_ENABLED` está **ligado** em produção sem revisão jurídica e sem nenhum parceiro contratado. Decidir: desligar até haver parceiro e parecer, ou manter só a coleta de interesse com texto aprovado.
5. **Limpar os dados de teste de produção** — **ferramenta pronta** (`deploy/ops/limpar-teste.*`, ação `limpar_dados_de_teste` do workflow Operações): faz backup, apaga clientes/pedidos/casos/eventos e confere que configuração, dono, produtos, e-books e textos legais ficaram intactos (desfaz sozinha se algo mudar). **Falta executar na véspera do lançamento** (exige digitar LIMPAR).
6. **Backup automático fora do servidor + restauração testada** — **pronto**: `deploy/ops/backup.sh` (diário 03:15 UTC, guarda 14), `restore-test.sh` (semanal, restaura num banco temporário e compara), ação `instalar_rotinas`. Cópia **externa**: o workflow gera uma cópia criptografada (AES-256) como artefato do GitHub por 14 dias, diariamente, **se o segredo `BACKUP_PASSPHRASE` existir**. **Falta (você):** criar esse segredo e decidir se prefere um destino definitivo (bucket R2/S3).
7. **Monitoramento e alertas** — **pronto**: `/api/health/deep` (banco, worker, fila de entregas, eventos de pagamento, e-book, backup, disco), card "Sistema saudável" no Painel e workflow **Monitor** a cada 10 min (falhou = e-mail do GitHub ao dono). **Falta:** alerta de custo da IA/e-mail (item 15) e, se quiser, aviso por WhatsApp/Telegram.
8. **Nota fiscal do MEI** (NFS-e) e rotina de conciliação financeira/contador.
9. **Endurecer o servidor** — **parcial**: nginx já responde 444 a hosts desconhecidos e só aceita IPs do Cloudflare; CSP atualizada. **Script pronto** `deploy/ops/endurecer-servidor.sh` (fail2ban, atualizações automáticas, SSH só por chave, ufw) — **precisa ser executado como root** (o usuário de deploy não tem). Continua pendente: Cloudflare Origin CA + Full (strict) e a decisão sobre os registros de `codhubs.com`.
10. **Abrir a indexação** — **preparado e FECHADO de propósito**: `og:image` + cartão do Twitter, `sitemap.xml`, `robots-open.txt` (mantém `/gestao` e `/api/` bloqueados) e chave `SEO_OPEN` no `.env` do servidor. Enquanto `SEO_OPEN` não for `1`, o site continua `noindex`. **Virar para 1 só no lançamento**, com o Asaas real ligado.
11. **Validar as premissas do motor** (§5.10: taxas padrão, prescrição, teto de juros) e revisar com advogado cartas, tradutor, prescrição e consignado.
12. **Canal de suporte** (e-mail/WhatsApp) e processo de atendimento ao titular de dados (acesso, correção, exclusão); política de contestação de cobrança (chargeback).

**Para funcionar 100% sozinho (autonomia)**
13. **Cobrança recorrente real** e rotina de inadimplência: cartão recusado já avisa; falta política de tentativas, suspensão e reativação confirmadas no Asaas real.
14. **Anti-abuso (Turnstile)** — **código pronto e desligado**: protege criar diagnóstico, código de acesso e envio de link por e-mail; falha aberta se o Cloudflare estiver fora. **Falta (você):** criar o widget no painel do Cloudflare e colar `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET` pelo Terminal. Limites de custo da IA conferidos em produção continuam pendentes.
15. **Alertas de custo** (IA e e-mail) e orçamento mensal máximo.
16. **Testes automatizados de navegador** (fluxos críticos: diagnóstico → Pix, assinatura, cancelamento) e checklist de regressão antes de cada publicação.
17. **Rotina de manutenção**: atualização de dependências, rotação de segredos, restauração de backup trimestral, revisão mensal das taxas do motor.
18. **Runbook de incidentes** (site fora, webhook falhando, vazamento, chargeback) e quem faz o quê.

**Construído mas dependendo de você para ligar (D-093)**
- **Guias das fases futuras** (financiamento, contas de casa, dinheiro esquecido, currículo): prontos e **desligados**. Decidir preço e textos legais de cada um e ligar em Produtos e preços; revisão jurídica dos textos de "informação geral" e de CET/tarifas.
- **Open Finance:** código pronto e **desligado**. Falta contratar o agregador (custo por conexão a validar), receber as chaves, testar no ambiente de testes dele (login de teste, importação, revogação), conferir o endereço do widget e a CSP, atualizar Termos/Política (transferência de dados, retenção) e fazer o RIPD. Só então ligar.
- **Identidade visual:** arquivos prontos em `marca/`. Falta **depositar a marca no INPI** (depende do CNPJ/MEI e da busca de anterioridade, que não consegui fazer) e **abrir/reservar os perfis** nas redes (eu não crio contas).

**Fora do escopo atual (mencionado, não construído)**
- B2B/MEI (cobrança de clientes: **descartado** em D-088 para freelancers), cartões de crédito no Open Finance, versão em aplicativo nas lojas.

---

## 12. Riscos

| Risco | Mitigação |
|---|---|
| Número errado no preview destrói a confiança | Motor puro, testado, com teto de juros e teste de regressão; nunca gerar número por IA |
| Prescrição mal explicada | Revisão por advogado; linguagem "pode estar prescrita"; aviso de reinício do prazo |
| Custo de IA disparar | IA só após pagamento; limite por caso; custo registrado em `generation_meta` |
| Servidor único = ponto único de falha | Backup fora do servidor + restauração testada; réplica só se justificar |
| Fraude no Pix/webhook falso | Reconsulta ao gateway + idempotência + segredo |
| Vazamento do nome CODHubs | Checklist §3 antes de publicar qualquer coisa |
| Conflito de interesse com parceiros de crédito | Recomendação independente; mostrar troca só quando reduz custo; transparência sobre comissão |
| Premissas erradas (taxas, prazos) | Lista §5.10, revisão periódica e validação antes do lançamento |

---

## 13. Fontes dos artefatos de código

| Artefato | Caminho | Versão |
|---|---|---|
| Motor de cálculo | `packages/domain/` | 0.1.0 |
| Schema do banco | `db/schema.sql` | 0.1 |
| Landing e fluxo (front-end) | `apps/web/` | 0.2 (modo simulado ou API real, por `assets/config.js`) |
| API (back-end) | `apps/api/` | 0.1 (17 testes) |
| Implantação | `deploy/` | 0.2 (executada em 2026-09-26; ver §8.8) |
| Deploy (compose, conf, nginx) | trechos em §8 (arquivos em `deploy/` ainda não criados) | 0.1 |

---

## 14. Changelog

| Data | Versão | Mudança |
|---|---|---|
| 2026-09-26 | 0.1 | Brainstorm, escolha do domínio (organizador de dívidas), jornada, catálogo, arquitetura e schema em três documentos separados |
| 2026-09-26 | 0.2 | **Consolidação em documento único.** Adicionados: dados do servidor e nome CODHubs (D-012, §3, §8), motor de cálculo v0.1.0 (§5), teto de juros (D-015), prescrição fora dos cálculos (D-014), registro de decisões (§2), pendências (§11), riscos (§12). Documentos antigos 01 e 02 removidos |
| 2026-09-26 | 0.2.1 | Projeto movido para a pasta permanente `C:\Users\mzend\Projeto Finanças` (pendência 9 resolvida) |
| 2026-09-26 | 0.3 | Marca definida: **Fôlego**, domínio **folego.online** (D-018); pendências de marca detalhadas em §3; Nginx/certbot atualizados para folego.online; DNS ainda não configurado |
| 2026-09-26 | 0.4 | `folego.com.br` verificado: indisponível (D-019). `folego.online` adicionado ao Cloudflare (Free), registro A ajustado; limpeza de registros herdados e troca de nameservers pendentes (§8.7). Landing page em construção em `apps/web` |
| 2026-09-26 | 0.5 | Landing e fluxo completo em `apps/web` (front-end com API simulada): design system, formulário linha do tempo/passos, preview, Pix de demonstração e entrega; axe-core sem violações; decisões D-020 a D-022 (§6.6) |
| 2026-09-26 | 0.6 | DNS trocado pelo dono (aguardando propagação). Back-end real em `apps/api` (17 testes; paywall no servidor validado no navegador), front-end com dois modos, kit `deploy/` (não testado); decisões D-023 a D-025 (§6.7, §8.8) |
| 2026-09-26 | 0.7 | Venda como MEI e gateway Asaas (D-026): adaptador com QR estático de uso único, reconsulta e conferência de valor (25 testes); webhook resolve só o que foi confirmado (D-028); provedor `fake` proibido em produção sem autorização; acesso SSH `deploy` com chave dedicada (D-027, aguardando o dono); kit `deploy/` com variáveis do Asaas |
| 2026-09-26 | 0.8 | **Primeira implantação**: site no ar em `https://folego.online` (Cloudflare → Nginx, API e Postgres 18 em containers), sem root (D-029); Nginx só aceita o Cloudflare (D-030); pré-lançamento com `noindex` (D-031); servidor medido (4 vCPU, 7,8 GiB); kit `deploy/` reescrito para Docker-only; `setup-server.sh` removido |
| 2026-09-26 | 0.9 | Correções em produção: botão "Apagar meus dados" (clique direto e falha honesta), aviso de demonstração em produção, e **build com hash em `apps/web/dist`** para escapar do cache de 4 h do Cloudflare (D-032, D-033); Nginx com cache longo só no pacote com hash; testes de fumaça completos na produção (8 verificações no Postgres real) |
| 2026-09-27 | 1.0 | **Worker e geração de roteiros e cartas** (D-034 a D-037; §6.8): fila na tabela `deliverables`, IA opcional com verificador e plano B determinístico, cartas por modelos fixos, container do worker, seções de roteiros e cartas na entrega com atualização automática; 43 testes; fumaça na produção OK. Web Analytics do Cloudflare desligado (D-038) |
| 2026-09-27 | 1.1 | Card de descobertas no preview (D-039) e cartas em PDF no navegador (D-040). Testes: domínio 28, API 43, web 6. Em produção e verificado |
| 2026-09-27 | 1.2 | PDF das cartas redesenhado com marca-d'água (D-041) e simulação de pagamento em produção no pré-lançamento (D-042) |
| 2026-09-27 | 1.3 | Acesso sem cadastro: `/api/me` e link de acesso (D-043); complementos à venda depois do Mapa, Calendário 30 dias (.ics) e Renda Extra (D-044); ferramentas grátis (D-045). Testes: domínio 35, API 48, web 6 |
| 2026-09-27 | 1.4 | Cinco agregadores novos: Tradutor de Cobrança (D-046), e-mail transacional (D-047), Kit Completo (D-048), assinatura com controle de gastos/metas/treinador/simulador (D-049) e leads para consignado (D-050, ambos desligados por padrão), mais migrações versionadas (D-051). Testes: domínio 48, API 66, web 6. Em produção; recursos novos verificados OFF por padrão (`/api/features`) |
| 2026-09-27 | 1.5 | Correção do botão de Pix que não atualizava o valor ao marcar complementos (D-052) |
| 2026-09-27 | 1.6 | Tradutor de Cobrança: importar de PDF (D-053). Corrigido bug de implantação pré-existente do worker do pdf.js em produção (D-054) — a partir de agora, mudanças que envolvem `assets/vendor/` são testadas contra o `dist/` real, não só o modo desenvolvimento |
| 2026-09-27 | 1.7 | Tradutor de Cobrança lê foto por OCR local (D-055); CSP libera WebAssembly com `'wasm-unsafe-eval'` (D-056); builds agora dão nome único aos arquivos do pdf.js/tesseract.js para o Cloudflare nunca servir versão velha, e o deploy recria o Nginx em vez de só recarregar (D-057); domínio de e-mail verificado, falta só a chave (D-058) |
| 2026-09-27 | 1.8 | E-mail (Resend) e assinatura ativados e verificados em produção (D-058) |
| 2026-09-27 | 1.9 | Plano de evolução da Assinatura (§6.5): carteiras, meta com lançamentos vinculados, orçamento por mês, lembretes, reserva de schema para Open Finance, navegação em abas, planejador com IA na mesma superfície do treinador, sessão multi-aparelho via link de acesso. Planejado, ainda não implementado |
| 2026-09-27 | 1.10 | Criador de Renda Extra 2.0 (D-059, §6.9): reconstrução completa via `/anthropic-skills:gerador-de-ideias` — sem IA antes do pagamento, entrevista pós-compra, motor com ideias filtradas por vínculo/modo, IA com verificador dedicado (tom "empreender", nunca "ficar rico"), checklist de progresso, captura de lead com consentimento próprio para futuras parcerias de capacitação (categoria `empreendedorismo`, sem parceiro real ainda). Testes: domínio 50, API 77, web 6. Em produção e verificado ao vivo; corrigidos o texto "null" na tela do Mapa/conta e o cache do `index.html` (D-060) |
| 2026-09-27 | 1.11 | Assinatura: área da conta em abas com layout novo, botão de renovar, metas com aportes (D-061, primeira etapa da §6.5). Testes: domínio 50, API 79, web 6 |
| 2026-09-28 | 1.12 | Backoffice /gestao com painel de indicadores, clientes, assinaturas, jornada, parcerias, produtos e preços editáveis, marketing e configurações com usuários e permissões (D-063); IA em produção corrigida com o workspace da Anthropic (D-062). Testes: domínio 50, API 95, web 6 |
| 2026-09-29 | 1.13 | Repositório oficial no GitHub, privado: github.com/mzendonadi/folego (D-064) |
| 2026-10-02 | 1.14 | Estratégias no Mapa, calendário com marcos e para Google/iPhone/Outlook, Renda Extra escrita por inteiro pela IA, campo "Outra" (D-065) |
| 2026-10-02 | 1.15 | Calendário do plano passa a R$ 24,99 (D-066) |
| 2026-10-02 | 1.16 | Login seguro do backoffice, e-mail de campanha, carteiras e lembretes (D-067 a D-069) |
| 2026-10-02 | 1.17 | Login por senha, correções do backoffice e Assinatura v2 (D-070, D-071) |
| 2026-10-02 | 1.18 | Coach financeiro, mercado e privacidade (D-072, D-073) |
| 2026-10-02 | 1.19 | Coach: hábito diário, desafios, comparação e boas-vindas (D-074) |
| 2026-10-02 | 1.20 | Objetivo e metas prontas (D-075) |
| 2026-10-03 | 1.21 | Prumo (nome, landing, layout) e conta compartilhada (D-076 a D-078) |
| 2026-10-03 | 1.22 | Tom sobre crédito e botão de parceiro (D-079) |
| 2026-10-03 | 1.23 | Assinatura mensal no cartão (Asaas), cancelamento, exportação, Cancelados no backoffice e preços sincronizados (D-080 a D-083) |
| 2026-10-03 | 1.24 | eBook de presente e programa de indicações (D-084, D-085) |
| 2026-10-03 | 1.25 | Worker com e-mail e gateway reais, controle dos descontos, cenário econômico resiliente e ajustes de layout (D-086) |
| 2026-10-03 | 1.26 | Indicadores econômicos com fontes alternativas (D-087) |
| 2026-10-03 | 1.27 | Cobranças recorrentes e simulador "e se...?" (D-088) |
| 2026-10-03 | 1.32 | LIS integrado, guias das fases futuras, Open Finance (desligado) e identidade visual (D-093) |
| 2026-10-03 | 1.33 | Guias ligados, layout, estratégias sem repetição, envio manual a parceiros, novo Prumo (D-094) |
| 2026-10-04 | 1.34 | Gestão de parceiros no backoffice, correções de layout, guias na landing, dinheiro esquecido pago (D-095) |
| 2026-10-04 | 1.35 | Acesso de 30 dias com direito de refazer, contagem regressiva e controle no backoffice (D-096) |
| 2026-10-04 | 1.36 | Asaas em CPF, segredos do GitHub, contas de teste e textos de responsável (D-097) |
| 2026-10-08 | 1.37 | Dados do Pix e do assinante, Meta CAPI, URLs limpas, assinatura em uma tela, ambiente local de testes e revisão de prontidão para o lançamento (D-098 a D-100) |
| 2026-10-03 | 1.31 | Vários aparelhos no link de acesso, cheque especial (LIS) e detalhe das opções "Outra" (D-092) |
| 2026-10-03 | 1.30 | QA total e correção dos 22 achados (D-091) |
| 2026-10-03 | 1.29 | Operação autônoma: saúde, backup, limpeza, SEO e Turnstile (D-090) |
| 2026-10-03 | 1.28 | Revisão total, roadmap atualizado e checklist de lançamento §11A (D-089) |
