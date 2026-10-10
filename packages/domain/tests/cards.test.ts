// Cartões de crédito: ciclo da fatura, limite usado, parcelas, rotativo, estratégias e leitor de fatura em PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardStrategies, dueInstallments, floatDays, installmentCommitments, invoiceDates, invoiceKeyOf, limitLevel, parseCardInvoice, revolvingOptions, summarizeCard } from '../src/index.ts';

const card = { closingDay: 5, dueDay: 12, limitCents: 500_000 };

test('fatura: compra antes do fechamento fica na fatura do mês; no dia do fechamento ou depois vai para a seguinte', () => {
  assert.equal(invoiceKeyOf('2026-10-04', card), '2026-10');
  assert.equal(invoiceKeyOf('2026-10-05', card), '2026-11');
  assert.equal(invoiceKeyOf('2026-12-20', card), '2027-01');
  assert.deepEqual(invoiceDates('2026-10', card), { closingOn: '2026-10-05', dueOn: '2026-10-12' });
  // vence antes do fechamento no calendário: cai no mês seguinte (fecha dia 25, vence dia 5)
  assert.deepEqual(invoiceDates('2026-10', { closingDay: 25, dueDay: 5 }), { closingOn: '2026-10-25', dueOn: '2026-11-05' });
  // fechamento no dia 31 vale o último dia de meses curtos
  assert.equal(invoiceDates('2026-02', { closingDay: 31, dueDay: 10 }).closingOn, '2026-02-28');
  assert.equal(invoiceKeyOf('2026-02-28', { closingDay: 31, dueDay: 10 }), '2026-03');
});

test('prazo: comprar logo depois do fechamento dá o maior prazo até vencer', () => {
  assert.equal(floatDays('2026-10-04', card), 8);
  assert.equal(floatDays('2026-10-05', card), 38); // vai para a fatura de novembro, que vence em 12/11
  assert.ok(floatDays('2026-10-06', card) > floatDays('2026-10-04', card));
});

test('resumo: faturas, pagamento abate a mais antiga, limite usado com parcelas futuras e níveis', () => {
  const charges = [
    { date: '2026-09-10', amountCents: 50_000 },
    { date: '2026-10-02', amountCents: 30_000 },
    { date: '2026-10-15', amountCents: 20_000 },
  ];
  const s = summarizeCard(card, charges, [], [], '2026-10-20');
  assert.equal(s.usedCents, 100_000);
  assert.equal(s.availableCents, 400_000);
  assert.equal(s.usedPct, 20);
  assert.equal(s.level, 'ok');
  assert.equal(s.current.key, '2026-11');
  assert.equal(s.current.status, 'open');
  assert.equal(s.current.totalCents, 20_000);
  assert.equal(s.due?.key, '2026-10');
  assert.equal(s.due?.status, 'overdue');
  assert.equal(s.due?.remainingCents, 80_000);

  const paid = summarizeCard(card, charges, [{ date: '2026-10-10', amountCents: 80_000 }], [], '2026-10-20');
  assert.equal(paid.usedCents, 20_000);
  assert.equal(paid.invoices.find((i) => i.key === '2026-10')?.status, 'paid');
  assert.equal(paid.due?.key, '2026-11', 'sem fatura fechada em aberto, a próxima a pagar é a aberta');

  // dentro do prazo: fechada e ainda não vencida
  const before = summarizeCard(card, charges.slice(0, 2), [], [], '2026-10-08');
  assert.equal(before.due?.status, 'closed');
  assert.equal(before.due?.daysToDue, 4);

  // parcelas que ainda vão chegar contam no limite
  const plan = { perCents: 10_000, totalN: 10, postedN: 1, firstOn: '2026-10-15' };
  const withPlan = summarizeCard(card, charges, [], [plan], '2026-10-20');
  assert.equal(withPlan.futureInstallmentsCents, 90_000);
  assert.equal(withPlan.usedCents, 190_000);

  assert.equal(limitLevel(350_000, 500_000), 'attention');
  assert.equal(limitLevel(460_000, 500_000), 'high');
  assert.equal(limitLevel(520_000, 500_000), 'over');
  assert.equal(limitLevel(10, 0), 'none');
});

test('parcelas: lança só as que já venceram e projeta as próximas por mês', () => {
  const plan = { perCents: 20_000, totalN: 4, postedN: 0, firstOn: '2026-08-15' };
  assert.deepEqual(dueInstallments(plan, '2026-10-20'), [{ no: 1, date: '2026-08-15' }, { no: 2, date: '2026-09-15' }, { no: 3, date: '2026-10-15' }]);
  assert.deepEqual(dueInstallments({ ...plan, postedN: 3 }, '2026-10-20'), []);
  const c = installmentCommitments([{ ...plan, postedN: 3 }, { perCents: 5_000, totalN: 3, postedN: 1, firstOn: '2026-09-30' }], '2026-10-20', 4);
  assert.deepEqual(c, [{ month: '2026-10', cents: 5_000 }, { month: '2026-11', cents: 25_000 }, { month: '2026-12', cents: 0 }, { month: '2027-01', cents: 0 }]);
});

test('rotativo: pagar só o mínimo leva muito mais tempo e custa juros; pagar tudo não custa nada', () => {
  const o = revolvingOptions(300_000, 1400, 100_000);
  const by = Object.fromEntries(o.map((x) => [x.id, x]));
  assert.equal(by.full!.totalInterestCents, 0);
  assert.ok(by.minimum!.months > by.half!.months);
  assert.ok(by.minimum!.totalInterestCents > by.half!.totalInterestCents);
  assert.ok(by.fixed!.months >= 3 && by.fixed!.months < by.minimum!.months);
  assert.ok(by.minimum!.totalInterestCents > 100_000, 'o mínimo custa mais de um terço da dívida em juros');
});

test('estratégias: fatura vencida é alerta; melhor cartão para comprar hoje; parcelas pesadas na renda', () => {
  const a = { id: 'a', name: 'Banco Azul', terms: { closingDay: 5, dueDay: 12 }, rateBps: 1400 };
  const b = { id: 'b', name: 'Banco Verde', terms: { closingDay: 20, dueDay: 28 }, rateBps: 1000 };
  const today = '2026-10-21';
  const sa = summarizeCard({ ...a.terms, limitCents: 100_000 }, [{ date: '2026-09-10', amountCents: 40_000 }, { date: '2026-10-15', amountCents: 40_000 }], [], [], today);
  const sb = summarizeCard({ ...b.terms, limitCents: 400_000 }, [{ date: '2026-10-01', amountCents: 150_000 }], [], [], today);
  const list = cardStrategies([{ ...a, summary: sa }, { ...b, summary: sb }], { today, incomeCents: 500_000, commitments: [{ month: '2026-11', cents: 200_000 }] });
  const ids = list.map((x) => x.id);
  assert.equal(list[0]!.level, 'alert');
  assert.ok(ids.includes('overdue-a'), 'a fatura do Azul venceu em 12/10');
  assert.ok(ids.includes('limit-a'), '80% do limite do Azul');
  assert.ok(ids.includes('best-card'));
  assert.equal(list.find((x) => x.id === 'best-card')!.cardId, 'b', 'o Verde (fecha dia 20) dá mais prazo para a compra de hoje');
  assert.equal(list.find((x) => x.id === 'installments')!.level, 'warn', '200 de 500 = 40% da renda');
  assert.ok(ids.includes('best-day'));
});

test('fatura em PDF (datas 12/10): compras, parcela 03/10, pagamento, vencimento, fechamento e conferência com o total', () => {
  const text = [
    'Fatura Cartão Banco Azul',
    'Vencimento 10/11/2026',
    'Fechamento 03/11/2026',
    'Total desta fatura R$ 1.234,56',
    'Lançamentos',
    '15/10 MERCADO CENTRAL 245,60',
    '17/10 UBER *TRIP 23,90',
    '20/10 NOTEBOOK LOJA X PARC 03/10 199,90',
    '22/10 PAGAMENTO RECEBIDO -500,00',
    '25/10 NETFLIX.COM 55,90',
    '28/10 SUPERMERCADO NOVO 1.209,26',
    'Total de compras 1.734,56',
  ].join('\n');
  const r = parseCardInvoice(text, new Date('2026-11-01T12:00:00Z'));
  assert.equal(r.entries.length, 5);
  assert.deepEqual(r.meta, { closingOn: '2026-11-03', dueOn: '2026-11-10', totalCents: 123_456, year: 2026 });
  assert.equal(r.credits.length, 1);
  assert.equal(r.credits[0]!.amountCents, 50_000);
  const nb = r.entries.find((e) => e.note.startsWith('NOTEBOOK'))!;
  assert.deepEqual([nb.installmentNo, nb.installmentTotal, nb.amountCents, nb.note, nb.date], [3, 10, 19_990, 'NOTEBOOK LOJA X', '2026-10-20']);
  assert.deepEqual(r.check, { ok: true, expectedCents: 123_456, parsedCents: 123_456 });
});

test('fatura em PDF (datas 12 OUT, valor na linha seguinte): parcela 2/3, estorno e virada de ano', () => {
  const text = [
    'Data de vencimento: 10 NOV 2026',
    'Fechamento: 03 NOV 2026',
    'Total a pagar',
    'R$ 310,40',
    'TRANSAÇÕES DE 04 OUT A 03 NOV',
    '15 OUT Padaria Pão Quente R$ 25,50',
    '18 OUT Amazon Parcela 2/3 R$ 90,00',
    '22 OUT Estorno Compra Loja R$ 100,10',
    '30 OUT Posto Ipiranga R$ 295,00',
  ].join('\n');
  const r = parseCardInvoice(text);
  assert.equal(r.entries.length, 3);
  assert.equal(r.credits.length, 1);
  assert.equal(r.entries[1]!.note, 'Amazon');
  assert.deepEqual([r.entries[1]!.installmentNo, r.entries[1]!.installmentTotal], [2, 3]);
  assert.equal(r.check?.ok, true);

  // fatura de janeiro com compras de dezembro: o ano da compra é o anterior
  const jan = parseCardInvoice(['Vencimento 10/01/2027', 'Fechamento 03/01/2027', '28/12 FARMACIA X 40,00', '02/01 PADARIA 10,00'].join('\n'));
  assert.deepEqual(jan.entries.map((e) => e.date), ['2026-12-28', '2027-01-02']);
});

test('fatura em PDF: sem total no arquivo não inventa conferência; texto sem lançamentos devolve vazio', () => {
  const noTotal = parseCardInvoice(['Vencimento 10/11/2026', '15/10 MERCADO 10,00'].join('\n'));
  assert.equal(noTotal.entries.length, 1);
  assert.equal(noTotal.check, null);
  const empty = parseCardInvoice('Olá, este PDF não tem nada de fatura.');
  assert.deepEqual([empty.entries.length, empty.credits.length, empty.check], [0, 0, null]);
});
