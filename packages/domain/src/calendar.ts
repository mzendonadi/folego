// Calendário dos 30 dias (produto calendar_30d): transforma o diagnóstico em ações com data.
// Só usa números do motor (nada é inventado) e nunca promete resultado de negociação.
import type { DebtInput, Diagnosis } from './types.ts';
import { RULES } from './config.ts';
import { parseIsoDate } from './prescription.ts';

export type CalendarKind = 'orcamento' | 'essencial' | 'prescricao' | 'negociar' | 'pagar' | 'revisar';

export interface CalendarItem {
  day: number; // 0 = hoje
  date: string; // YYYY-MM-DD
  kind: CalendarKind;
  title: string;
  detail: string;
  debtId?: string;
  amountCents?: number;
}

export function formatBrl(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(parseIsoDate(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

export function buildCalendar(diagnosis: Diagnosis, debts: DebtInput[]): CalendarItem[] {
  const byId = new Map(debts.map((d) => [d.id, d]));
  const diagById = new Map(diagnosis.debts.map((d) => [d.debtId, d]));
  const at = (day: number) => Math.min(30, day);
  const items: CalendarItem[] = [];
  const push = (day: number, i: Omit<CalendarItem, 'day' | 'date'>) => items.push({ day: at(day), date: addDaysIso(diagnosis.asOf, at(day)), ...i });
  const b = diagnosis.budget;

  push(0, {
    kind: 'orcamento',
    title: 'Conferir seu orçamento do mês',
    detail: b.deficit
      ? `Suas contas passam da renda em ${formatBrl(b.gapCents)} por mês. Hoje, o objetivo é achar onde fechar essa conta: cortar, renegociar parcela ou aumentar a renda.`
      : `Separe ${formatBrl(b.extraToDebtCents)} por mês para acelerar as dívidas, no mesmo dia em que o salário cair.`,
    amountCents: b.deficit ? b.gapCents : b.extraToDebtCents,
  });

  let essentialDay = 1;
  for (const id of diagnosis.order) {
    const dg = diagById.get(id);
    const debt = byId.get(id);
    if (dg?.tier !== 'essential_overdue' || !debt) continue;
    push(essentialDay++, {
      kind: 'essencial',
      debtId: id,
      title: `Regularizar ${debt.creditorName} (conta essencial)`,
      detail: 'Moradia e serviços básicos vêm primeiro: procure o credor esta semana e combine uma forma de pagar antes que o problema cresça.',
      amountCents: debt.balanceCents,
    });
  }

  let held = 2;
  for (const id of diagnosis.heldAsideIds) {
    const debt = byId.get(id);
    if (!debt) continue;
    push(held++, {
      kind: 'prescricao',
      debtId: id,
      title: `Não pague nem negocie ${debt.creditorName} ainda`,
      detail: 'Esta dívida pode estar prescrita. Pagar ou reconhecer uma parte pode reiniciar o prazo. Confirme com a Defensoria Pública ou um advogado antes de qualquer contato.',
      amountCents: debt.balanceCents,
    });
  }

  let firstPaid = false;
  diagnosis.order.forEach((id, index) => {
    const dg = diagById.get(id);
    const debt = byId.get(id);
    if (!debt || !dg || dg.tier === 'essential_overdue') return;
    const day = 3 + index * 3;
    if (debt.daysOverdue > 0) {
      push(day, {
        kind: 'negociar',
        debtId: id,
        title: `Negociar ${debt.creditorName}`,
        detail: `Peça o demonstrativo e proponha pagar à vista com desconto. Em atraso, costuma-se conseguir entre ${RULES.negotiationDiscount.lowPct}% e ${RULES.negotiationDiscount.highPct}% (não é garantia). Use o roteiro do seu Mapa e anote o protocolo.`,
        amountCents: debt.balanceCents,
      });
    } else {
      const firstExtra = !firstPaid && b.extraToDebtCents > 0;
      push(day, {
        kind: 'pagar',
        debtId: id,
        title: firstExtra ? `Direcionar o extra para ${debt.creditorName}` : `Pagar a parcela de ${debt.creditorName} em dia`,
        detail: firstExtra
          ? `É a dívida com juros mais altos: cada real a mais aqui economiza mais. Extra do mês: ${formatBrl(b.extraToDebtCents)}, além da parcela.`
          : 'Pague pelo menos a parcela combinada, sem atraso. Ativar lembrete ou débito automático ajuda.',
        amountCents: firstExtra ? b.extraToDebtCents : debt.monthlyPaymentCents,
      });
      firstPaid = true;
    }
  });

  [7, 14, 21, 28].forEach((day, i) =>
    push(day, {
      kind: 'revisar',
      title: `Revisão da semana ${i + 1} (15 minutos)`,
      detail: 'Veja o que foi feito, o que está atrasado e o que fica para a próxima semana. Marque cada protocolo e cada pagamento.',
    }),
  );
  push(30, {
    kind: 'revisar',
    title: 'Refazer o diagnóstico',
    detail: 'Passados 30 dias, atualize os saldos e veja como ficou a ordem de pagamento.',
  });

  return items.sort((a, b2) => a.day - b2.day);
}
