// Estratégias do Mapa: comparação de caminhos, quanto pagar em cada dívida mês a mês, o efeito de cada real a mais,
// dinheiro extraordinário, quitação com desconto, troca por crédito mais barato, marcos e o roteiro de estratégias.
// Todos os números vêm do motor (servidor); aqui é só apresentação.
import { partnerButton } from './partner-cta.js';
import { el, icon } from './dom.js';
import { brl, formatMonths } from './format.js';

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const ymLabel = (ym) => cap(new Date(`${ym}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '').replace(' de ', '/'));
const months = (n) => (n === null || n === undefined ? 'não quita' : formatMonths(n));
const block = (title, ...children) => el('div', { class: 'strat-block' }, el('h3', {}, title), ...children.filter(Boolean));

function table(headers, rows, { caption } = {}) {
  return el(
    'div', { class: 'table-wrap' },
    el(
      'table', { class: 'data-table' },
      caption ? el('caption', { class: 'sr-only' }, caption) : null,
      el('thead', {}, el('tr', {}, ...headers.map((h, i) => el('th', { scope: 'col', class: i > 0 ? 'num' : '' }, h)))),
      el('tbody', {}, ...rows.map((r) => el('tr', { class: r.highlight ? 'is-highlight' : '' }, ...r.cells.map((c, i) => el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : { class: 'num' }, c))))),
    ),
  );
}

export function strategiesSection(s) {
  if (!s || (s.comparison.length === 0 && s.playbook.length === 0)) return null;
  const out = [];

  if (s.verdict) out.push(el('p', { class: 'headline strat-verdict' }, s.verdict));

  if (s.comparison.length > 0) {
    out.push(
      block(
        'Qual caminho compensa mais',
        el('p', { class: 'section-sub' }, 'O mesmo dinheiro por mês, em ordens diferentes. A diferença está nos juros e no tempo.'),
        table(
          ['Caminho', 'Quita em', 'Juros pagos', 'Total pago'],
          s.comparison.map((c) => ({
            highlight: c.recommended,
            cells: [el('span', {}, el('strong', {}, c.label), c.recommended ? el('span', { class: 'pill tone-ok strat-pill' }, 'recomendado') : null, el('span', { class: 'fine strat-desc' }, c.description)), months(c.months), c.months === null ? '—' : brl(c.interestCents), c.months === null ? '—' : brl(c.totalPaidCents)],
          })),
          { caption: 'Comparação dos caminhos de pagamento' },
        ),
      ),
    );
  }

  if (s.schedule.length > 0) {
    out.push(
      block(
        'Quanto pagar em cada dívida, mês a mês',
        el('p', { class: 'section-sub' }, 'Os 6 primeiros meses do plano. Quando uma dívida acaba, a parcela dela passa para a próxima da fila.'),
        el(
          'ol', { class: 'month-plan' },
          ...s.schedule.map((m) =>
            el(
              'li', {},
              el('div', { class: 'month-head' }, el('strong', {}, `Mês ${m.month} · ${ymLabel(m.ym)}`), el('span', { class: 'muted' }, `Total ${brl(m.totalCents)}`)),
              el('ul', { class: 'month-pay' }, ...m.payments.map((p) => el('li', {}, el('span', {}, p.creditorName, p.payoff ? el('span', { class: 'pill tone-ok strat-pill' }, 'quita') : null), el('strong', {}, brl(p.cents))))),
              el('p', { class: 'fine' }, `Saldo total ao fim do mês: ${brl(m.remainingCents)}`),
            ),
          ),
        ),
      ),
    );
  }

  const useful = s.whatIfExtra.filter((w) => w.interestSavedCents !== null && w.interestSavedCents > 0);
  if (useful.length > 0) {
    out.push(
      block(
        'O efeito de cada real a mais',
        el('p', { class: 'section-sub' }, 'Se você conseguir colocar um pouco mais por mês além do plano (cortando um gasto ou com renda extra):'),
        table(['A mais por mês', 'Quita em', 'Termina antes', 'Juros economizados'], useful.map((w) => ({ cells: [el('strong', {}, `+ ${brl(w.extraCents)}`), months(w.months), w.monthsSaved ? formatMonths(w.monthsSaved) : '—', brl(w.interestSavedCents)] })), { caption: 'Efeito de pagar mais por mês' }),
      ),
    );
  }

  if (s.lumpSum && s.lumpSum.interestSavedCents > 0) {
    const l = s.lumpSum;
    out.push(
      block(
        'Se entrar um dinheiro fora do mês',
        el('p', { class: 'note' }, icon('info'), el('span', {}, `13º, restituição do Imposto de Renda, férias ou FGTS: colocando ${brl(l.lumpCents)} direto em ${l.appliedTo.join(' e ')}, você economiza ${brl(l.interestSavedCents)} em juros${l.monthsSaved > 0 ? ` e termina ${formatMonths(l.monthsSaved)} antes` : ''}.`)),
      ),
    );
  }

  if (s.settlements.length > 0) {
    out.push(
      block(
        'Quitar à vista com desconto',
        el('p', { class: 'section-sub' }, 'Para as dívidas em atraso. As faixas são as mais comuns em negociação; não são garantia.'),
        table(
          ['Dívida', 'Saldo hoje', 'Melhor caso', 'Pior caso', 'Para juntar'],
          s.settlements.map((x) => ({ cells: [el('strong', {}, x.creditorName), brl(x.balanceCents), brl(x.bestCaseCents), brl(x.worstCaseCents), x.monthsToSave === null ? '—' : formatMonths(x.monthsToSave)] })),
          { caption: 'Quitação à vista com desconto' },
        ),
        el('p', { class: 'fine' }, '"Para juntar" = quantos meses guardando o extra do seu orçamento para chegar ao melhor caso.'),
      ),
    );
  }

  if (s.refinance.length > 0) {
    out.push(
      block(
        'Trocar por um crédito mais barato',
        el('p', { class: 'section-sub' }, 'Estimativa com taxa de referência do consignado. Não é uma oferta: a condição real depende de cada banco.'),
        table(
          ['Dívida', 'Juros hoje', 'Juros novos', 'Parcela nova', 'Economia estimada'],
          s.refinance.map((r) => ({ cells: [el('strong', {}, r.creditorName), `${r.oldRatePct.toLocaleString('pt-BR')}% a.m.`, `${r.newRatePct.toLocaleString('pt-BR')}% a.m.`, `${brl(r.newPaymentCents)} × ${r.termMonths}`, brl(r.savingsCents)] })),
          { caption: 'Troca por crédito mais barato' },
        ),
      ),
    );
  }

  if (s.milestones.length > 0) {
    out.push(
      block(
        'Marcos do seu plano',
        el('ol', { class: 'milestones' }, ...s.milestones.map((m) => el('li', { class: `milestone ms-${m.kind}` }, el('span', { class: 'ms-when' }, ymLabel(m.ym)), el('div', {}, el('strong', {}, m.title), el('p', { class: 'muted' }, m.detail))))),
      ),
    );
  }

  if (s.playbook.length > 0) {
    out.push(
      block(
        'Estratégias para o seu caso',
        el('p', { class: 'section-sub' }, 'Só aparecem as que se aplicam aos seus números. Comece pela primeira.'),
        ...s.playbook.map((p, i) =>
          el(
            'details', { class: 'strat-item', open: i === 0 },
            el('summary', {}, el('span', { class: 'rank', 'aria-hidden': 'true' }, String(i + 1)), el('strong', {}, p.title)),
            el('p', {}, p.why),
            el('ol', { class: 'strat-steps' }, ...p.steps.map((st) => el('li', {}, st))),
            p.caution ? el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, p.caution)) : null,
            p.caution?.includes('parceiro Fôlego') ? partnerButton() : null,
          ),
        ),
      ),
    );
  }

  return el('section', { class: 'card d-section', id: 'estrategias', 'aria-labelledby': 'estrategias-t' }, el('h2', { id: 'estrategias-t' }, 'Estratégias para sair mais rápido'), ...out, el('p', { class: 'fine' }, 'Cálculos feitos com os números que você informou. São estimativas educativas, não aconselhamento individual.'));
}
