// Calendário dos 30 dias (produto calendar_30d): transforma o diagnóstico em ações com data.
// Só usa números do motor (nada é inventado) e nunca promete resultado de negociação.
import type { DebtInput, Diagnosis } from './types.ts';
import { RULES } from './config.ts';
import { parseIsoDate } from './prescription.ts';
import type { Strategies } from './strategies.ts';

export type CalendarKind = 'orcamento' | 'essencial' | 'prescricao' | 'negociar' | 'pagar' | 'revisar' | 'estrategia' | 'marco';

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

/** Mesmo dia do mês, N meses depois (dia 31 vira o último dia do mês). */
export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12; // em JS, -1 % 12 é -1 (e não 11): voltar meses cruzando o ano dava "mês 00"
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/**
 * Calendário de ações. Os primeiros 30 dias são o passo a passo; com as estratégias (opcional) entram também as
 * ações de cada estratégia do caso e os MARCOS do plano nos meses seguintes (dia de pagar, dívida quitada, metade
 * do caminho, livre das dívidas).
 */
export function buildCalendar(diagnosis: Diagnosis, debts: DebtInput[], strategies?: Strategies): CalendarItem[] {
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
        detail: `Peça o demonstrativo e proponha pagar à vista com desconto. Em atraso, costuma-se conseguir entre ${Math.round(RULES.negotiationDiscount.lowPct * 100)}% e ${Math.round(RULES.negotiationDiscount.highPct * 100)}% (não é garantia). Use o roteiro do seu Mapa e anote o protocolo.`,
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

  if (strategies) {
    // Estratégias do caso: uma ação por estratégia, espalhadas pela primeira quinzena (o primeiro passo de cada uma).
    const days = [1, 2, 4, 5, 8, 9, 11, 12, 15];
    strategies.playbook.slice(0, days.length).forEach((p, i) =>
      push(days[i] ?? 15, { kind: 'estrategia', title: `Estratégia: ${p.title}`, detail: `${p.why} Primeiro passo: ${p.steps[0] ?? ''}` }),
    );
    const daysBetween = (iso: string) => Math.round((parseIsoDate(iso) - parseIsoDate(diagnosis.asOf)) / 86_400_000);
    const far = (date: string, i: Omit<CalendarItem, 'day' | 'date'>) => items.push({ day: daysBetween(date), date, ...i });
    // Dia de pagar: um lembrete por mês nos 6 primeiros meses, com quanto vai para cada dívida.
    for (const row of strategies.schedule) {
      const date = addMonthsIso(diagnosis.asOf, row.month);
      far(date, {
        kind: 'pagar',
        title: `Pagamentos do mês ${row.month} do plano`,
        detail: `${row.payments.map((p) => `${p.creditorName}: ${formatBrl(p.cents)}${p.payoff ? ' (quita)' : ''}`).join('; ')}. Total: ${formatBrl(row.totalCents)}. Saldo que fica: ${formatBrl(row.remainingCents)}.`,
        amountCents: row.totalCents,
      });
    }
    for (const m of strategies.milestones) {
      if (m.kind === 'first_month') continue; // já coberto pelo "pagamentos do mês 1"
      const date = addMonthsIso(diagnosis.asOf, m.month);
      far(date, { kind: 'marco', title: `Marco: ${m.title}`, detail: m.detail, ...(m.debtId ? { debtId: m.debtId } : {}) });
    }
  }

  return items.sort((a, b2) => a.day - b2.day);
}
