# Relatório de QA — Fôlego, Prumo e Backoffice

**Data:** 2026-10-03 · **Versão testada:** commit `45714d2` + correção de saúde (D-090) · **Responsável:** Claude (QA automatizado + exploratório)
**Ambientes:** local (API + PGlite, pagamento simulado, e-mail no log) para tudo que escreve dados; **produção (folego.online) somente leitura** (cabeçalhos, rotas, saúde, rotas protegidas).
**Scripts reexecutáveis:** pasta `qa/` (`api-qa.mjs`, `admin-qa.mjs`, `engine-qa.mjs`, `bruteforce-qa.mjs`, `race-qa.mjs`). Como rodar: subir a API local (`SUBSCRIPTIONS_ENABLED=1 LEADS_ENABLED=1 ADMIN_EMAILS=qa@exemplo.com RATE_LIMITS=relaxed PORT=3100 node src/server.ts`) e executar `QA_LOG=<log do servidor> node qa/<script>.mjs`.

## 1. Resumo executivo

| Resultado | Quantidade |
|---|---|
| Verificações automatizadas de API e backoffice | **254** (129 API + 125 backoffice) |
| Testes unitários/integração existentes (domínio 69, API 134, site 6) | **209, todos passando** |
| Achados reais a corrigir | **22** (2 altos · 8 médios · 12 baixos/info) |
| Vulnerabilidades de dependências (`npm audit --omit=dev`) | **0** |
| Acessibilidade automática (axe) | landing, diagnóstico, resultado, pagamento, Mapa e as 18 abas do Prumo em desktop: **0 violações**; violações só em tabelas do Mapa no celular e no backoffice |

**O que está sólido:** controle de acesso (IDOR, rotas do backoffice sem login, permissões por papel, escalonamento de privilégio), proteção contra força bruta do código por e-mail (bloqueio na 6ª tentativa), idempotência e corrida de pedidos/pagamentos (8 pedidos paralelos com a mesma chave = 1 pedido; 6 pagamentos paralelos = 1 pago), entrega paga só depois do pagamento, cabeçalhos de segurança, CSRF, injeções (SQL/XSS) sem efeito, arquivos sensíveis não servidos, rotas de teste fechadas em produção, IP direto do servidor bloqueado, cálculo do Mapa batendo centavo a centavo.

**O que mais precisa de atenção antes de lançar:** F-01 (máscara de valores em centavos), F-02 (dívida que nunca quita aparece como "livre em 400 meses") e os erros 500 em entradas inválidas (F-03).

## 2. Achados (para execução dos ajustes)

Severidade: **Alta** = pode levar a decisão errada do cliente ou quebra séria · **Média** = falha visível/regra incorreta · **Baixa** = polimento, consistência, endurecimento.

### Alta

**F-01 · Valores digitados são lidos como centavos (Fôlego, diagnóstico)** — *UX/regra de negócio*
- *Como reproduzir:* no diagnóstico, digitar `1700` em "despesas fixas" → vira **R$ 17,00**; `5000` no saldo da dívida → **R$ 50,00**. O campo tem só o placeholder `0,00`, sem aviso. Pessoa de baixa familiaridade digita "1700" e recebe um diagnóstico completamente errado (e paga por ele).
- *Ajuste sugerido:* tratar número sem vírgula como reais (1700 → R$ 1.700,00) ou mostrar ao lado, ao vivo, "= R$ 17,00" com destaque; revisar renda, despesas, saldo, parcela e todos os campos do Prumo (lançamento, metas, dívidas).

**F-02 · Dívida que nunca quita é apresentada como "livre em 400 meses" (Mapa e resultado)** — *regra de negócio/mensagem*
- *Caso:* cartão R$ 20.000 a 14% a.m., parcela R$ 100, sobra R$ 100. Os juros mensais (R$ 2.800) são 28× a parcela. O motor aplica o teto de juros (juros ≤ principal) e a simulação para no limite de 400 meses, mostrando "quita em 400 meses" e plano igual ao "seguir como está".
- *Risco:* promessa irreal ao cliente em produto cujo valor é justamente o realismo.
- *Ajuste sugerido:* quando a parcela não cobre os juros ou o prazo passa de ~10 anos, trocar a manchete por aviso claro ("do jeito atual a dívida não acaba; precisa renegociar/aumentar a parcela") e priorizar a negociação; revisar o texto do teto de juros.

### Média

**F-03 · Entradas inválidas geram HTTP 500 em vez de 4xx (API)** — *validação*
- `POST /api/cases` com `firstDefaultOn` no futuro (ex.: `2999-01-01`) → **500**.
- `POST /api/cases` com caractere nulo (`\u0000`) no nome do credor → **500** (o Postgres recusa).
- `GET /api/account/month/2020-13` e `/api/account/month/abc` → **500**.
- *Ajuste:* validar (zod) data não futura, remover/recusar `\u0000` em todos os textos, validar o parâmetro de mês (`YYYY-MM`, mês 01–12). Hoje o cliente vê "Algo deu errado" e o monitoramento de erros 5xx fica poluído.

**F-04 · Valores cortados nos cartões de resumo do Prumo (celular e tablet)** — *layout*
- Abas **Cobranças** e **E se...?** a 375 px e 768 px: "R$ 31.940,40" aparece cortado ("R$ 31.940,4") e "R$ 2.661,70" invade a borda do cartão. Foi introduzido na entrega D-088.
- *Ajuste:* os KPIs usam fonte fixa grande em grade de 2 colunas; usar `clamp()`/`overflow-wrap`, ou reduzir a fonte e quebrar o "R$" da linha.

**F-05 · Rolagem horizontal indevida no celular (375 px)** — *layout*
- Último passo do diagnóstico (barra de progresso/linha do tempo vai a 384 px), Mapa (menu `d-nav` 377 px) e **backoffice → Configurações** (`dt/dd/badge` a 385 px).
- *Ajuste:* `max-width:100%`/`box-sizing` nos contêineres citados; testar em 320 px também.

**F-06 · Detector de cobranças recorrentes: falsos positivos e duplicidade não detectada** — *regra de negócio*
- "Supermercado Extra" (valor variando 800/809/818/827) e "Uber" aparecem como cobranças recorrentes; aluguel também. Para o público do detector (assinaturas esquecidas) isso é ruído e desgasta a confiança.
- Duas cobranças **idênticas no mesmo dia** (Spotify R$ 21,90 duas vezes em 02/10) **não** são sinalizadas: a regra exige datas diferentes (`a.date !== b.date`, `recurring.ts:104`), mas a duplicidade mais comum é justamente no mesmo dia.
- Texto "1 cobrança(s) aumentaram" (concordância).
- *Ajuste:* exigir valor estável (tolerância ~5%) para classificar como assinatura ou excluir categorias de consumo variável (mercado, transporte, combustível); permitir duplicidade no mesmo dia; ajustar o plural.

**F-07 · Nota de saúde com renda zero = 72 ("atenção")** — *regra de negócio*
- Renda R$ 0 e dívida de R$ 3.000: nota 72, `confidence: low`. Sem renda a razão dívida/renda é indefinida e a penalidade vai a zero.
- *Ajuste:* tratar renda 0 como pior caso (penalidade máxima) ou nota "sem renda informada", nunca "quase controlado".

**F-08 · Link de acesso "move" o Mapa e é reutilizável** — *segurança/sessão*
- Ao abrir o link em outro navegador, o aparelho original passa a receber 404 no Mapa (perde o acesso, não há compartilhamento de sessão). O mesmo token reabre a quem o tiver, quantas vezes quiser, até expirar (30 dias).
- *Ajuste:* decidir a regra: (a) permitir vários aparelhos ligados ao mesmo pedido; (b) token de uso único com novo link por aparelho. Documentar na tela.

**F-09 · Renda absurda aceita pela tela; erro genérico no envio** — *UX/validação*
- A tela aceita R$ 999.999.999.999,99 de renda mensal e mostra no resumo ("Sobra aproximada" estoura o cartão). Ao enviar, aparece "Algo deu errado nas contas. Confira os dados" sem dizer o campo.
- *Ajuste:* limites no front iguais aos da API (mensagem por campo) e mostrar os `issues` retornados.

**F-10 · Acessibilidade das tabelas do Mapa no celular (axe: sério)** — *a11y*
- `scrollable-region-focusable` em 3 `.table-wrap` (comparação de caminhos, efeito de pagar mais, troca por crédito). Teclado/leitor de tela não alcançam a rolagem.
- *Ajuste:* `tabindex="0"`, `role="region"` e `aria-label` em cada `.table-wrap`.

### Baixa / informativo

| ID | Área | Achado | Ajuste sugerido |
|---|---|---|---|
| F-11 | API | `/api/account/*` **sem sessão** responde **404** `not_found`; após logout responde 401. | Responder sempre 401 `not_logged_in` (a tela já trata 401). |
| F-12 | API | Mensagens do framework vazam em inglês: `{"message":"Route GET:/api/x not found","error":"Not Found"}` e `FST_ERR_CTP_INVALID_JSON_BODY` / `FST_ERR_CTP_EMPTY_JSON_BODY`. | Handler de 404/parse com o formato próprio em português. |
| F-13 | Segurança | Códigos por e-mail: depois de 5 tentativas erradas o código é queimado e a vítima precisa pedir outro (limite de 3 pedidos/10 min por e-mail). Um atacante consegue manter a conta de alguém sem conseguir entrar (griefing). | Limitar por IP+e-mail e/ou aceitar o código anterior; avisar a pessoa. |
| F-14 | Segurança | `devCode` (código de login no corpo da resposta) é devolvido quando `env === 'development'`. Em produção é `production`, mas uma variável `NODE_ENV` ausente derrubaria a proteção. | Condicionar a uma flag explícita (`EXPOSE_DEV_CODES=1`) e recusar subir em produção com ela ligada. |
| F-15 | Segurança | HSTS `max-age=31536000` sem `includeSubDomains` e sem `preload`. | Habilitar após confirmar que todos os subdomínios têm HTTPS. |
| F-16 | UX | Mapa no celular: botões "Salvar em PDF" e "Apagar meus dados" desalinhados entre si; backoffice → Configurações no celular: caixas de seleção ora acima, ora ao lado do rótulo. | Padronizar o alinhamento. |
| F-17 | Copy | Descrição do plano **Controle** diverge entre a landing ("Nota de saúde", "Dívidas com plano", "Lembretes de contas por e-mail") e a tela de planos do Prumo (não cita lembretes nem plano de dívidas). | Unificar a lista em um único arquivo de textos. |
| F-18 | Categorização | "Academia SmartFit" cai em "Outros" (esperado: Saúde/Lazer). | Ampliar o dicionário de categorias (academia, farmácia, etc.). |
| F-19 | API | Campos desconhecidos são ignorados em silêncio (`description`, `kind` em lançamentos foram aceitos e descartados, gerando lançamentos errados sem aviso). | Esquemas `.strict()` nas rotas de escrita, para clientes/integrações perceberem o erro. |
| F-20 | Backoffice | Sem `<main>` (landmark), cabeçalho de tabela vazio no Painel, regiões de rolagem sem foco nos KPIs e salto de nível de título em Marketing (axe). Ferramenta interna, mas fácil de corrigir. | Marcar landmarks e rótulos. |
| F-21 | Mensagem | "Idempotency-Key obrigatório" também aparece quando a chave é curta (< 8). | Mensagem: "informe uma chave de 8 a 100 caracteres". |
| F-22 | Dev | O servidor local não serve `/gestao` (só `/gestao/`), o que difere da produção (`/gestao` → 301). | Redirecionar também no servidor de desenvolvimento. |

## 3. Cobertura — o que foi testado

| Área | O que foi feito | Resultado |
|---|---|---|
| **Fôlego (avulso)** | Wizard completo de diagnóstico (todas as etapas, validações de campo, entradas hostis), resultado, pagamento Pix simulado, entrega do Mapa, cálculo conferido à mão (orçamento soma a renda; juros e economia batem), apagar dados, link de acesso, IDOR, idempotência, corrida de pedidos/pagamentos, entrega bloqueada antes de pagar | Sólido, ressalvas F-01, F-02, F-05, F-08, F-09 |
| **Prumo** | Login por código (força bruta, reuso, expiração), escolha de plano, cobrança de cartão simulada, as 18 abas com dados reais (lançamentos, orçamento, cobranças, carteiras, lembretes, dívidas, metas, mercado, coach, cenários, compartilhar, indicar, perfil, plano e dados), limites por plano (Planejador bloqueado no Ousado; Mercado por camadas), cancelamento e desfazer, exportação JSON/XLSX, logout | Funcional, ressalvas F-04, F-06, F-18 |
| **Backoffice** | Login senha + primeiro acesso por código (senha curta/comum/sem número recusadas), 21 rotas GET protegidas sem login (401), todas as telas navegadas, permissões do papel Suporte (12 telas negadas, 4 ações negadas, sem escalonamento), desativar usuário, dono não se rebaixa/desativa, validação de preço, atualização do mercado, auditoria, card de saúde | Sólido, ressalvas F-20 |
| **Integrações** | Indicadores econômicos (Selic/IPCA/CDI carregam), Turnstile (testes unitários: falha aberta se Cloudflare cair), e-mail (log de teste), saúde profunda e monitor | OK em ambiente local/produção sem credenciais externas |
| **API/segurança** | Cabeçalhos (CSP, nosniff, frame, referrer, HSTS), CSRF, CORS, cookies HttpOnly/SameSite, path traversal, arquivos sensíveis, SQLi/XSS/unicode, corpo de 3 MB, JSON quebrado, webhook sem/errado segredo, rotas `/api/dev/*` e `/__dev/axe.js` fechadas em produção, IP direto do servidor bloqueado, `npm audit` | Sólido, ressalvas F-03, F-11, F-12, F-14, F-15 |
| **Layout/acessibilidade** | 3 larguras (375, 768, 1280), axe em todas as telas, detector de estouro/corte de texto, capturas de tela | Ressalvas F-04, F-05, F-10, F-16 |
| **Regras do motor** | 8 cenários-limite (sobra negativa, renda zero, parcela < juros, tudo prescrito, consignado, 10 dívidas, centavos quebrados) sem NaN/Infinity/valor absurdo | Ressalvas F-02, F-07 |

## 4. O que NÃO foi coberto (precisa de você ou de ambiente real)

- **Pagamento real** (Asaas sandbox/produção): Pix, cartão, webhooks reais, recusa, estorno — depende do MEI/Asaas.
- **Entrega real de e-mail** (Resend): caixa de entrada, spam, links de descadastro em e-mails reais, renderização em clientes de e-mail.
- **Outros navegadores e aparelhos reais** (Safari/iOS, Firefox, Android): testado em Chromium emulando 375/768/1280.
- **Carga e desempenho:** nenhum teste de estresse; Pix simulado levou ~4 s para gerar no ambiente local (a conferir com o Asaas real).
- **Teste de invasão profissional**, revisão jurídica dos textos (LGPD/Termos) e dados do rodapé (CNPJ/DPO/contato) — continuam no checklist §11A.
- **IA em produção** (planejador/roteiros com a chave da Anthropic): qualidade e custo reais.
- **Open Finance, Dinheiro esquecido pago, Currículo por vaga, Renegociador, Comparador de financiamento**: fora do escopo atual.

## 5. Ordem sugerida de correção

1. **F-01, F-02** (risco de decisão errada do cliente) · 2. **F-03** (500s) · 3. **F-04, F-05** (layout celular) · 4. **F-06, F-07** (regras) · 5. **F-08, F-09, F-10** · 6. demais (baixa).
Depois das correções: reexecutar `qa/*.mjs`, repetir a varredura de layout em 320/375/768/1280 e rodar uma rodada no sandbox do Asaas quando o MEI sair.
