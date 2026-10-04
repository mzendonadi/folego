# Open Finance no Prumo — passo a passo para ligar

Estado hoje: o código está pronto e **desligado** (aba "Contas conectadas" mostra "Em breve"). Ele fala com o agregador **Pluggy**. Foi testado com respostas simuladas, nunca contra o ambiente real dele. Este roteiro leva do zero até clientes usando, com um teste de verdade no meio. Marque cada item.

> Regra de ouro: nenhuma senha, chave ou token deve passar por mim ou pelo chat. As chaves vão direto do painel do agregador para o servidor, pelo Terminal.

## Fase 0 — Antes de procurar o agregador (1 a 2 dias)

- [ ] **CNPJ ativo** (o MEI). Agregadores regulados contratam com empresa. Ter conta no Asaas ou não, não muda isso.
- [ ] **Decidir o preço do plano Desbravador** sabendo o custo: o agregador cobra por conexão ativa (por mês, por banco conectado). Regra prática: o custo por pessoa tem que caber com folga em R$ 59,99. O limite atual é 5 conexões por pessoa; se o custo apertar, baixe para 2 em `MAX_CONNECTIONS` (`apps/api/src/openfinance.ts`).
- [ ] **Canal de privacidade e encarregado (DPO)** definidos e publicados no rodapé (você já tem isso na lista de pendências do lançamento). Open Finance mexe com dado financeiro: sem isso não ligue.

## Fase 1 — Escolher e contratar o agregador (1 a 3 semanas)

1. Abra o site do **Pluggy** (pluggy.ai) e peça contato comercial. Peça também propostas da **Belvo** e de mais um (ex.: Quanto) para comparar. O código está feito para o Pluggy; trocar de agregador é refazer só o arquivo `apps/api/src/openfinance.ts` (a interface `OpenFinanceProvider` isola o resto).
2. Mande este e-mail-base e compare as respostas:
   - Cobram por conexão ativa, por consulta ou mensalidade fixa? Quanto, e com qual mínimo mensal?
   - Quais bancos e instituições estão cobertos (Nubank, Itaú, Bradesco, Banco do Brasil, Caixa, Santander, Inter, C6)?
   - Como funciona a renovação do consentimento do cliente (a regra do Open Finance é de até 12 meses)?
   - Vocês são a instituição **autorizada pelo Banco Central** e podem me enviar a comprovação? Quem é o controlador e quem é o operador dos dados (LGPD)?
   - Mandam o **contrato de tratamento de dados (DPA)**? Onde os dados ficam armazenados e por quanto tempo?
   - Existe **ambiente de testes (sandbox)** com bancos de mentira? Webhooks de atualização?
   - Qual o SLA e o suporte (horário, canal)?
3. Escolha, assine, guarde contrato e DPA em pasta segura. **Não ligue nada antes de ter o DPA.**

## Fase 2 — Chaves do ambiente de testes e primeiro teste (1 dia)

1. No painel do agregador, crie uma **aplicação** e copie o **Client ID** e o **Client Secret** do **sandbox**.
2. Coloque as chaves **no servidor**, sem passar por ninguém. No Terminal do app (aba de terminal), conecte e edite o arquivo de ambiente:
   ```bash
   ssh -p 22022 codhubs@129.121.46.33
   nano ~/folego/deploy/.env
   ```
   Acrescente estas linhas (com as chaves de teste) e salve (`Ctrl+O`, Enter, `Ctrl+X`):
   ```
   PLUGGY_CLIENT_ID=cole-aqui
   PLUGGY_CLIENT_SECRET=cole-aqui
   ```
3. Reinicie para ler as chaves: na aba **Actions** do GitHub, rode **Publicar em produção** (motivo: "ligar Open Finance em teste"). Ele reconstrói e sobe tudo.
4. Confirme: `https://folego.online/api/features` deve mostrar `"openFinance":true`.
5. Entre no Prumo com uma conta **Desbravador de teste** → aba **Dinheiro → Contas conectadas**.

## Fase 3 — Teste no sandbox (meio dia). Marque cada linha

No widget, use um banco de teste do agregador (no Pluggy: conector de testes com usuário `user-ok` e senha `password-ok`; confirme na documentação deles, pois podem mudar).

- [ ] O botão "Conectar uma conta" só habilita depois de marcar o consentimento.
- [ ] O widget abre dentro da página (se aparecer erro de segurança no console do navegador, é a **CSP**: anote o endereço bloqueado e veja a Fase 5).
- [ ] Depois de conectar, aparece a conexão, as **carteiras** e os **lançamentos** (só conta corrente e poupança; cartão não entra).
- [ ] O saldo da carteira bate com o do banco de teste.
- [ ] "Atualizar agora" não duplica lançamentos.
- [ ] Conta com saldo negativo aparece como **cheque especial** em Carteiras e em **Dívidas**.
- [ ] **Desconectar** some da lista e o item some no painel do agregador.
- [ ] Um Controle ou Ousado vê o cadeado de upgrade.
- [ ] A aba "Plano e dados" → exportação inclui as carteiras importadas.
- [ ] Deixe 6 horas e confira no painel do backoffice (Saúde) que o worker segue verde: ele sincroniza sozinho a cada 6 horas.

Se algo falhar, copie o texto do erro (sem chaves) e me mande: o ajuste é no `openfinance.ts`.

## Fase 4 — Jurídico e transparência (1 semana, em paralelo à Fase 3)

- [ ] **Política de Privacidade** (advogado): nova seção "Contas conectadas": quais dados (saldo e extrato de contas correntes e poupanças), finalidade (montar carteiras e lançamentos), base legal (consentimento), compartilhamento (apenas o agregador, como operador), retenção (até a pessoa desconectar ou excluir a conta), direitos do titular.
- [ ] **Termos de Uso**: o que o recurso faz e não faz (só leitura, sem movimentar dinheiro, sem garantia de que o banco esteja disponível).
- [ ] **Texto do consentimento** da tela: aprovar com o advogado; ao mudar o texto, troque `OF_CONSENT_VERSION` em `apps/api/src/openfinance.ts` (fica gravada a versão aceita por cada pessoa).
- [ ] **RIPD** (relatório de impacto): descrever riscos (vazamento, uso indevido), medidas (criptografia, acesso mínimo, revogação em um clique) e arquivar.
- [ ] Incluir o agregador na lista de **operadores** que o Fôlego informa ao titular.
- [ ] Plano de incidente: quem avisa a ANPD e os clientes se houver vazamento (veja o runbook em `DOCUMENTO-OFICIAL.md`, item 18 do checklist).

## Fase 5 — Confirmar o widget e a CSP (1 hora)

O widget do agregador é um script e uma janela externos. Hoje a CSP libera: `https://cdn.pluggy.ai` (script), `https://connect.pluggy.ai` (janela) e `https://api.pluggy.ai` (API). Confirme **na documentação atual do agregador** se esses são mesmo os endereços e a **versão do script**:

- Se o endereço do script mudou, defina no `.env` do servidor: `PLUGGY_CONNECT_URL=https://...pluggy-connect.js` (sem mexer no código).
- Se aparecer algum domínio novo bloqueado no console, ele precisa entrar **igual** nos dois lugares: `apps/api/src/security.ts` e `deploy/nginx/folego.conf` (os dois textos devem ser idênticos).

## Fase 6 — Virada para produção (meio dia)

1. No painel do agregador, gere as chaves de **produção**.
2. No servidor, troque as duas linhas do `.env` pelas chaves de produção (mesmo procedimento da Fase 2) e rode **Publicar em produção**.
3. Teste **com a sua própria conta bancária real**, uma só: conectar, ver saldo, atualizar, desconectar.
4. Faça backup antes (workflow **Operações → backup_agora**) e acompanhe o **Monitor** por 24 horas.
5. Só então: atualize a landing/planos para dizer que Open Finance está disponível (hoje a tela de planos diz "Em breve"; é o campo `soon` do plano Desbravador em `packages/domain/src/account.ts`) e avise os assinantes por e-mail.

**Voltar atrás a qualquer momento:** apague as duas chaves do `.env` e publique de novo. O recurso se desliga sozinho e nada mais quebra; as conexões já feitas ficam guardadas, sem atualizar.

## Fase 7 — Depois de ligar

- Todo mês: conferir o custo por conexão no painel do agregador contra a receita do Desbravador.
- Se aparecer muita conexão com erro: use o campo "última atualização falhou" da tela e o log do worker (`openfinance_sync_erro`).
- Cartão de crédito ainda não é importado; é a próxima evolução natural.

## Quem faz o quê

| Etapa | Quem |
|---|---|
| Fases 0, 1, 4, 6 (contrato, jurídico, chaves) | Você |
| Fase 2 e 6 (colocar chaves no servidor) | Você, pelo Terminal (eu não vejo as chaves) |
| Fase 3 (teste) | Você executa a lista; eu corrijo o que quebrar |
| Ajustes de código, CSP e textos de tela | Eu |
