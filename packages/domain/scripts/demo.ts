import { diagnose } from '../src/diagnose.ts';
import { buildPreview } from '../src/preview.ts';
import type { DiagnoseInput } from '../src/types.ts';

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const input: DiagnoseInput = {
  asOf: '2026-09-26',
  profile: { netIncomeCents: 320_000, fixedExpensesCents: 170_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' },
  debts: [
    { id: 'aluguel', creditorName: 'Aluguel atrasado', kind: 'rent', balanceCents: 150_000, monthlyPaymentCents: 0, daysOverdue: 25, monthlyRateBps: 100 },
    { id: 'cartao', creditorName: 'Cartão Banco A', kind: 'credit_card', balanceCents: 420_000, monthlyPaymentCents: 42_000, daysOverdue: 0 },
    { id: 'cheque', creditorName: 'Cheque especial', kind: 'overdraft', balanceCents: 110_000, monthlyPaymentCents: 15_000, daysOverdue: 0 },
    { id: 'emprestimo', creditorName: 'Empréstimo pessoal', kind: 'personal_loan', balanceCents: 600_000, monthlyPaymentCents: 32_000, remainingInstallments: 24, daysOverdue: 0 },
    { id: 'loja', creditorName: 'Loja de móveis', kind: 'store_credit', balanceCents: 90_000, daysOverdue: 2500, firstDefaultOn: '2019-01-10' },
  ],
};

const d = diagnose(input);
console.log('— PREVIEW (o que sai antes de pagar) —');
console.log(JSON.stringify(buildPreview(d, input.debts), null, 2));

console.log('\n— DIAGNÓSTICO COMPLETO —');
console.log(`Nota: ${d.health.score}/100 (${d.health.band})  confiança: ${d.confidence}`);
console.log(`Sobra mensal: ${brl(d.budget.surplusCents)} | destinado às dívidas: ${brl(d.budget.poolCents)}/mês`);
console.log('Ordem:', d.order.join(' → '), '| fora da conta (verificar prescrição):', d.heldAsideIds.join(', ') || '—');
console.log(`Baseline: ${d.baseline.months ?? 'nunca quita'} meses | Plano: ${d.plan.months ?? 'nunca quita'} meses`);
console.log(`Juros poupados: ${d.interestSavedCents === null ? '—' : brl(d.interestSavedCents)}`);
console.log(`Potencial de negociação (estimativa): ${brl(d.negotiationPotential.lowCents)} a ${brl(d.negotiationPotential.highCents)}`);
console.log(`Troca por consignado: ${d.refinance.reason}, economia estimada ${brl(d.refinance.estimatedSavingsCents)}`);
console.log('Avisos:', d.warnings.map((w) => w.code).join(', '));
