// Investimentos (posição estimada, IR regressivo) e as "jogadas" de estratégia. Dados inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlays, businessDays, irPctForDays, nextIrStep, summarizeInvestments, viewInvestment } from '../src/index.ts';
import type { InvestmentInput, StrategySnapshot } from '../src/index.ts';

const rates = { cdiAnnualPct: 14.5 };
const cdb: InvestmentInput = { appliedCents: 25_376, indexer: 'cdi', ratePct: 102, appliedOn: '2026-09-01', status: 'ativo' };

test('dias úteis e tabela regressiva do IR', () => {
  assert.equal(businessDays('2026-10-23', '2026-10-26'), 1, 'sexta -> segunda: só a segunda conta');
  assert.equal(irPctForDays(30), 22.5);
  assert.equal(irPctForDays(181), 20);
  assert.equal(irPctForDays(400), 17.5);
  assert.equal(irPctForDays(900), 15);
  assert.deepEqual(nextIrStep(150), { inDays: 31, toPct: 20 });
  assert.equal(nextIrStep(800), null);
});

test('posição: informada vale mais que a estimada; CDI a 102% rende um pouco mais que o CDI', () => {
  const est = viewInvestment(cdb, '2026-10-26', rates);
  assert.equal(est.estimated, true);
  assert.ok(est.yieldCents > 0 && est.yieldCents < 600, String(est.yieldCents));
  assert.ok(est.netYieldCents < est.yieldCents, 'o IR desconta do rendimento');
  const informed = viewInvestment({ ...cdb, positionCents: 25_774 }, '2026-10-26', rates);
  assert.equal(informed.estimated, false);
  assert.equal(informed.yieldCents, 398);
  assert.equal(informed.yieldPct, 1.57);
});

test('totais: ativo entra no investido, processando fica à parte, resgatado some', () => {
  const t = summarizeInvestments([
    { input: { ...cdb, positionCents: 25_774 } },
    { input: { appliedCents: 77_000, indexer: 'cdi', ratePct: 102, appliedOn: '2026-10-26', status: 'processando' } },
    { input: { ...cdb, status: 'resgatado' } },
  ], '2026-10-26', rates);
  assert.equal(t.count, 1);
  assert.equal(t.appliedCents, 25_376);
  assert.equal(t.positionCents, 25_774);
  assert.equal(t.processingCents, 77_000);
  assert.equal(t.processingCount, 1);
});

const base: StrategySnapshot = {
  today: '2026-10-26', cdiAnnualPct: 14.5, selicPct: 14.75, monthlyIncomeCents: 1_600_000, monthlyExpenseCents: 1_200_000,
  wallets: [], investments: [], debts: [], cards: [],
};

test('jogadas: conta no negativo com aplicação líquida sugere resgatar e conta a economia', () => {
  const plays = buildPlays({
    ...base,
    wallets: [{ name: 'Conta Exemplo', kind: 'conta', balanceCents: -186_212, overdraftLimitCents: 1_000_000, overdraftRateBps: 800, overdraftFreeDays: null }],
    investments: [{ name: 'CDB Exemplo', positionCents: 100_000, appliedCents: 99_000, appliedOn: '2026-09-01', indexer: 'cdi', ratePct: 102, liquidity: 'diaria', status: 'ativo' }],
  });
  const p = plays.find((x) => x.id === 'redeem-Conta Exemplo');
  assert.ok(p, JSON.stringify(plays.map((x) => x.id)));
  assert.equal(p!.priority, 'alta');
  assert.ok((p!.monthlySavingCents ?? 0) > 5_000, 'economia mensal estimada');
});

test('jogadas: dias de limite sem juros viram instrução; dívida mais cara primeiro; rotativo avisa o custo', () => {
  const plays = buildPlays({
    ...base,
    wallets: [{ name: 'Conta Exemplo', kind: 'conta', balanceCents: -50_000, overdraftLimitCents: 500_000, overdraftRateBps: null, overdraftFreeDays: 10 }],
    debts: [{ name: 'Empréstimo A', balanceCents: 500_000, monthlyRatePct: 3 }, { name: 'Cartão B', balanceCents: 300_000, monthlyRatePct: 14 }],
    cards: [{ name: 'Cartão Exemplo', openCents: 562_956, overdue: true, revolvingMonthlyPct: 14 }],
  });
  assert.ok(plays.some((x) => x.id === 'free-Conta Exemplo' && /10 dias/.test(x.title)));
  assert.match(plays.find((x) => x.id === 'avalanche')!.title, /Cartão B/);
  assert.ok(plays.some((x) => x.id === 'revolving-Cartão Exemplo'));
  assert.equal(plays[0]!.priority, 'alta');
});

test('jogadas: IR perto de cair de degrau e rendimento baixo aparecem; sem dados, nenhuma jogada', () => {
  const plays = buildPlays({
    ...base,
    investments: [
      { name: 'CDB Novo', positionCents: 110_000, appliedCents: 100_000, appliedOn: '2026-05-10', indexer: 'cdi', ratePct: 102, liquidity: 'diaria', status: 'ativo' },
      { name: 'Poupança', positionCents: 50_000, appliedCents: 49_000, appliedOn: '2025-01-10', indexer: 'poupanca', ratePct: 0, liquidity: 'diaria', status: 'ativo' },
    ],
  });
  assert.ok(plays.some((x) => x.id.startsWith('ir-CDB Novo')), JSON.stringify(plays.map((x) => x.id)));
  assert.ok(plays.some((x) => x.id === 'low-Poupança'));
  assert.deepEqual(buildPlays(base), []);
});
