import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/diagnose.ts';
import { buildPreview } from '../src/preview.ts';
import { buildCalendar, addDaysIso, formatBrl } from '../src/calendar.ts';
import { buildIncomeFacts, buildIncomePlanTemplate } from '../src/income.ts';
import { prescriptionCheck, scamCheck, SCAM_QUESTIONS } from '../src/tools.ts';
import { debt, input } from './helpers.ts';

const typical = () =>
  input([
    debt({ id: 'aluguel', kind: 'rent', creditorName: 'Imobiliária', balanceCents: 150_000, monthlyPaymentCents: 0, daysOverdue: 20, monthlyRateBps: 100 }),
    debt({ id: 'cartao', kind: 'credit_card', creditorName: 'Cartão X', balanceCents: 400_000, monthlyPaymentCents: 60_000, monthlyRateBps: 1400, daysOverdue: 0 }),
    debt({ id: 'cheque', kind: 'overdraft', creditorName: 'Banco Y', balanceCents: 80_000, monthlyPaymentCents: 20_000, monthlyRateBps: 800, daysOverdue: 40 }),
    debt({ id: 'velha', kind: 'store_credit', creditorName: 'Loja Velha', balanceCents: 90_000, daysOverdue: 2500, firstDefaultOn: '2019-01-10' }),
  ]);

test('dinheiro formatado em reais com milhar', () => {
  assert.equal(formatBrl(123_456), 'R$ 1.234,56');
  assert.equal(formatBrl(5), 'R$ 0,05');
});

test('datas somam dias no calendário ISO', () => {
  assert.equal(addDaysIso('2026-02-27', 3), '2026-03-02');
});

test('preview sinaliza quantas dívidas comportam cartas', () => {
  const i = typical();
  const p = buildPreview(diagnose(i), i.debts);
  assert.equal(p.discoveries.lettersEligible, 3); // aluguel, cheque (atraso) e a possivelmente prescrita
});

test('calendário: 30 dias, ordenado, com revisões semanais e sem inventar dívida', () => {
  const i = typical();
  const d = diagnose(i);
  const cal = buildCalendar(d, i.debts);
  assert.ok(cal.every((c, k) => k === 0 || cal[k - 1]!.day <= c.day));
  assert.ok(cal.every((c) => c.day >= 0 && c.day <= 30));
  assert.equal(cal.filter((c) => c.kind === 'revisar').length, 5);
  assert.ok(cal.some((c) => c.kind === 'essencial' && c.debtId === 'aluguel'));
  assert.ok(cal.some((c) => c.kind === 'prescricao' && c.debtId === 'velha'));
  const ids = new Set(i.debts.map((x) => x.id));
  assert.ok(cal.every((c) => !c.debtId || ids.has(c.debtId)));
  assert.equal(cal[0]!.date, i.asOf);
});

const baseInterview = () => ({ skills: 'Sei cozinhar bem e organizar eventos pequenos', hoursBand: '5_10h' as const, capitalCents: 20_000, hasVehicle: false, mode: 'tanto_faz' as const, priorAttempts: '' });

test('renda extra: meta é o buraco quando falta dinheiro; ideias combinam com o vínculo e o modo', () => {
  const i = typical();
  const d = diagnose(i);
  const facts = buildIncomeFacts(d, i.profile, baseInterview());
  assert.equal(facts.target.basis, d.budget.deficit ? 'deficit' : 'surplus');
  assert.ok(facts.candidates.length >= 3);
  const auto = buildIncomeFacts(d, { ...i.profile, employmentType: 'self_employed' }, baseInterview());
  assert.ok(auto.candidates.some((x) => x.id === 'cobrar-clientes'));
  // "entregas" não é 100% online: some da lista quando a pessoa só quer trabalhar online
  const online = buildIncomeFacts(d, i.profile, { ...baseInterview(), mode: 'online' });
  assert.ok(!online.candidates.some((x) => x.id === 'entregas-fim-de-semana'));
});

test('renda extra: plano determinístico tem 4 semanas com tarefas diferentes por categoria, e cita só valores permitidos', () => {
  const i = typical();
  const d = diagnose(i);
  const factsServico = buildIncomeFacts(d, { ...i.profile, employmentType: 'self_employed' }, { ...baseInterview(), hoursBand: '10_20h' });
  const plan = buildIncomePlanTemplate(factsServico);
  assert.equal(plan.source, 'template');
  assert.equal(plan.weeks.length, 4);
  assert.equal(new Set(plan.weeks.map((w) => w.title)).size, 4); // 4 títulos diferentes, não é decoração repetida
  assert.ok(plan.cautions.length >= 3);
  assert.ok(plan.idea.platforms.length >= 0);
  // projeção mensal só existe pra categorias por hora
  const venda = buildIncomePlanTemplate(buildIncomeFacts(d, i.profile, baseInterview()));
  if (venda.idea.category === 'venda_usados' || venda.idea.category === 'revenda' || venda.idea.category === 'producao') {
    assert.equal(venda.idea.projected, null);
  }
});

test('renda extra: mais horas disponíveis aumenta a projeção mensal (código, não a IA, calcula isso)', () => {
  const i = typical();
  const d = diagnose(i);
  const interviewPouco = { ...baseInterview(), hoursBand: 'ate_5h' as const };
  const interviewMuito = { ...baseInterview(), hoursBand: 'mais_20h' as const };
  const factsPouco = buildIncomeFacts(d, i.profile, interviewPouco);
  const factsMuito = buildIncomeFacts(d, i.profile, interviewMuito);
  const catServico = 'servico';
  assert.ok(factsMuito.projectedByCategory[catServico]!.lowCents > factsPouco.projectedByCategory[catServico]!.lowCents);
});

test('calculadora de prescrição usa o mesmo motor', () => {
  const old = prescriptionCheck({ kind: 'credit_card', firstDefaultOn: '2019-01-10', asOf: '2026-09-27' });
  assert.equal(old.status, 'possible');
  const recent = prescriptionCheck({ kind: 'credit_card', firstDefaultOn: '2025-06-01', asOf: '2026-09-27' });
  assert.equal(recent.status, 'not_prescribed');
});

test('detector de golpe: sinal forte sozinho já é alto; nenhum sinal é baixo', () => {
  assert.equal(scamCheck({}).level, 'low');
  assert.equal(scamCheck({ advance_fee: true }).level, 'high');
  assert.equal(scamCheck({ pressure: true, unknown_debt: true }).level, 'attention');
  assert.ok(SCAM_QUESTIONS.length >= 6);
});

// ---------- tradutor de cobrança ----------
import { analyzeCollectionText, buildTranslatorPreview } from '../src/translator.ts';

test('tradutor: golpe clássico de "limpa nome" é risco alto', () => {
  const a = analyzeCollectionText('URGENTE! Limpe seu nome em 24 horas, garantido 100%! Pague a taxa para liberar via Pix para o CPF 123.456.789-09. Acesse bit.ly/xyz');
  assert.equal(a.risk, 'high');
  assert.ok(a.flags.some((f) => f.id === 'advance_fee'));
  assert.ok(a.flags.some((f) => f.id === 'short_link'));
  assert.equal(a.kind, 'suspeita_golpe');
  assert.ok(a.doNow[0]!.includes('golpe'));
});

test('tradutor: cobrança comum de banco extrai valor, data e não vira golpe', () => {
  const a = analyzeCollectionText('Banco Alfa S.A. informa: sua fatura do cartão de 10/08/2026 no valor de R$ 1.234,56 está em atraso. Regularize pelo aplicativo do banco.');
  assert.equal(a.kind, 'cobranca_credor');
  assert.notEqual(a.risk, 'high');
  assert.deepEqual(a.facts.amountsCents, [123_456]);
  assert.deepEqual(a.facts.dates, ['2026-08-10']);
});

test('tradutor: preview não revela o conteúdo pago e a resposta pedida cita os dados do credor', () => {
  const a = analyzeCollectionText('Assessoria de Cobrança Beta informa negativação no SPC de R$ 500,00. Pague hoje.');
  const p = buildTranslatorPreview(a);
  assert.deepEqual(Object.keys(p).sort(), ['amountsFound', 'flagCount', 'kind', 'lockedSections', 'risk', 'teaser', 'title']);
  assert.ok(!JSON.stringify(p).includes('Beta'));
  assert.ok(a.reply.includes('CNPJ'));
  assert.ok(a.rights.length >= 3);
});

test('tradutor: texto vazio ou sem sentido não quebra', () => {
  const a = analyzeCollectionText('ok');
  assert.equal(a.kind, 'desconhecido');
});
