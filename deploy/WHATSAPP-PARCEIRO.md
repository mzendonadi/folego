# WhatsApp no portal do parceiro: guia de operação e arquitetura

Aba **WhatsApp** do portal (`/parceiros`): receber e enviar mensagens, disparar para quem deu permissão, modelos, conexão do número e um **gancho pronto para agente de IA**. Usa a **API oficial da Meta (WhatsApp Cloud API)**.

## Por que a API oficial (decisão)

| Opção | Custo | Risco | Resultado |
|---|---|---|---|
| **Cloud API da Meta (escolhida)** | sem mensalidade, sem intermediário; só os modelos de marketing são cobrados por mensagem entregue | baixo: regras claras e número protegido | usada |
| Bibliotecas não oficiais (QR code, "WhatsApp Web") | grátis | alto: banimento do número, violação dos termos, sem garantia; inaceitável para crédito e base fria | recusada |
| Provedor intermediário (BSP) | mensalidade + margem por mensagem | baixo | só se o volume justificar |

**Custo na prática** (confira a tabela vigente da Meta, ela muda): a conversa que o cliente começa e as respostas dentro de 24 h não são cobradas. Modelos de marketing são cobrados por mensagem entregue (ordem de grandeza de centavos de real cada). O Fôlego não cobra nada pela ferramenta. Para custo mínimo: **faça o cliente escrever primeiro** (botão "Falar no WhatsApp" na landing, anúncio "clique para conversar", link `wa.me`) e responda dentro da janela de 24 h.

## Como o parceiro conecta o número (uma vez)

1. Em `developers.facebook.com`, criar um app tipo "Empresa" e adicionar o produto **WhatsApp**.
2. Registrar o número do negócio (ele deixa de funcionar no aplicativo comum do WhatsApp). Copiar o **ID do número de telefone**.
3. Em Usuários do sistema, gerar um **token permanente** com `whatsapp_business_messaging` e `whatsapp_business_management`. Em Configurações > Básico, copiar o **Segredo do app**.
4. No portal: WhatsApp > Conexão, colar os dados e **Conectar**; clicar em **Testar conexão**.
5. Na Meta, em Webhooks (produto WhatsApp), informar o **endereço** e o **token de verificação** que aparecem na tela de Conexão e assinar o campo **messages**.
6. Em Modelos: criar o mesmo modelo (nome e texto) no Gerenciador do WhatsApp da Meta; quando for aprovado, marcar **Aprovado** no portal.

Credenciais (token e segredo do app) ficam **criptografadas** (AES-256-GCM) e nunca voltam para a tela.

## Regras que o sistema impõe (proteção do número e LGPD)

- **Janela de 24 h:** texto livre só em até 24 h depois da última mensagem do cliente. Fora disso, só modelo aprovado. A tela mostra "Janela aberta/fechada".
- **Permissão (opt-in):** disparo e modelo só para (a) contato do Fôlego (a pessoa autorizou falar com parceiro), (b) base própria marcada "tem permissão" (o parceiro **declara** que a tem, na importação ou na ficha), (c) quem escreveu primeiro. Contato "sem permissão informada" entra na base mas não recebe disparo.
- **SAIR/PARAR/CANCELAR/"não quero"** do cliente: envios param na hora, ele recebe confirmação, a permissão vira "não" e o contato fica bloqueado.
- **Teto diário** de modelos por parceiro (padrão 200) e **horário de silêncio** (padrão 20h às 8h, Brasília). Respostas de atendimento não contam nem esperam.
- **Não insiste:** quem recebeu modelo nos últimos 3 dias não entra em novo disparo. Máximo de 500 por disparo.
- Falhas permanentes da Meta (ex.: número sem WhatsApp) não ficam repetindo; falhas passageiras tentam de novo (até 5 vezes, espera crescente).
- Textos das mensagens e telefones ficam criptografados no banco; o telefone também vira HMAC para achar a conversa certa (com ou sem o 9 depois do DDD).
- **Webhook:** um endereço por parceiro (`/webhooks/whatsapp/<id>`); o corpo cru é conferido com `X-Hub-Signature-256` e o segredo do app daquele parceiro; evento repetido não duplica.
- Cada parceiro só enxerga o próprio WhatsApp (tudo filtrado por `partner_id`).

## Dados (migração 038)

`wa_accounts` (conexão, teto, silêncio, config do agente), `wa_templates`, `wa_threads` (uma por parceiro e telefone; liga ao contato da base ou ao contato do Fôlego), `wa_messages` (entrada e saída, status fila, enviada, entregue, lida, falhou), `wa_broadcasts`. Em `partner_contacts`: `wa_optin` e `phone_keys`.

## Agente de IA: onde plugar

Está **desligado e sem nenhum provedor instalado** (nenhuma chamada de IA é feita). A estrutura:

```ts
// apps/api/src/whatsapp.ts
interface SalesAgent { name: string; reply(input: AgentInput): Promise<{ text: string | null; handoff: boolean }> }
```

`AgentInput` traz a configuração do parceiro (persona, regras, palavras de passagem, limite por hora, aviso), o histórico recente (12 mensagens, `user`/`assistant`) e a origem do contato (Fôlego, base ou entrada).

Para instalar um agente (ex.: Claude): criar `apps/api/src/sales-agent.ts` com uma classe que implemente `SalesAgent` (chamada à API do modelo, usando a persona e as regras como instrução de sistema e o histórico como mensagens) e passá-la para `buildApp({ ..., salesAgent })` em `server.ts`. Nada mais muda: rotas, tela, guardas e testes já existem.

Guardas que valem para **qualquer** agente (já implementadas e testadas):

- só responde se o parceiro ligar o agente **e** colocar a conversa em modo IA; quando uma pessoa responde, a IA sai;
- palavras de passagem (atendente, humano, reclamação, procon, advogado...) passam para uma pessoa;
- limite de respostas por hora por conversa; estourou, uma pessoa assume;
- a primeira resposta da IA em cada conversa começa com o **aviso de assistente virtual**;
- se o agente falhar, a conversa vai para uma pessoa (o atendimento não cai);
- contato que pediu SAIR nunca recebe resposta da IA.

Recomendações para o agente de crédito consignado: nunca prometer taxa, aprovação ou prazo; não pedir senha, código nem dados de cartão; simular só com dados mínimos (vínculo, margem, valor); registrar contrato pela ficha (a comissão do Fôlego é calculada ali).

## Operação e testes

- Fila de envio roda no worker (job `whatsapp`), a cada ciclo; a API também tenta enviar na hora.
- Local sem Meta: `WHATSAPP_FAKE=1` (só fora de produção) imprime no console o que seria enviado; o webhook pode ser simulado com POST assinado.
- Testes: `apps/api/tests/whatsapp.test.ts` (webhook assinado, janela, opt-in, SAIR, modelos, disparo e teto, agente, isolamento).
