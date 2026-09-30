import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, planHas, categorize, parseMoneyBr, parseDateAny, parseCsvExtract, parseOfx, parseExtract, summarizeMonth, buildAlerts, coachInsights, simulateInvestment } from '../src/account.ts';

test('planos: cada nível inclui o anterior e só o Desbravador tem simulador', () => {
  assert.equal(PLANS.length, 3);
  assert.ok(planHas('controle', 'ledger') && !planHas('controle', 'goals'));
  assert.ok(planHas('ousado', 'goals') && planHas('ousado', 'coach') && !planHas('ousado', 'simulator'));
  assert.ok(planHas('desbravador', 'simulator'));
  assert.deepEqual(PLANS.map((p) => p.priceCents), [1999, 3999, 5999]);
});

test('dinheiro e datas em formatos brasileiros', () => {
  assert.equal(parseMoneyBr('1.234,56'), 123_456);
  assert.equal(parseMoneyBr('-45,90'), -4590);
  assert.equal(parseMoneyBr('R$ 12,00'), 1200);
  assert.equal(parseMoneyBr('(45,90)'), -4590);
  assert.equal(parseMoneyBr('45,90-'), -4590);
  assert.equal(parseMoneyBr('-1234.56'), -123_456);
  assert.equal(parseMoneyBr('abc'), null);
  assert.equal(parseMoneyBr('0,00'), null);
  assert.equal(parseDateAny('05/03/2026'), '2026-03-05');
  assert.equal(parseDateAny('2026-03-05'), '2026-03-05');
  assert.equal(parseDateAny('20260305120000'), '2026-03-05');
  assert.equal(parseDateAny('31/02/2026'), null);
});

test('CSV de banco (ponto e vírgula, vírgula decimal, cabeçalho) e sem cabeçalho', () => {
  const csv = 'Data;Descrição;Valor\n05/03/2026;PIX RECEBIDO JOAO;1.500,00\n06/03/2026;SUPERMERCADO X;-230,45\nlinha ruim\n';
  const r = parseCsvExtract(csv);
  assert.equal(r.entries.length, 2);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.entries[1], { date: '2026-03-06', amountCents: -23_045, note: 'SUPERMERCADO X' });
  const bare = parseCsvExtract('2026-03-07,Uber viagem,-18.90\n2026-03-08,Salario,3200.00');
  assert.equal(bare.entries.length, 2);
  assert.equal(bare.entries[0]!.amountCents, -1890);
});

test('OFX: lê data, valor e memo', () => {
  const ofx = '<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260310120000<TRNAMT>-89.90<MEMO>NETFLIX</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260311<TRNAMT>2500.00<NAME>SALARIO</STMTTRN></OFX>';
  const r = parseExtract(ofx, 'extrato.ofx');
  assert.deepEqual(r.entries.map((e) => e.amountCents), [-8990, 250_000]);
  assert.equal(r.entries[0]!.note, 'NETFLIX');
});

test('categorização: regras simples e entrada positiva vira renda', () => {
  assert.equal(categorize('SUPERMERCADO BOM PRECO', -5000), 'mercado');
  assert.equal(categorize('Uber *trip', -2000), 'transporte');
  assert.equal(categorize('Fatura cartão', -90000), 'dividas');
  assert.equal(categorize('Pix recebido', 10000), 'renda');
  assert.equal(categorize('coisa qualquer', -100), 'outros');
});

const entries = [
  { date: '2026-08-05', amountCents: 300_000, category: 'renda', note: 'Salario' },
  { date: '2026-08-10', amountCents: -60_000, category: 'mercado', note: 'Mercado' },
  { date: '2026-08-12', amountCents: -20_000, category: 'lazer', note: 'Netflix' },
  { date: '2026-09-05', amountCents: 300_000, category: 'renda', note: 'Salario' },
  { date: '2026-09-08', amountCents: -95_000, category: 'mercado', note: 'Mercado' },
  { date: '2026-09-10', amountCents: -20_000, category: 'lazer', note: 'Netflix' },
  { date: '2026-07-10', amountCents: -20_000, category: 'lazer', note: 'Netflix' },
];

test('resumo do mês soma por categoria e marca o que passou do limite', () => {
  const s = summarizeMonth(entries, { mercado: 80_000 }, '2026-09');
  assert.equal(s.incomeCents, 300_000);
  assert.equal(s.spendCents, 115_000);
  assert.equal(s.balanceCents, 185_000);
  assert.equal(s.byCategory[0]!.category, 'mercado');
  assert.equal(s.byCategory[0]!.over, true);
  assert.ok(Math.abs(s.savingsRate! - 185_000 / 300_000) < 1e-9);
});

test('alertas: limite estourado e meta vencida', () => {
  const a = buildAlerts(entries, { mercado: 80_000 }, [{ name: 'Viagem', targetCents: 100_000, savedCents: 10_000, dueOn: '2026-09-01' }], '2026-09-20');
  assert.ok(a.some((x) => x.title.includes('passou do limite')));
  assert.ok(a.some((x) => x.title.includes('Meta vencida')));
});

test('treinador: cita números reais, detecta aumento e gasto recorrente, calcula reserva', () => {
  const c = coachInsights(entries, {}, '2026-09-20');
  const ids = c.map((x) => x.id);
  assert.ok(ids.includes('top') && ids.includes('rate') && ids.includes('reserve') && ids.includes('recurring'));
  assert.ok(ids.includes('up-mercado')); // 60 mil -> 95 mil
  assert.ok(c.find((x) => x.id === 'top')!.detail.includes('R$'));
});

test('simulador: juros compostos mensais equivalentes, inflação desconta o valor real', () => {
  const [r] = simulateInvestment({ initialCents: 100_000, monthlyCents: 0, months: 12, scenarios: [{ name: 'X', annualPct: 12 }], inflationAnnualPct: 0 });
  assert.equal(r!.finalCents, 112_000);
  const [zero] = simulateInvestment({ initialCents: 0, monthlyCents: 10_000, months: 12, scenarios: [{ name: 'Sem rendimento', annualPct: 0 }], inflationAnnualPct: 0 });
  assert.equal(zero!.finalCents, 120_000);
  const [real] = simulateInvestment({ initialCents: 100_000, monthlyCents: 0, months: 12, scenarios: [{ name: 'X', annualPct: 12 }], inflationAnnualPct: 5 });
  assert.ok(real!.realFinalCents < real!.finalCents);
});
