# WhatsApp do Fôlego pela Bird (convite de indicação do Prumo)

Número da empresa na Bird: **+55 11 91379-2370** (canais WhatsApp Business e SMS já ativos na Bird).
Hoje o canal faz uma coisa: **o assinante do Prumo convida um amigo pelo WhatsApp**, dentro da aba "Indique e ganhe".
A estrutura (fila, opt-out, webhook, status) já serve para outros avisos no futuro, sempre por modelo aprovado.

## O que o assinante vê

Em **Minha conta > Indique e ganhe**, o botão **Convidar por WhatsApp** abre um modal com o nome e o WhatsApp do amigo, a mensagem pronta e dois caminhos:

| Caminho | Como funciona | Regra da Meta |
|---|---|---|
| **Enviar pelo meu WhatsApp** | Abre o WhatsApp do próprio assinante com a mensagem pronta (link `wa.me`). Ele envia. | Sem risco: é conversa pessoal. Funciona mesmo sem Bird. |
| **Enviar pelo WhatsApp do Fôlego** | O Fôlego envia pelo número da Bird, por modelo aprovado, em horário comercial. O assinante acompanha a situação (Na fila, Enviada, Entregue, Lida, Não foi possível enviar). | Mensagem iniciada pela empresa: exige modelo aprovado e, pela política da Meta, que o destinatário tenha aceitado receber. Ver "Risco de política" abaixo. |

O segundo botão só aparece quando as chaves da Bird estão configuradas.

## Modelo APROVADO (vale este)

Nome na Bird: **Fôlego Indicação Prumo** (o sistema usa o identificador `folego-indicacao-prumo`; se o identificador real na Bird for outro, cadastre-o no segredo `BIRD_TEMPLATE_INDICACAO`). Variáveis nomeadas: `nome_do_assinante` (ex.: José Pereira), `nome_da_indicacao` (ex.: Carlos Alberto), `codigo` (código do link de acesso, ex.: abc23xyz; a Bird encurta o link em `brd5.us`). Rodapé: "Para não receber mais, responda SAIR."

Texto: "Olá, {nome_da_indicacao}! Seu amigo, {nome_do_assinante} é cliente do Prumo, o app de finanças do Fôlego, e está gostando tanto que lembrou de você. O Prumo reúne em um só lugar o controle de gastos, as dívidas com plano de quitação, lembretes de contas e um coach que mostra, todo dia, o próximo passo. Você acompanha o dinheiro com calma e vê o progresso mês a mês. Por isso, gostaria de compartilhar com você o acesso à plataforma para que você conhecer melhor a solução. Se quiser saber mais, acesse: {link} Abraços!"

A versão inicial abaixo foi reprovada e ficou só como histórico.

## Texto do modelo inicial (reprovado)

Nome (slug): `indicacao_prumo` · Idioma: Português (Brasil), `pt-BR` · Categoria: **Marketing** (convite promocional; "Utilidade" seria reprovado).

**Corpo**

```
Olá, {{1}}! Sou assinante do Prumo e com ele tenho reorganizado minhas finanças, atingindo minhas metas com o planejador e estou gostando da experiência. Por isso, gostaria de compartilhar com você o acesso à plataforma para conhecer melhor a solução. Se quiser saber mais, acesse: {{2}} Abraços!
```

**Rodapé** (recomendado, sem variável): `Para não receber mais, responda SAIR.`

- `{{1}}` = primeiro nome do amigo, `{{2}}` = link de indicação do assinante (`https://folego.online/conta?ind=CÓDIGO`).
- Exemplos para a revisão da Meta: `{{1}}` = `Carlos`, `{{2}}` = `https://folego.online/conta?ind=abc23xyz`.
- O texto é o que você pediu, com um ajuste de português ("minhas finanças"). Se mudar uma vírgula no modelo aprovado, o texto do site e o do modelo ficam diferentes: a Meta só aceita o texto exatamente aprovado.
- Se a Meta reprovar por "promocional demais", troque "Sou assinante do Prumo" por "Sou cliente do Prumo" e tire "atingindo minhas metas".

## O que você precisa fazer (só você consegue)

1. **Bird > WhatsApp > Templates**: criar o modelo acima e aguardar a aprovação (de minutos a 24 h).
2. **Bird > Developers > API keys**: criar uma chave (começa com `bk_`). Não cole no chat.
3. **GitHub > Settings > Secrets > Actions**, cadastrar:
   - `BIRD_API_KEY` (obrigatório): a chave `bk_...`.
   - `BIRD_WEBHOOK_SECRET`: o segredo de assinatura do webhook (passo 4), 16+ caracteres, começa com `whsec_`.
   - `BIRD_WHATSAPP_FROM` (opcional): padrão `+5511913792370`. Se a Bird pedir o identificador do canal em vez do número, coloque aqui.
   - `BIRD_TEMPLATE_INDICACAO` (opcional): o slug do modelo, padrão `indicacao_prumo`.
4. **Bird > Webhooks**: criar um webhook para `https://folego.online/webhooks/bird` com os eventos `whatsapp.*` (aceita, enviada, entregue, lida, falhou, recebida) e copiar o segredo de assinatura para `BIRD_WEBHOOK_SECRET`.
5. Avise para eu publicar de novo (o deploy passa os segredos ao servidor) e fazemos o **primeiro envio de teste para o seu próprio número**.

Sem `BIRD_API_KEY`, nada muda: só o botão "pelo meu WhatsApp" fica ativo.

## Como o envio funciona (por dentro)

- O pedido grava a indicação e **entra numa fila** (`app.msg_log`). O worker envia; se for entre 20h e 8h (Brasília), espera até as 8h.
- **Idempotência:** a chave enviada à Bird é o id do registro, então uma repetição por queda de rede não duplica a mensagem.
- **Tentativas:** erro temporário (429, 5xx, rede) tenta de novo com espera crescente, até 5 vezes. Erro definitivo (422 número inválido, 401/403 chave) marca "Não foi possível enviar" na hora.
- **Privacidade (LGPD):** o telefone fica criptografado (AES-256-GCM) e é procurado só por HMAC. O texto das respostas não é guardado.
- **SAIR:** quem responde `SAIR`, `PARAR`, `STOP`, `CANCELAR`, `NÃO QUERO` etc. é marcado e **nunca mais recebe**; mensagens pendentes dele são canceladas. Vale para todos os assinantes que o indicarem depois.
- **Limites por assinante:** 5 convites por dia, 15 no total; o mesmo telefone não recebe de novo por 90 dias.
- **Backoffice > Indicações:** os dados de envio ficam em `GET /api/gestao/indicacoes` (`whatsapp`: na fila, enviadas, entregues, lidas, falhas, quem saiu).
- **Respostas de conversa** (o amigo respondendo com uma pergunta) aparecem na caixa de entrada da Bird; a atendente responde por lá.

## Risco de política (leia antes de ligar)

A Meta exige que quem recebe uma mensagem iniciada pela empresa tenha **dado permissão (opt-in)**. Um convite de amigo **não é opt-in do amigo**: se muitos destinatários marcarem "spam" ou bloquearem, a **qualidade do número cai e a Meta pode limitar ou suspender o 11 91379-2370**, que também serve ao resto do negócio.

O que já está embutido para reduzir esse risco:

- o assinante confirma que **conhece a pessoa** antes de enviar;
- uma única mensagem por telefone (90 dias) e **SAIR** respeitado na hora;
- limites baixos por assinante e horário comercial;
- o rodapé "responda SAIR" no modelo.

**Recomendação:** ligue com poucos assinantes, acompanhe o indicador **Qualidade** do número no Meta Business Manager por 1 a 2 semanas e, se cair para "média/baixa", desligue (remova `BIRD_API_KEY`) e fique só no "pelo meu WhatsApp". Esse caminho não tem esse risco.

## Primeiro envio: o que ainda precisa ser conferido

A documentação pública da Bird confirma `POST /v1/whatsapp/messages`, `template.slug`, `components` com `parameters`, chave `Idempotency-Key` e eventos `whatsapp.*`, mas **não** deixa explícito: o cabeçalho de autenticação, o nome do campo de texto do parâmetro (usamos `Authorization: Bearer` e `{type:'text', text}`), o endereço base fora da região `eu1` e o formato do texto da mensagem recebida. Por isso o primeiro envio é um **teste real** para o seu número. Se a Bird recusar algo, o erro aparece em "Não foi possível enviar" e no log do worker (`bird_envio_falhou`), e o ajuste é de uma linha em `apps/api/src/bird.ts`. Se o endereço base for outro, defina `BIRD_BASE_URL`.

## E-mail do convite (corrigido junto)

Você enviou um convite para um Gmail e não chegou nada. O que o código fazia de errado:

1. **Descartava em silêncio.** Se o endereço já tinha recebido um convite nos últimos 30 dias (inclusive de um teste anterior) ou tinha pedido para não receber, o servidor não enviava, mas a tela dizia "Convite enviado". Provável causa do seu caso.
2. **Gastava a indicação antes de enviar.** Se o envio falhasse, o registro ficava gravado e a pessoa não podia tentar de novo por 30 dias.
3. **Mensagem de sucesso sem dizer para onde foi.**

Agora: a API devolve `sent` ou `blocked`; a tela mostra "Convite enviado para {e-mail}" (com a dica do spam) ou "Não enviamos: este e-mail já recebeu um convite recentemente ou pediu para não receber"; se o envio falhar, a indicação é desfeita e o erro aparece ("Não consegui enviar o e-mail agora. Nada foi registrado").

Para reenviar ao mesmo Gmail agora, o registro do teste anterior precisa sair do prazo de 30 dias ou ser apagado no banco; use outro endereço para validar.
