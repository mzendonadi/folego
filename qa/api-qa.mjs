// QA de API do Fôlego/Prumo/Backoffice contra um servidor local (QA_BASE) ou, em modo leitura, contra produção.
// Uso: QA_BASE=http://localhost:3100 QA_LOG=/tmp/qa-server.log node qa/api-qa.mjs
// Cada verificação vira uma linha: PASS / FAIL / INFO. O resultado completo vai para qa/resultado-api.json.
import fs from 'node:fs';

const BASE = process.env.QA_BASE ?? 'http://localhost:3100';
const LOG = process.env.QA_LOG ?? '/tmp/qa-server.log';
const results = [];
const rec = (area, nome, ok, detalhe = '') => {
  results.push({ area, nome, ok, detalhe: String(detalhe).slice(0, 400) });
  console.log(`${ok === 'info' ? 'INFO' : ok ? 'PASS' : 'FAIL'} [${area}] ${nome}${detalhe && ok !== true ? ' :: ' + String(detalhe).slice(0, 200) : ''}`);
};
const eq = (area, nome, got, want) => rec(area, nome, got === want, `esperado ${want}, veio ${got}`);

function client(extra = {}) {
  let cookie = '';
  const call = async (method, url, { body, headers, raw, noGuard } = {}) => {
    const res = await fetch(BASE + url, {
      method,
      redirect: 'manual',
      headers: { ...(noGuard ? {} : { 'x-folego': '1' }), ...(body === undefined && raw === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...extra, ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* texto */ }
    return { status: res.status, json, text, headers: res.headers, setCookie: set };
  };
  call.cookie = () => cookie;
  return call;
}

const validCase = () => ({
  profile: { netIncomeCents: 320_000, fixedExpensesCents: 170_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [
    { creditorName: 'Aluguel atrasado', kind: 'rent', balanceCents: 150_000, monthlyRateBps: 100, daysOverdue: 25 },
    { creditorName: 'Cartão QA_CARTAO', kind: 'credit_card', balanceCents: 420_000, monthlyPaymentCents: 42_000, daysOverdue: 0 },
    { creditorName: 'Loja QA_PRESCRITA', kind: 'store_credit', balanceCents: 90_000, daysOverdue: 2500, firstDefaultOn: '2019-01-10' },
  ],
  acceptTerms: true,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function lastCode(email) {
  const t = fs.readFileSync(LOG, 'utf8');
  const lines = t.split('\n').filter((l) => l.includes(email) || l.includes('código') || l.includes('code'));
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/\b(\d{6})\b/);
    if (m) return m[1];
  }
  const all = [...t.matchAll(/\b(\d{6})\b/g)];
  return all.length ? all.at(-1)[1] : null;
}

// ---------------------------------------------------------------- 1. infraestrutura e cabeçalhos
{
  const c = client();
  const h = await c('GET', '/api/health');
  eq('infra', 'GET /api/health = 200', h.status, 200);
  const hd = await c('GET', '/api/health/deep');
  rec('infra', 'GET /api/health/deep responde JSON com checks', Boolean(hd.json?.checks), hd.text);
  const idx = await c('GET', '/', { noGuard: true });
  eq('infra', 'GET / = 200', idx.status, 200);
  const need = ['content-security-policy', 'x-content-type-options', 'referrer-policy'];
  for (const k of need) rec('seguranca', `cabeçalho ${k} presente na home`, idx.headers.has(k), [...idx.headers.keys()].join(','));
  rec('seguranca', 'home com X-Frame-Options ou frame-ancestors', idx.headers.has('x-frame-options') || /frame-ancestors/.test(idx.headers.get('content-security-policy') ?? ''));
  const api404 = await c('GET', '/api/nao-existe');
  eq('infra', 'rota inexistente = 404', api404.status, 404);
  rec('infra', '404 da API é JSON (não HTML/stack)', api404.json !== null && !/at .*\.ts/.test(api404.text), api404.text);
  const badJson = await c('POST', '/api/cases', { raw: '{"profile":' });
  rec('infra', 'JSON quebrado = 4xx (não 500)', badJson.status >= 400 && badJson.status < 500, badJson.status + ' ' + badJson.text);
  const big = await c('POST', '/api/cases', { raw: JSON.stringify({ x: 'a'.repeat(3_000_000) }) });
  rec('infra', 'corpo de 3 MB recusado (413/4xx)', big.status === 413 || (big.status >= 400 && big.status < 500), big.status);
  const noGuard = await c('POST', '/api/cases', { body: validCase(), noGuard: true });
  rec('seguranca', 'POST sem cabeçalho x-folego é recusado (CSRF)', noGuard.status === 403 || noGuard.status === 400, noGuard.status + ' ' + noGuard.text.slice(0, 100));
  const cors = await c('GET', '/api/catalog', { headers: { origin: 'https://evil.example' } });
  rec('seguranca', 'sem CORS aberto para origem alheia', !cors.headers.get('access-control-allow-origin'), cors.headers.get('access-control-allow-origin'));
  const sess = await c('POST', '/api/cases', { body: validCase() });
  const sc = sess.setCookie ?? '';
  rec('seguranca', 'cookie de sessão HttpOnly + SameSite', /httponly/i.test(sc) && /samesite/i.test(sc), sc);
  const dir = await c('GET', '/..%2f..%2fpackage.json', { noGuard: true });
  rec('seguranca', 'path traversal não vaza arquivos', dir.status !== 200 || !/"name"/.test(dir.text), dir.status);
  for (const p of ['/.env', '/deploy/.env', '/apps/api/src/app.ts', '/db/schema.sql', '/.git/config']) {
    const r = await c('GET', p, { noGuard: true });
    rec('seguranca', `arquivo sensível ${p} não é servido`, r.status !== 200 || r.text.trim().startsWith('<!doctype') || r.text.includes('<html'), r.status);
  }
}

// ---------------------------------------------------------------- 2. catálogo, caso, preview, pagamento
let paidOrder = null;
{
  const c = client();
  const cat = await c('GET', '/api/catalog');
  eq('catalogo', 'catálogo 200', cat.status, 200);
  const prods = cat.json?.products ?? cat.json ?? [];
  const price = (code) => prods.find?.((p) => p.code === code)?.priceCents;
  rec('catalogo', 'Mapa custa R$ 29,00 (2900)', price('recovery_map') === 2900, JSON.stringify(prods).slice(0, 300));
  const created = await c('POST', '/api/cases', { body: validCase() });
  eq('caso', 'criar caso válido = 201/200', created.status === 201 || created.status === 200, true);
  const id = created.json?.caseId;
  rec('caso', 'resposta traz id do caso', Boolean(id), created.text.slice(0, 200));
  const prev = await c('GET', `/api/cases/${id}/preview`);
  eq('caso', 'preview 200', prev.status, 200);
  const prevTxt = prev.text;
  rec('negocio', 'preview NÃO vaza roteiros/conteúdo pago', !/script|roteiro completo|negotiation_scripts/i.test(JSON.stringify(prev.json?.deliverable ?? {})) , prevTxt.slice(0, 200));
  rec('negocio', 'preview traz nota/score', /score|nota|grade/i.test(prevTxt), prevTxt.slice(0, 200));
  rec('negocio', 'dívida prescrita sinalizada fora da conta', /prescri|statute|limitation/i.test(prevTxt), prevTxt.slice(0, 200));

  // isolamento (IDOR)
  const outro = client();
  const idor = await outro('GET', `/api/cases/${id}/preview`);
  rec('seguranca', 'IDOR: outra sessão não lê o preview', idor.status === 403 || idor.status === 404, idor.status);
  const idorDel = await outro('DELETE', `/api/cases/${id}`);
  rec('seguranca', 'IDOR: outra sessão não apaga o caso', idorDel.status === 403 || idorDel.status === 404, idorDel.status);

  // validações
  const base = validCase();
  const variantes = {
    'sem aceite dos termos': { ...base, acceptTerms: false },
    'renda negativa': { ...base, profile: { ...base.profile, netIncomeCents: -1 } },
    'renda gigante (1e15)': { ...base, profile: { ...base.profile, netIncomeCents: 1e15 } },
    'UF inválida': { ...base, profile: { ...base.profile, uf: 'XX9' } },
    'sem dívidas': { ...base, debts: [] },
    '200 dívidas': { ...base, debts: Array.from({ length: 200 }, (_, i) => ({ ...base.debts[0], creditorName: 'D' + i })) },
    'saldo zero': { ...base, debts: [{ ...base.debts[0], balanceCents: 0 }] },
    'saldo negativo': { ...base, debts: [{ ...base.debts[0], balanceCents: -5 }] },
    'taxa absurda': { ...base, debts: [{ ...base.debts[0], monthlyRateBps: 99999999 }] },
    'dias de atraso negativos': { ...base, debts: [{ ...base.debts[0], daysOverdue: -3 }] },
    'tipo de dívida inventado': { ...base, debts: [{ ...base.debts[0], kind: 'bitcoin' }] },
    'campo extra desconhecido': { ...base, hack: true },
    'nome com 5000 chars': { ...base, debts: [{ ...base.debts[0], creditorName: 'x'.repeat(5000) }] },
    'nome vazio': { ...base, debts: [{ ...base.debts[0], creditorName: '' }] },
    'data futura inadimplência': { ...base, debts: [{ ...base.debts[2], firstDefaultOn: '2999-01-01' }] },
    'data inválida': { ...base, debts: [{ ...base.debts[2], firstDefaultOn: '31/02/2020' }] },
  };
  for (const [nome, body] of Object.entries(variantes)) {
    const r = await client()('POST', '/api/cases', { body });
    const aceitaOk = ['campo extra desconhecido'].includes(nome);
    rec('validacao', `caso: ${nome}`, aceitaOk ? r.status < 500 : r.status >= 400 && r.status < 500, `status ${r.status} ${r.text.slice(0, 120)}`);
  }
  // injeção / XSS no nome
  for (const [nome, payload] of [['SQLi', "x'); DROP TABLE app.cases;--"], ['XSS', '<img src=x onerror=alert(1)>'], ['unicode/emoji', '💸 Cartão ñ 日本語'], ['null byte', 'a\u0000b']]) {
    const b = validCase();
    b.debts[0].creditorName = payload;
    const r = await client()('POST', '/api/cases', { body: b });
    rec('seguranca', `nome de credor com ${nome} não gera 500`, nome === 'null byte' ? r.status === 400 : r.status < 500, `${r.status} ${r.text.slice(0, 100)}`);
  }
  const alive = await c('GET', '/api/health');
  eq('seguranca', 'banco continua de pé depois das injeções', alive.status, 200);

  // pedido sem pagar -> sem entrega
  const ord = await c('POST', '/api/orders', { body: { caseId: id, products: ['recovery_map'] }, headers: { 'idempotency-key': 'qa-' + Date.now() } });
  rec('pedido', 'criar pedido do Mapa', ord.status === 201 || ord.status === 200, ord.text.slice(0, 200));
  const oid = ord.json?.orderId;
  const ord2 = await c('POST', '/api/orders', { body: { caseId: id, products: ['recovery_map'] }, headers: { 'idempotency-key': 'qa-same-key-123' } });
  const ord3 = await c('POST', '/api/orders', { body: { caseId: id, products: ['recovery_map'] }, headers: { 'idempotency-key': 'qa-same-key-123' } });
  rec('pedido', 'mesma Idempotency-Key devolve o mesmo pedido', ord2.json?.orderId === ord3.json?.orderId && ord2.json?.orderId, ord2.text.slice(0, 80) + ' | ' + ord3.text.slice(0, 80));
  const badProd = await c('POST', '/api/orders', { body: { caseId: id, products: ['produto_falso'] }, headers: { 'idempotency-key': 'qa-x' + Date.now() } });
  rec('validacao', 'produto inexistente recusado', badProd.status >= 400 && badProd.status < 500, badProd.status);
  const emptyProd = await c('POST', '/api/orders', { body: { caseId: id, products: [] }, headers: { 'idempotency-key': 'qa-y' + Date.now() } });
  rec('validacao', 'pedido sem produtos recusado', emptyProd.status >= 400 && emptyProd.status < 500, emptyProd.status);
  const noKey = await c('POST', '/api/orders', { body: { caseId: id, products: ['recovery_map'] } });
  rec('validacao', 'pedido sem Idempotency-Key recusado', noKey.status >= 400 && noKey.status < 500, noKey.status);
  const del0 = await c('GET', `/api/orders/${oid}/delivery`);
  rec('negocio', 'entrega ANTES de pagar é bloqueada (402/403/409)', [402, 403, 404, 409].includes(del0.status), del0.status + ' ' + del0.text.slice(0, 100));
  // pagar (rota de teste do servidor local)
  const pay = await c('POST', `/api/dev/pay/${oid}`, { body: {} });
  rec('pedido', 'pagamento simulado confirma', pay.status < 300, pay.status + ' ' + pay.text.slice(0, 100));
  await sleep(500);
  const del1 = await c('GET', `/api/orders/${oid}/delivery`);
  rec('negocio', 'entrega DEPOIS de pagar é liberada', del1.status === 200, del1.status + ' ' + del1.text.slice(0, 150));
  const delOutro = await outro('GET', `/api/orders/${oid}/delivery`);
  rec('seguranca', 'IDOR: outra sessão não lê a entrega paga', delOutro.status === 403 || delOutro.status === 404 || delOutro.status === 401, delOutro.status);
  const link = await c('POST', `/api/orders/${oid}/access-link`, { body: {} });
  rec('pedido', 'gera link de acesso em outro aparelho', link.status < 300, link.status + ' ' + link.text.slice(0, 120));
  paidOrder = { id: oid, link: link.json };
  const tk = link.json?.token ?? link.json?.link?.split?.('=').pop();
  let dono = c; // quem é o dono do caso agora
  if (tk) {
    const novo = client();
    const acc = await novo('POST', '/api/access', { body: { token: tk } });
    rec('pedido', 'link de acesso reabre o Mapa em outro navegador', acc.status < 300, acc.status + ' ' + acc.text.slice(0, 120));
    const acc2 = await client()('POST', '/api/access', { body: { token: tk.slice(0, -2) + 'zz' } });
    rec('seguranca', 'token de acesso adulterado é recusado', acc2.status >= 400 && acc2.status < 500, acc2.status);
    dono = novo; // decisão documentada: o Mapa passa a pertencer ao aparelho que abriu o link
  }
  // webhook
  const w0 = await c('POST', '/webhooks/pix', { body: { eventId: 'x', paymentId: 'y' }, noGuard: true });
  rec('seguranca', 'webhook sem segredo = 401/403', w0.status === 401 || w0.status === 403, w0.status);
  const w1 = await c('POST', '/webhooks/pix', { body: { eventId: 'x', paymentId: 'y' }, headers: { 'x-webhook-secret': 'errado' }, noGuard: true });
  rec('seguranca', 'webhook com segredo errado = 401/403', w1.status === 401 || w1.status === 403, w1.status);
  // LGPD: apagar caso (pelo dono atual)
  const dc = await dono('DELETE', `/api/cases/${id}`);
  rec('lgpd', 'titular consegue apagar o próprio caso', dc.status < 300, dc.status);
  const afterDel = await dono('GET', `/api/cases/${id}/preview`);
  rec('lgpd', 'caso apagado some (404/410)', afterDel.status === 404 || afterDel.status === 410 || afterDel.status === 403, afterDel.status);
}

// ---------------------------------------------------------------- 3. eventos / rastreamento / unsubscribe
{
  const c = client();
  const ev = await c('POST', '/api/events', { body: { name: 'qa_evento', path: '/' } });
  rec('rastreamento', 'POST /api/events não gera 5xx', ev.status < 500, ev.status + ' ' + ev.text.slice(0, 100));
  const evBad = await c('POST', '/api/events', { body: { name: 'x'.repeat(10000) } });
  rec('rastreamento', 'evento gigante recusado sem 5xx', evBad.status < 500, evBad.status);
  const un = await c('POST', '/api/unsubscribe', { body: { token: 'invalido' } });
  rec('validacao', 'unsubscribe com token inválido = 4xx', un.status >= 400 && un.status < 500, un.status);
}

// ---------------------------------------------------------------- 4. Prumo (assinatura)
const email = `qa${Date.now()}@exemplo.com`;
const u = client();
{
  const noAuth = await client()('GET', '/api/account');
  eq('prumo', 'GET /api/account sem login = 401', noAuth.status, 401);
  rec('info', 'corpo do erro sem login', 'info', noAuth.text);
  for (const [m, p] of [['GET', '/api/account/export'], ['GET', '/api/account/debts'], ['POST', '/api/account/entries'], ['GET', '/api/account/coach'], ['GET', '/api/account/market'], ['DELETE', '/api/account']]) {
    const r = await client()(m, p, { body: m === 'POST' ? {} : undefined });
    rec('seguranca', `${m} ${p} sem login bloqueado`, r.status === 401 || r.status === 403, r.status + ' ' + r.text.slice(0, 80));
  }
  const badEmail = await u('POST', '/api/account/login-code', { body: { email: 'nao-e-email' } });
  rec('validacao', 'login-code com e-mail inválido = 4xx', badEmail.status >= 400 && badEmail.status < 500, badEmail.status);
  const lc = await u('POST', '/api/account/login-code', { body: { email } });
  rec('prumo', 'pede código de acesso', lc.status < 300, lc.status + ' ' + lc.text.slice(0, 100));
  await sleep(600);
  const code = lastCode(email);
  rec('prumo', 'código de 6 dígitos chegou (log do e-mail de teste)', Boolean(code), 'sem código no log');
  const wrong = await u('POST', '/api/account/login', { body: { email, code: '000000' } });
  rec('seguranca', 'código errado recusado', wrong.status === 401 || wrong.status === 400 || wrong.status === 403, wrong.status);
  const login = await u('POST', '/api/account/login', { body: { email, code } });
  rec('prumo', 'login com o código certo', login.status < 300, login.status + ' ' + login.text.slice(0, 100));
  const reuse = await client()('POST', '/api/account/login', { body: { email, code } });
  rec('seguranca', 'código só vale uma vez', reuse.status >= 400, reuse.status);
  const acc = await u('GET', '/api/account');
  eq('prumo', 'GET /api/account logado = 200', acc.status, 200);
  rec('prumo', 'conta sem assinatura ainda (sem plano)', !acc.json?.subscription || acc.json?.subscription?.status !== 'active', acc.text.slice(0, 200));

  // checkout de cada plano
  const ordP = await u('POST', '/api/account/subscription-order', { body: { plan: 'ousado' }, headers: { 'idempotency-key': 'qa-sub-' + Date.now() } });
  rec('prumo', 'cria pedido de assinatura Ousado', ordP.status < 300, ordP.status + ' ' + ordP.text.slice(0, 200));
  const badPlan = await u('POST', '/api/account/subscription-order', { body: { plan: 'premium' }, headers: { 'idempotency-key': 'qa-bp' + Date.now() } });
  rec('validacao', 'plano inexistente recusado', badPlan.status >= 400 && badPlan.status < 500, badPlan.status);
  const payP = await u('POST', `/api/dev/pay/${ordP.json?.orderId}`, { body: {} });
  rec('prumo', 'simula pagamento da assinatura', payP.status < 300, payP.status + ' ' + payP.text.slice(0, 120));
  await sleep(500);
  const acc2 = await u('GET', '/api/account');
  rec('prumo', 'assinatura ativa no plano Ousado', acc2.json?.subscription?.plan === 'ousado' && acc2.json?.subscription?.active === true, JSON.stringify(acc2.json?.subscription));
  
  // lançamentos
  const hoje = new Date().toISOString().slice(0, 10);
  const mes = hoje.slice(0, 7);
  const add = await u('POST', '/api/account/entries', { body: { entries: [{ date: hoje, note: 'Salário', amountCents: 500000 }, { date: hoje, note: 'Mercado', amountCents: -80000 }, { date: hoje, note: 'Netflix', amountCents: -3990 }] } });
  rec('prumo', 'adiciona lançamentos', add.status < 300, add.status + ' ' + add.text.slice(0, 200));
  const month = await u('GET', `/api/account/month/${mes}`);
  eq('prumo', 'visão do mês 200', month.status, 200);
  const badMonth = await u('GET', '/api/account/month/2020-13');
  rec('validacao', 'mês inválido (2020-13) = 4xx', badMonth.status >= 400 && badMonth.status < 500, badMonth.status);
  const badMonth2 = await u('GET', '/api/account/month/abc');
  rec('validacao', 'mês "abc" = 4xx', badMonth2.status >= 400 && badMonth2.status < 500, badMonth2.status);
  const addBad = await u('POST', '/api/account/entries', { body: { entries: [{ date: 'ontem', note: '', amountCents: 0 }] } });
  rec('validacao', 'lançamento inválido recusado', addBad.status >= 400 && addBad.status < 500, addBad.status);
  const addMany = await u('POST', '/api/account/entries', { body: { entries: Array.from({ length: 5000 }, (_, i) => ({ date: hoje, note: 'L' + i, amountCents: -100 })) } });
  rec('validacao', 'lote de 5000 lançamentos não gera 5xx', addMany.status < 500, addMany.status + ' ' + addMany.text.slice(0, 100));

  // dívidas / metas / carteiras
  const debt = await u('POST', '/api/account/debts', { body: { name: 'Banco QA', balanceCents: 1000000, monthlyRateBps: 450, minPaymentCents: 50000 } });
  rec('prumo', 'cria dívida na conta', debt.status < 300, debt.status + ' ' + debt.text.slice(0, 200));
  const debts = await u('GET', '/api/account/debts');
  rec('prumo', 'lista dívidas com plano de quitação', debts.status === 200, debts.text.slice(0, 200));
  const goal = await u('POST', '/api/account/goals', { body: { name: 'Reserva QA', targetCents: 1000000, dueOn: '2027-12-31' } });
  rec('prumo', 'cria meta', goal.status < 300, goal.status + ' ' + goal.text.slice(0, 200));
  const goalBad = await u('POST', '/api/account/goals', { body: { name: 'x', targetCents: -10 } });
  rec('validacao', 'meta com valor negativo recusada', goalBad.status >= 400 && goalBad.status < 500, goalBad.status);
  const wal = await u('POST', '/api/account/wallets', { body: { name: 'Nubank QA', kind: 'conta' } });
  rec('prumo', 'cria carteira', wal.status < 300, wal.status + ' ' + wal.text.slice(0, 200));
  const rem = await u('POST', '/api/account/reminders', { body: { title: 'Luz', dueOn: '2026-10-20', amountCents: 20000 } });
  rec('prumo', 'cria lembrete', rem.status < 300, rem.status + ' ' + rem.text.slice(0, 200));
  const rec1 = await u('GET', '/api/account/recurring');
  rec('prumo', 'cobranças recorrentes responde', rec1.status === 200, rec1.text.slice(0, 160));
  const scn = await u('GET', '/api/account/scenario-base');
  rec('prumo', 'base do "e se...?" responde (Ousado)', scn.status === 200, scn.status + ' ' + scn.text.slice(0, 160));
  const mkt = await u('GET', '/api/account/market');
  rec('negocio', 'Mercado em camadas no Ousado: sem dólar e sem histórico (só Desbravador)', mkt.status === 200 && mkt.json?.indicators?.usdBrl === null && mkt.json?.history === null, mkt.status + ' ' + mkt.text.slice(0, 160));
  const pl = await u('POST', '/api/account/planner', { body: { question: 'Como quitar?' } });
  rec('negocio', 'Planejador IA bloqueado no Ousado', pl.status === 402 || pl.status === 403, pl.status);
  const exp = await u('GET', '/api/account/export');
  rec('lgpd', 'exportação dos dados (JSON) funciona', exp.status === 200, exp.status);
  const xl = await u('GET', '/api/account/export.xlsx');
  rec('lgpd', 'exportação XLSX funciona', xl.status === 200, xl.status);
  const prof = await u('PUT', '/api/account/profile', { body: { displayName: 'QA Teste' } });
  rec('prumo', 'atualiza perfil', prof.status < 300, prof.status + ' ' + prof.text.slice(0, 120));
  const prof2 = await u('PUT', '/api/account/profile', { body: { displayName: '<script>alert(1)</script>'.repeat(50) } });
  rec('validacao', 'perfil com nome enorme/script não gera 5xx', prof2.status < 500, prof2.status);

  // conta compartilhada
  const inv = await u('POST', '/api/account/household/invite', { body: { email: `par${Date.now()}@exemplo.com` } });
  rec('prumo', 'convite de conta compartilhada (Ousado)', inv.status < 300, inv.status + ' ' + inv.text.slice(0, 150));
  const invSelf = await u('POST', '/api/account/household/invite', { body: { email } });
  rec('validacao', 'não convida a si mesmo', invSelf.status >= 400 && invSelf.status < 500, invSelf.status);

  // indicações
  const refs = await u('GET', '/api/account/referrals');
  rec('prumo', 'indicações: código/link', refs.status === 200, refs.text.slice(0, 200));

  // cancelamento
  const can = await u('POST', '/api/account/subscription-cancel', { body: { cancel: true } });
  rec('prumo', 'cancela a renovação', can.status < 300, can.status + ' ' + can.text.slice(0, 150));
  const acc3 = await u('GET', '/api/account');
  rec('negocio', 'cancelamento: continua ativo até o fim do período', acc3.json?.subscription?.cancelAtPeriodEnd === true && acc3.json?.subscription?.active === true, JSON.stringify(acc3.json?.subscription));
  const undo = await u('POST', '/api/account/subscription-cancel', { body: { cancel: false } });
  rec('prumo', 'desfaz o cancelamento', undo.status < 300, undo.status);

  // sessão
  const out = await u('POST', '/api/account/logout', { body: {} });
  rec('prumo', 'logout', out.status < 300, out.status);
  const after = await u('GET', '/api/account');
  eq('seguranca', 'após logout, /account = 401', after.status, 401);
}

// ---------------------------------------------------------------- 5. backoffice sem credencial
{
  const c = client();
  for (const p of ['/api/gestao/dashboard', '/api/gestao/saude', '/api/gestao/clientes/avulsos', '/api/gestao/assinaturas', '/api/gestao/config', '/api/gestao/mercado', '/api/gestao/ebooks']) {
    const r = await c('GET', p);
    rec('seguranca', `backoffice ${p} sem login bloqueado`, r.status === 401, r.status);
  }
  const loginBad = await c('POST', '/api/admin/login', { body: { email: 'qa@exemplo.com', password: 'x' } });
  rec('seguranca', 'login admin com dados inválidos não gera 5xx', loginBad.status < 500, loginBad.status);
  const prod = await c('POST', '/api/admin/partners', { body: {} });
  rec('seguranca', 'criar parceiro sem token admin bloqueado', [401, 403, 404].includes(prod.status), prod.status);
  const pl = await c('POST', '/api/partner/login', { body: { token: 'zzz' } });
  rec('seguranca', 'login de parceiro com token falso recusado', pl.status === 401 || pl.status === 403 || pl.status === 400, pl.status);
  const pleads = await c('GET', '/api/partner/leads');
  rec('seguranca', 'lista de leads sem login de parceiro bloqueada', pleads.status === 401 || pleads.status === 403, pleads.status);
}

// ---------------------------------------------------------------- 6. rate limit (só se o servidor estiver em modo estrito)
if (process.env.QA_RATE === '1') {
  const c = client();
  let blocked = 0;
  for (let i = 0; i < 20; i++) {
    const r = await c('POST', '/api/account/login-code', { body: { email: `rate${i}@exemplo.com` } });
    if (r.status === 429) blocked++;
  }
  rec('seguranca', 'rate limit do login-code dispara (429)', blocked > 0, `${blocked} bloqueios em 20`);
}

fs.mkdirSync(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), { recursive: true });
fs.writeFileSync(new URL('./resultado-api.json', import.meta.url), JSON.stringify(results, null, 2));
const fails = results.filter((r) => r.ok === false);
console.log(`\n== ${results.length} verificações · ${results.length - fails.length} ok · ${fails.length} falhas`);
