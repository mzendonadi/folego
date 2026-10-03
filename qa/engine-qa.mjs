// QA das regras de negócio do motor via API local (preview + entrega): cenários limite, sem NaN/Infinity/negativos absurdos.
const B = process.env.QA_BASE ?? 'http://localhost:3100';
const mk = () => { let k = ''; return async (m, u, b, h = {}) => { const r = await fetch(B + u, { method: m, headers: { 'x-folego': '1', ...(b ? { 'content-type': 'application/json' } : {}), ...(k ? { cookie: k } : {}), ...h }, body: b ? JSON.stringify(b) : undefined }); const s = r.headers.get('set-cookie'); if (s) k = s.split(';')[0]; const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, t }; }; };
const base = { employmentType: 'clt', ageBand: '35-44', uf: 'SP' };
const cases = {
  'sobra negativa (renda < despesas)': { profile: { ...base, netIncomeCents: 150000, fixedExpensesCents: 200000 }, debts: [{ creditorName: 'Banco', kind: 'personal_loan', balanceCents: 500000, monthlyPaymentCents: 30000, daysOverdue: 40 }] },
  'renda zero': { profile: { ...base, netIncomeCents: 0, fixedExpensesCents: 0 }, debts: [{ creditorName: 'Banco', kind: 'credit_card', balanceCents: 300000, daysOverdue: 10 }] },
  'parcela < juros (nunca quita)': { profile: { ...base, netIncomeCents: 200000, fixedExpensesCents: 190000 }, debts: [{ creditorName: 'Cartão', kind: 'credit_card', balanceCents: 2000000, monthlyPaymentCents: 10000, monthlyRateBps: 1400, daysOverdue: 90 }] },
  'sem dívida em atraso e sobra alta': { profile: { ...base, netIncomeCents: 1000000, fixedExpensesCents: 200000 }, debts: [{ creditorName: 'Financiamento', kind: 'financing', balanceCents: 1000000, monthlyPaymentCents: 100000, monthlyRateBps: 120, daysOverdue: 0 }] },
  'tudo prescrito': { profile: { ...base, netIncomeCents: 300000, fixedExpensesCents: 150000 }, debts: [{ creditorName: 'Loja', kind: 'store_credit', balanceCents: 90000, daysOverdue: 3000, firstDefaultOn: '2018-01-10' }] },
  'consignado (teto)': { profile: { ...base, employmentType: 'inss_retiree', netIncomeCents: 200000, fixedExpensesCents: 120000 }, debts: [{ creditorName: 'Consignado', kind: 'payroll_loan', balanceCents: 1200000, monthlyPaymentCents: 40000, monthlyRateBps: 250, daysOverdue: 0 }] },
  '10 dívidas variadas': { profile: { ...base, netIncomeCents: 450000, fixedExpensesCents: 200000 }, debts: ['credit_card', 'overdraft', 'personal_loan', 'store_credit', 'utility', 'rent', 'other', 'financing', 'payroll_loan', 'credit_card'].map((k, i) => ({ creditorName: 'D' + i, kind: k, balanceCents: 100000 + i * 50000, monthlyPaymentCents: 5000, daysOverdue: i * 20 })) },
  'centavos quebrados': { profile: { ...base, netIncomeCents: 333333, fixedExpensesCents: 111111 }, debts: [{ creditorName: 'A', kind: 'personal_loan', balanceCents: 123457, monthlyRateBps: 333, monthlyPaymentCents: 12345, daysOverdue: 7 }, { creditorName: 'B', kind: 'store_credit', balanceCents: 76543, monthlyRateBps: 177, monthlyPaymentCents: 7654, daysOverdue: 0 }] },
};
const bad = (v, path, out) => { if (typeof v === 'number' && !Number.isFinite(v)) out.push(path + '=' + v); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) bad(x, path + '.' + k, out); };
let fails = 0;
for (const [name, c] of Object.entries(cases)) {
  const c1 = mk();
  const r = await c1('POST', '/api/cases', { ...c, acceptTerms: true });
  if (r.s !== 201 && r.s !== 200) { console.log('FAIL', name, 'criar caso', r.s, r.t.slice(0, 150)); fails++; continue; }
  const p = r.j.preview;
  const nf = []; bad(r.j, '', nf);
  const neg = JSON.stringify(r.j).match(/-\d{7,}/g);
  console.log((nf.length ? 'FAIL' : 'ok  '), name, '| nota', p.health?.score, p.health?.band, '| headline', p.headline?.kind, '| total', p.totalBalanceCents, '| nonfinite', nf.join(',') || '-', neg ? '| neg ' + neg.slice(0, 3) : '');
  if (nf.length) fails++;
  const o = await c1('POST', '/api/orders', { caseId: r.j.caseId, products: ['recovery_map'] }, { 'idempotency-key': 'e' + Math.random().toString(36).slice(2) + Date.now() });
  await c1('POST', '/api/dev/pay/' + o.j.orderId, {});
  await new Promise((x) => setTimeout(x, 300));
  const d = await c1('GET', '/api/orders/' + o.j.orderId + '/delivery');
  const nf2 = []; bad(d.j, '', nf2);
  const txt = JSON.stringify(d.j);
  const flags = [];
  if (/NaN|Infinity|undefined|null null/.test(txt)) flags.push('texto-ruim');
  if (nf2.length) flags.push('nonfinite:' + nf2.slice(0, 3).join(','));
  const plan = d.j?.deliverable ?? d.j;
  console.log('     entrega', d.s, flags.length ? 'FAIL ' + flags.join(' ') : 'ok', '| resumo:', (txt.match(/"(quitar|payoffMonths|monthsToPayoff)[^,]*/) || [''])[0]);
  if (flags.length) fails++;
}
console.log('falhas:', fails);
