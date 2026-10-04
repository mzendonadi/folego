import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareFinancing, installments, monthlyIrr, buildFinancingPreview, FinancingInputError } from '../src/financing.ts';
import { buildHouseBillPlan, buildHouseBillPreview, HouseBillInputError } from '../src/housebills.ts';
import { buildForgottenGuide, buildForgottenPreview, ForgottenInputError } from '../src/forgotten.ts';
import { buildResume, buildResumePreview, ResumeInputError } from '../src/resume.ts';

// ---------------------------------------------------------------- financiamento
test('Price: parcelas fecham o saldo em zero e a soma bate com o total', () => {
  const p = installments(1_000_000, 12, 150, 'price');
  assert.equal(p.length, 12);
  // PMT de 10.000,00 a 1,5% a.m. em 12 meses ≈ 916,80
  assert.ok(Math.abs(p[0]! - 91_680) <= 2, `1ª parcela ${p[0]}`);
  const total = p.reduce((s, x) => s + x, 0);
  assert.ok(total > 1_000_000 && total < 1_110_000);
});

test('SAC: parcelas decrescentes e juros menores que no Price', () => {
  const sac = installments(1_000_000, 12, 150, 'sac');
  const price = installments(1_000_000, 12, 150, 'price');
  assert.ok(sac[0]! > sac[11]!);
  assert.ok(sac.reduce((s, x) => s + x, 0) < price.reduce((s, x) => s + x, 0));
});

test('juros zero: parcelas iguais ao principal dividido', () => {
  const p = installments(120_000, 12, 0, 'price');
  assert.ok(p.every((x) => x === 10_000));
});

test('CET sem tarifas é igual à taxa; com tarifa e seguro fica acima', () => {
  const pays = installments(1_000_000, 24, 200, 'price');
  const r = monthlyIrr(1_000_000, pays);
  assert.ok(Math.abs(r - 0.02) < 0.0005, `r=${r}`);
  const withFees = monthlyIrr(1_000_000 - 50_000, pays.map((x) => x + 3_000));
  assert.ok(withFees > r + 0.005);
});

test('comparador: ranking pelo CET, spread e alertas honestos', () => {
  const r = compareFinancing({
    kind: 'veiculo',
    priceCents: 5_000_000,
    downPaymentCents: 1_000_000,
    netIncomeCents: 600_000,
    savingMonthlyCents: 200_000,
    offers: [
      { name: 'Banco A', termMonths: 48, monthlyRateBps: 160, system: 'price', upfrontFeesCents: 0, monthlyExtrasCents: 0 },
      { name: 'Banco B', termMonths: 72, monthlyRateBps: 140, system: 'price', upfrontFeesCents: 120_000, monthlyExtrasCents: 8_000 },
    ],
  });
  assert.equal(r.financedCents, 4_000_000);
  assert.equal(r.offers[r.bestIndex]!.name, 'Banco A', 'o prazo longo com tarifa e seguro sai mais caro');
  assert.ok(r.spreadCents > 0);
  const b = r.offers[1]!;
  assert.ok(b.flags.some((f) => f.code === 'cet_above_rate'));
  assert.ok(b.flags.some((f) => f.code === 'upfront_fees'));
  assert.ok(b.flags.some((f) => f.code === 'monthly_extras'));
  assert.ok(b.flags.some((f) => f.code === 'long_vehicle_term'));
  assert.ok(!r.offers[0]!.flags.some((f) => f.code === 'income_heavy'), 'parcela de ~21% da renda não gera alerta');
  assert.equal(r.waiting!.months, 20); // R$ 40.000 / R$ 2.000 por mês
  const prev = buildFinancingPreview(r);
  assert.match(prev.headline, /Banco A/);
});

test('comparador: entrada maior que o bem e prazo inválido são recusados', () => {
  assert.throws(() => compareFinancing({ kind: 'imovel', priceCents: 100, downPaymentCents: 100, offers: [{ name: 'x', termMonths: 12, monthlyRateBps: 100, system: 'sac', upfrontFeesCents: 0, monthlyExtrasCents: 0 }] }), FinancingInputError);
  assert.throws(() => compareFinancing({ kind: 'imovel', priceCents: 1000, downPaymentCents: 0, offers: [{ name: 'x', termMonths: 0, monthlyRateBps: 100, system: 'sac', upfrontFeesCents: 0, monthlyExtrasCents: 0 }] }), FinancingInputError);
});

// ---------------------------------------------------------------- contas de casa
test('contas de casa: estimativa de principal, parcelamento e prioridade', () => {
  const p = buildHouseBillPlan({ kind: 'energia', overdueCents: 130_000, monthsOverdue: 10, monthlyCapacityCents: 20_000, cutStatus: 'aviso', lowIncome: 'nao_sei', disputesAmount: false });
  assert.equal(p.essential, true);
  assert.equal(p.priority, 'alta');
  // 130.000 / (1 + 0,02 + 0,10) ≈ 116.071
  assert.ok(Math.abs(p.estimatedPrincipalCents - 116_071) <= 1);
  assert.equal(p.installment.count, 7); // ceil(1300/200)
  assert.equal(p.installment.installmentCents, Math.ceil(130_000 / 7));
  assert.ok(p.cutNote && /aviso de corte/i.test(p.cutNote));
  assert.ok(p.lowIncomeNote && /Tarifa Social/.test(p.lowIncomeNote));
  assert.equal(p.channel.phone, '167');
  assert.match(p.letter, /\[SEU NOME\]/);
  const prev = buildHouseBillPreview(p);
  assert.ok(prev.possibleSavingCents > 0);
});

test('contas de casa: internet não é essencial e não tem tarifa social', () => {
  const p = buildHouseBillPlan({ kind: 'internet', overdueCents: 30_000, monthsOverdue: 3, monthlyCapacityCents: 30_000, cutStatus: 'nao', lowIncome: 'sim', disputesAmount: true });
  assert.equal(p.priority, 'media');
  assert.equal(p.lowIncomeNote, null);
  assert.equal(p.installment.count, 1);
  assert.ok(p.disputeNote);
  assert.equal(p.channel.phone, '1331');
  assert.throws(() => buildHouseBillPlan({ kind: 'agua', overdueCents: 0, monthsOverdue: 1, monthlyCapacityCents: 1, cutStatus: 'nao', lowIncome: 'nao', disputesAmount: false }), HouseBillInputError);
});

// ---------------------------------------------------------------- dinheiro esquecido
const baseForgotten = { workedFormal: 'nao', workedBefore1989: 'nao', closedBankAccount: 'nao', consorcioOrCoop: 'nao', relativeDied: 'nao', declaresIr: 'nao', invested: 'nao', lifeInsurance: 'nao', inssBenefit: 'nao' } as const;

test('dinheiro esquecido: sempre inclui as fontes universais e nunca promete valor', () => {
  const g = buildForgottenGuide(baseForgotten);
  assert.deepEqual(g.sources.map((s) => s.id).sort(), ['registrato', 'valores_a_receber']);
  assert.match(g.honesty, /não prometemos valor/);
  assert.ok(g.scamAlerts.length >= 4);
  assert.ok(g.sources.every((s) => s.link.startsWith('https://')));
});

test('dinheiro esquecido: respostas liberam as fontes certas, em ordem de peso', () => {
  const g = buildForgottenGuide({ ...baseForgotten, workedFormal: 'sim', workedBefore1989: 'sim', closedBankAccount: 'sim', relativeDied: 'sim', declaresIr: 'sim', invested: 'sim', lifeInsurance: 'nao_sei', inssBenefit: 'sim' });
  const ids = g.sources.map((s) => s.id);
  for (const id of ['valores_a_receber', 'restituicao_ir', 'fgts', 'pis_pasep', 'b3', 'susep', 'inss', 'herdeiros', 'registrato']) assert.ok(ids.includes(id as never), id);
  assert.equal(ids[0], 'valores_a_receber');
  assert.ok(g.totalMinutes > 60);
  assert.equal(buildForgottenPreview(g).hasHeirPath, true);
  assert.throws(() => buildForgottenGuide({ ...baseForgotten, workedFormal: 'talvez' as never }), ForgottenInputError);
});

// ---------------------------------------------------------------- currículo
const vaga = 'Vaga de Assistente Administrativo. Requisitos: ensino médio completo, 2 anos de experiência, domínio de Excel, atendimento ao cliente por telefone, organização e proatividade. Desejável inglês e CNH B.';

test('currículo: cobertura, faltas honestas e exigências lidas da vaga', () => {
  const r = buildResume({
    targetRole: 'Assistente administrativo',
    level: 'pleno',
    jobText: vaga,
    skills: 'Excel, atendimento, organização',
    education: 'Ensino médio completo',
    languages: '',
    experiences: [{ role: 'Auxiliar de escritório', years: 3, tasks: 'Atendia clientes por telefone\nControlava planilhas de Excel de pedidos; Organizava arquivos' }],
  });
  const labels = r.matched.map((k) => k.label);
  assert.ok(labels.includes('Excel') && labels.includes('Atendimento ao cliente') && labels.includes('Organização'));
  assert.ok(r.missing.some((k) => k.label === 'Inglês'), 'não inventa inglês');
  assert.ok(r.coveragePct > 40 && r.coveragePct < 100);
  assert.equal(r.requirements.yearsExperience, 2);
  assert.ok(r.requirementNotes.some((n) => /destaque/.test(n)));
  assert.ok(r.requirementNotes.some((n) => /CNH/.test(n)));
  assert.equal(r.resume.experiences[0]!.bullets.length, 3);
  assert.ok(r.resume.experiences[0]!.bullets.every((b) => b.needsNumber));
  assert.ok(!/Inglês/.test(r.resume.summary), 'o resumo só usa o que a pessoa já tem');
  assert.match(r.coverLetter, /\[SEU NOME\]/);
  assert.doesNotMatch(JSON.stringify(r), /@|\d{9,}/, 'nenhum dado pessoal no resultado');
  assert.match(buildResumePreview(r).headline, /cobre/);
});

test('currículo: vaga curta ou sem nada informado é recusada', () => {
  assert.throws(() => buildResume({ targetRole: 'x', level: 'entrada', jobText: 'curta', skills: '', education: '', languages: '', experiences: [] }), ResumeInputError);
});
