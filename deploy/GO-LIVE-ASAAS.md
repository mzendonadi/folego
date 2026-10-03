# Roteiro para ligar a cobrança real (Asaas)

Hoje o pagamento é **simulado** (`PAYMENT_PROVIDER=fake`): nenhuma cobrança é real. Este roteiro liga o Asaas sem derrubar nada.
Produtos avulsos continuam no Pix; o Prumo (assinatura) é **cartão de crédito recorrente**.

## 1. Antes de tudo
- [ ] MEI aberto e conta Asaas aprovada (a conta de produção aprova a cobrança recorrente no cartão).
- [ ] Teste primeiro no **sandbox** (`https://api-sandbox.asaas.com/v3`) com uma chave de sandbox.
- [ ] `RESEND_API_KEY` configurada (o eBook de presente, o aviso de cartão recusado e os convites saem por e-mail).

## 2. Variáveis no servidor (`~/folego/deploy/.env`, nunca no Git)
```
PAYMENT_PROVIDER=asaas
ASAAS_API_KEY='$aact_...'
ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3      # produção: https://api.asaas.com/v3
ASAAS_PIX_KEY=<chave Pix aleatória cadastrada no Asaas>   # os produtos avulsos seguem no Pix
ASAAS_WEBHOOK_TOKEN=<32+ caracteres; o MESMO do webhook no painel>
```
Apague `ALLOW_FAKE_GATEWAY_IN_PRODUCTION`. Depois rode o workflow **Publicar em produção**.

## 3. Webhook no painel do Asaas
- URL: `https://folego.online/webhooks/pix` · Token de autenticação = `ASAAS_WEBHOOK_TOKEN`.
- Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`, `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_INACTIVATED`.

## 4. Teste de ponta a ponta no sandbox (cartões de teste do Asaas)
1. Assinar um plano em `#/conta` (marcar o aceite dos termos) → abre a página do Asaas → pagar → a conta ativa sozinha.
2. Conferir no backoffice: Assinaturas (em dia), pedido/pagamento criados e, se for Ousado/Desbravador, o e-mail com o eBook em anexo.
3. Indicação: assinante A copia o link, amigo B assina pelo link → A ganha 1 crédito (Indicações) e o valor da assinatura de A no Asaas cai 10% (conferir no painel do Asaas).
4. Renovação: no sandbox, antecipar a cobrança do mês seguinte → o acesso soma 1 mês e o crédito é consumido.
5. Cartão recusado: usar cartão de teste recusado → e-mail "não conseguimos cobrar" e status "Cartão recusado".
6. Cancelar na conta → a assinatura some do Asaas, o acesso segue até o fim do mês, o download (xlsx/PDF) funciona e aparece em **Assinaturas → Cancelados**.
7. Em Cancelados: **Baixar dados** (zip) → **Excluir dados** (pede o e-mail).

## 5. Virada para produção
- Trocar `ASAAS_API_KEY` e `ASAAS_BASE_URL` pelos de produção; recadastrar o webhook na conta de produção.
- Remover a linha `X-Robots-Tag noindex` do Nginx e o `robots.txt` bloqueando (marcadas "PRÉ-LANÇAMENTO"), quando decidir abrir para o público.
- Conferir os termos com o jurídico (cobrança recorrente, cancelamento sem reembolso do mês, retenção de 15 dias, indicações, consentimento de parceiros).

## 6. O que observar nas primeiras semanas
- Assinaturas "em débito" (cartão recusado) e quantas voltam a pagar.
- Aba Cancelados: baixar e excluir dentro da janela (padrão 15 dias; depois o sistema apaga sozinho).
- Indicações: conversão e créditos acumulados; o valor no Asaas muda sozinho, mas confira alguns casos.
