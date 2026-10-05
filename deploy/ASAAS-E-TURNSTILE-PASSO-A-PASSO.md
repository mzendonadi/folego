# Asaas (conta pessoa física) e Turnstile — passo a passo

Regra de ouro: **nenhuma chave, senha ou token passa pelo chat.** Você gera tudo nos painéis e cola direto no servidor, pelo Terminal. Os nomes de menu abaixo podem mudar um pouco; o caminho é o mesmo.

O código do Asaas já está pronto (Pix com QR e assinatura no cartão). Ele só precisa de quatro valores no servidor: a chave da API, a chave Pix, o token do webhook e o endereço da API (teste ou produção).

## Parte A — Asaas

### A1. Teste primeiro no Sandbox (recomendado)
1. No Asaas, vá em **Minha conta → Integrações** e, no cartão **Sandbox**, crie o ambiente de testes. Ele é uma conta separada, com dinheiro de mentira.
2. Faça os passos A2 a A6 no Sandbox primeiro. Só depois repita no ambiente real (A9).

### A2. Gerar a chave da API
1. **Integrações → Chaves de API → Gerar nova chave.**
2. O Asaas mostra a chave **uma única vez**. Copie para um gerenciador de senhas. Ela começa com `$aact_`.
3. Não cole em chat, e-mail nem arquivo do projeto.

### A3. Cadastrar a chave Pix
1. No menu **Pix**, abra **Minhas chaves** e cadastre uma **chave aleatória** (a que o Asaas gera). Ela vira o valor `ASAAS_PIX_KEY`.
2. Copie o texto da chave (parece `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). Essa chave não é segredo, mas guarde junto.

### A4. Criar o token do webhook
Este token é uma senha que o Asaas envia em cada aviso de pagamento, para o nosso servidor saber que o aviso é verdadeiro. **Não é a chave da API.** Invente uma sequência longa (32 caracteres ou mais, com letras e números) ou gere no seu computador:

```bash
openssl rand -hex 24
```

Guarde no gerenciador de senhas. Você vai usar o mesmo valor no Asaas (A5) e nos segredos do GitHub (A6).

### A5. Cadastrar o webhook no Asaas
1. **Integrações → Webhooks → Criar webhook.**
2. **Nome:** Fôlego. **URL:** `https://folego.online/webhooks/pix`. **Token de autenticação:** o valor do passo A4.
3. **Fila:** deixe a sincronização ligada. **Eventos de cobrança:** marque `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED` e `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`. **Eventos de assinatura:** marque `SUBSCRIPTION_DELETED` e `SUBSCRIPTION_INACTIVATED`.
4. Salve.

### A6. Entregar as chaves ao Claude SEM passar pelo chat (segredos do GitHub)
Você não precisa entrar no servidor. O GitHub guarda as chaves como **segredos** (ninguém vê o valor depois de salvo, nem o Claude) e a publicação grava no servidor sozinha, sem imprimir nada.

**Jeito 1, pelo site:** abra o repositório `mzendonadi/folego` no GitHub → **Settings → Secrets and variables → Actions → New repository secret**. Crie um segredo para cada linha abaixo (o nome tem que ser exatamente este) e cole só o valor:

| Nome do segredo | Valor |
|---|---|
| `ASAAS_API_KEY` | a chave da API (começa com `$aact_`), sem aspas |
| `ASAAS_PIX_KEY` | a chave Pix aleatória |
| `ASAAS_WEBHOOK_TOKEN` | o token do passo A4 |
| `ASAAS_BASE_URL` | só para testar no Sandbox: `https://api-sandbox.asaas.com/v3`. Em produção, não crie (o padrão é a produção) |
| `TURNSTILE_SITE_KEY` | a Site Key do Turnstile (parte B) |
| `TURNSTILE_SECRET` | a Secret Key do Turnstile (parte B) |

**Jeito 2, pelo Terminal do seu computador** (o valor é pedido de forma oculta, não aparece na tela):

```bash
gh secret set ASAAS_API_KEY --repo mzendonadi/folego
gh secret set ASAAS_PIX_KEY --repo mzendonadi/folego
gh secret set ASAAS_WEBHOOK_TOKEN --repo mzendonadi/folego
gh secret set TURNSTILE_SITE_KEY --repo mzendonadi/folego
gh secret set TURNSTILE_SECRET --repo mzendonadi/folego
```

Quando as três do Asaas (`ASAAS_API_KEY`, `ASAAS_PIX_KEY`, `ASAAS_WEBHOOK_TOKEN`) existirem, a próxima publicação troca o pagamento de demonstração pelo Asaas, desliga o gateway de mentira e liga os bloqueios do `deploy.sh` (aborta sem as chaves, mantendo a versão atual no ar).

### A7. Avisar o Claude
Diga "segredos cadastrados". O Claude confere que a publicação passa (sem ver nenhum valor), publica e roda as verificações do documento de publicação.

### A8. Testar no Sandbox
1. No site, faça um pedido pequeno (o Mapa), gere o Pix e, no painel do **Sandbox** do Asaas, aprove o pagamento da cobrança de teste.
2. O Mapa deve abrir sozinho no site em segundos. Se não abrir, o webhook (A5) ou o token (A4) está errado: confira no Asaas, em **Webhooks → Logs de requisição**.
3. Teste também a assinatura no cartão do Prumo, com o cartão de teste do Sandbox.

### A9. Ir para produção
1. Repita A2 a A5 no **ambiente real** do Asaas (chave nova e chave Pix real; o webhook usa o mesmo endereço).
2. Nos segredos do GitHub, **apague** `ASAAS_BASE_URL` (o padrão é a produção) e atualize `ASAAS_API_KEY`, `ASAAS_PIX_KEY` e `ASAAS_WEBHOOK_TOKEN` com os valores de produção.
3. Peça a publicação de novo. Depois faça **um pedido real de menor valor com você mesmo** (o Mapa, R$ 29) e confirme que abre. Se quiser, estorne o pagamento pelo painel do Asaas.
4. Só então ligue a indexação (`SEO_OPEN=1`).

### A10. Segurança da conta Asaas
Em **Integrações → Segurança**, ative o que o Asaas oferece, em especial **restringir a chave da API ao IP do servidor** (`129.121.46.33`). Assim a chave não funciona se vazar.

### A11. Cuidados de conta pessoa física
- Confirme com o suporte do Asaas se a sua conta PF libera **assinatura recorrente no cartão** e quais são os **limites de recebimento**. Os produtos de Pix único funcionam de qualquer forma.
- Fale com seu contador sobre o tratamento fiscal de vender como pessoa física.
- Os textos do site (termos, privacidade, rodapé) hoje falam em empresa e CNPJ. Eles precisam apontar para você como responsável. Me diga o que quer exibir.

## Parte B — Cloudflare Turnstile

O Turnstile é o anti-robô gratuito da Cloudflare, no mesmo painel que já cuida do domínio. Não depende do Asaas nem de CPF ou CNPJ. Ele protege o formulário do diagnóstico contra robôs.

### B1. Criar o widget
1. Entre em **dash.cloudflare.com** e, no menu lateral, abra **Turnstile**.
2. Clique em **Add widget** (Adicionar widget).
3. **Widget name:** Fôlego.
4. **Hostname:** `folego.online` (se o site também abrir em `www.folego.online`, adicione esse também).
5. **Widget Mode:** **Managed** (o Turnstile decide sozinho se mostra um desafio).
6. **Pre-clearance:** deixe desligado.
7. Clique em **Create**.

### B2. Copiar as duas chaves
A Cloudflare mostra:
- **Site Key:** é pública (começa com `0x4`). Vai para o navegador.
- **Secret Key:** é secreta. Fica só no servidor. Copie para o gerenciador de senhas.

### B3. Cadastrar as chaves como segredos
Mesmo caminho do passo A6: crie os segredos `TURNSTILE_SITE_KEY` (a Site Key) e `TURNSTILE_SECRET` (a Secret Key) em **Settings → Secrets and variables → Actions** do repositório, ou com `gh secret set`.

### B4. Ativar
Avise "segredos cadastrados". A publicação grava as chaves no servidor e reinicia os containers.

### B5. Conferir
1. Abra `https://folego.online/api/features`. O campo `turnstileSiteKey` deve mostrar a sua Site Key (hoje aparece `null`).
2. Abra o site, comece o diagnóstico e envie. O desafio do Turnstile (um selo discreto) deve aparecer e a análise deve funcionar.
3. A política de segurança do site já libera o endereço da Cloudflare para o Turnstile; não precisa mudar nada.

## Ordem sugerida

| Quando | O que |
|---|---|
| Hoje | B1 a B3 (Turnstile) e A1 a A6 (Asaas no Sandbox), tudo como segredos do GitHub |
| Em seguida | Avisar o Claude (A7), testar no Sandbox (A8) |
| Depois do teste | A9 (produção) e A10 (segurança) |
| Antes de lançar | Textos legais com você como responsável; `SEO_OPEN=1` |
