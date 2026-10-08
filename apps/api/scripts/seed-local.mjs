// Dados de exemplo (SINTÉTICOS) para o ambiente LOCAL de testes. Fala com a API em execução, como um cliente de verdade.
//   1) inicie a API local (iniciar-local.cmd)  2) node apps/api/scripts/seed-local.mjs [http://localhost:3000]
// Recusa rodar contra produção ou contra um gateway de pagamento real.
const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');

function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'x-folego': '1', 'user-agent': 'SeedLocal/1.0', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return json;
  };
}

const health = await client()('GET', '/api/health');
if (health.env === 'production' || health.gateway !== 'fake') throw new Error(`Recusado: a API em ${BASE} não é um ambiente local de testes (env=${health.env}, gateway=${health.gateway}).`);

const cpf = (base9) => {
  const d = [...base9].map(Number);
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  d.push(dv(9));
  d.push(dv(10));
  return d.join('');
};
const today = new Date();
const iso = (daysAgo) => new Date(today.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
let n = 0;
const key = () => `seed-${Date.now()}-${n++}`;

// ---------- Compradores de Pix (diagnóstico → Mapa) ----------
const personas = [
  { emp: 'clt', clt: 'permanent', age: '35-44', uf: 'SP', renda: 420000, fixas: 210000, pago: true, extras: ['defense_letters'], debts: [['Cartão Banco Azul', 'credit_card', 850000, 80000, 45], ['Loja Casa Mais', 'store_credit', 180000, 0, 400], ['Aluguel', 'rent', 240000, 0, 20]] },
  { emp: 'clt', clt: 'temporary', age: '25-34', uf: 'RJ', renda: 290000, fixas: 160000, pago: true, extras: [], debts: [['Cheque especial', 'overdraft', 120000, 0, 15], ['Empréstimo pessoal', 'personal_loan', 600000, 52000, 0]] },
  { emp: 'public_servant', age: '45-54', uf: 'DF', renda: 780000, fixas: 380000, pago: true, extras: ['calendar_30d'], debts: [['Consignado', 'payroll_loan', 3000000, 120000, 0], ['Cartão', 'credit_card', 1500000, 150000, 90]] },
  { emp: 'inss_retiree', age: '65-74', uf: 'MG', renda: 210000, fixas: 140000, pago: true, extras: [], debts: [['Consignado INSS', 'payroll_loan', 900000, 60000, 0]] },
  { emp: 'self_employed', age: '35-44', uf: 'PR', renda: 350000, fixas: 180000, pago: true, extras: ['defense_letters', 'calendar_30d'], debts: [['Financiamento moto', 'financing', 1800000, 95000, 120], ['Energia', 'utility', 45000, 0, 60]] },
  { emp: 'other', nota: 'bicos e diárias', age: '18-24', uf: 'BA', renda: 120000, fixas: 90000, pago: true, extras: [], debts: [['Cartão digital', 'credit_card', 280000, 0, 200]] },
  { emp: 'clt', clt: 'permanent', age: '25-34', uf: 'RS', renda: 380000, fixas: 200000, pago: false, pix: true, debts: [['Cartão', 'credit_card', 520000, 0, 30]] },
  { emp: 'self_employed', age: '45-54', uf: 'SC', renda: 500000, fixas: 260000, pago: false, pix: true, debts: [['Empréstimo', 'personal_loan', 900000, 70000, 10]] },
  { emp: 'clt', clt: 'temporary', age: '18-24', uf: 'CE', renda: 180000, fixas: 110000, pago: false, pix: false, debts: [['Loja', 'store_credit', 90000, 0, 75]] },
  { emp: 'public_servant', age: '55-64', uf: 'GO', renda: 640000, fixas: 330000, pago: false, pix: false, debts: [['Cartão', 'credit_card', 700000, 60000, 0]] },
];
let pagos = 0;
for (const [i, p] of personas.entries()) {
  const c = client();
  const caso = await c('POST', '/api/cases', {
    profile: { netIncomeCents: p.renda, fixedExpensesCents: p.fixas, employmentType: p.emp, ageBand: p.age, uf: p.uf, ...(p.clt ? { cltContract: p.clt } : {}), ...(p.nota ? { employmentNote: p.nota } : {}) },
    debts: p.debts.map(([creditorName, kind, balanceCents, monthlyPaymentCents, daysOverdue]) => ({ creditorName, kind, balanceCents, ...(monthlyPaymentCents ? { monthlyPaymentCents } : {}), daysOverdue })),
    acceptTerms: true,
  });
  if (p.pago || p.pix) {
    const contact = { email: `cliente${i + 1}@exemplo.local`, phone: `1191234${String(1000 + i)}`, adsConsent: true };
    const pedido = await c('POST', '/api/orders', { caseId: caso.caseId, products: ['recovery_map', ...(p.extras ?? [])], contact }, { 'idempotency-key': key() });
    if (p.pago) {
      await c('POST', `/api/dev/pay/${pedido.orderId}`, {});
      pagos++;
    }
  }
}
console.log(`Diagnósticos: ${personas.length} (${pagos} pagos, 2 com Pix gerado e sem pagar, 2 só com o resultado grátis)`);

// ---------- Tradutor de cobrança ----------
for (const [i, texto] of ['Seu nome será negativado em 5 dias caso não regularize o débito de R$ 1.200,00. Pague já.', 'Última chance: quite a dívida hoje com 90% de desconto via Pix para o CPF 000.000.000-00 ou sofra ação judicial.'].entries()) {
  const c = client();
  const tr = await c('POST', '/api/translations', { text: texto, acceptTerms: true });
  const pedido = await c('POST', '/api/orders', { caseId: tr.caseId, products: ['collection_translator'], contact: { email: `tradutor${i + 1}@exemplo.local`, phone: `1198888${String(2000 + i)}`, adsConsent: true } }, { 'idempotency-key': key() });
  if (i === 0) await c('POST', `/api/dev/pay/${pedido.orderId}`, {});
}
console.log('Tradutor: 2 (1 pago)');

// ---------- Assinantes do Prumo (cartão simulado) ----------
const assinantes = [
  ['ana.controle@exemplo.local', 'Ana Souza Lima', 'controle', false],
  ['bruno.ousado@exemplo.local', 'Bruno Alves Costa', 'ousado', false],
  ['carla.desbravadora@exemplo.local', 'Carla Mendes Rocha', 'desbravador', false],
  ['diego.cancelou@exemplo.local', 'Diego Ferreira Nunes', 'ousado', true],
];
for (const [i, [email, nome, plano, cancela]] of assinantes.entries()) {
  const c = client();
  const out = await c('POST', '/api/account/login-code', { email });
  if (!out.devCode) throw new Error('A API local precisa de EXPOSE_DEV_CODES=1 (use o iniciar-local.cmd).');
  await c('POST', '/api/account/login', { email, code: out.devCode });
  const ck = await c('POST', '/api/account/subscription-checkout', { plan: plano, acceptTerms: true, cpf: cpf(`12345${String(1000 + i)}`.slice(0, 9)), name: nome, phone: `1197777${String(3000 + i)}`, adsConsent: true });
  await c('POST', `/api/dev/pay/${ck.orderId}`, {});
  await c('POST', '/api/account/entries', {
    entries: [
      { date: iso(2), amountCents: 520000, note: 'Salário' },
      { date: iso(3), amountCents: -145000, note: 'Aluguel' },
      { date: iso(4), amountCents: -38000, note: 'Supermercado' },
      { date: iso(6), amountCents: -12900, note: 'Streaming e apps' },
      { date: iso(9), amountCents: -21000, note: 'Combustível' },
    ],
  });
  if (plano !== 'controle') await c('POST', '/api/account/goals', { // metas são do plano Ousado em diante
 name: 'Reserva de emergência', targetCents: 1200000, savedCents: 150000 + i * 50000 });
  if (cancela) await c('POST', '/api/account/subscription-cancel', { cancel: true });
}
console.log(`Assinantes: ${assinantes.length} (1 cancelando)`);
console.log('\nPronto. Site: ' + BASE + '  ·  Backoffice: ' + BASE + '/gestao/  ·  Entrar no Prumo: ' + BASE + '/conta (código aparece na tela no ambiente local)');
