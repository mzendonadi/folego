// Assinatura: o conteúdo de cada aba de #/conta. Cada função recebe o "ctx" montado em account.js
// ({ api, acc, plan, has, month, data, coach, goTab, refresh, setMonth, startPix, ... }) e devolve UM elemento.
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';
import { moneyInput } from './money.js';
import { confirmDialog } from './confirm.js';
import { viewCarteiras, viewLembretes, viewDividas, viewFamilia } from './account-extras-views.js';
import { viewCoach, viewMercado } from './account-coach-views.js';
import { viewPlano as viewPlanoBilling, viewPerfil } from './account-billing.js';
import { viewIndicar } from './referral.js';
import { viewCobrancas, viewCenarios } from './account-insight-views.js';
import { PLANS, CATEGORIES, CATEGORY_LABEL, categorize, parseExtract } from '../vendor/engine.js';

export const FEATURE_LABEL = { health: 'Nota de saúde financeira', debts: 'Dívidas com plano de quitação', reminders: 'Lembretes de contas por e-mail', ledger: 'Controle de gastos', import: 'Importar extrato', alerts: 'Alertas de limite', coach_limited: 'Treinador (3 dicas)', goals: 'Metas com aportes', coach: 'Treinador completo', simulator: 'Simulador de investimento', planner: 'Planejador com IA', household: 'Conta compartilhada com uma pessoa', recurring: 'Detector de assinaturas e cobranças recorrentes', scenarios: 'Simulador "e se...?" de cenários', ebook: 'eBook de presente no seu e-mail (50+ páginas)', journeys: 'Todas as jornadas do coach', market: 'Cenário econômico (Selic, inflação, CDI)', market_pro: 'Dólar e histórico de 12 meses' };

/** Abas da conta. `needs` = recurso do plano exigido (a aba aparece sempre; sem o recurso mostra o que o upgrade traz). */
export const TABS = [
  { id: 'coach', label: 'Coach', group: 'Hoje' },
  { id: 'geral', label: 'Visão geral', group: 'Hoje' },
  { id: 'lancamentos', label: 'Lançamentos', group: 'Dinheiro' },
  { id: 'orcamento', label: 'Orçamento', group: 'Dinheiro' },
  { id: 'cobrancas', label: 'Cobranças', group: 'Dinheiro' },
  { id: 'carteiras', label: 'Carteiras', group: 'Dinheiro' },
  { id: 'lembretes', label: 'Lembretes', group: 'Dinheiro' },
  { id: 'dividas', label: 'Dívidas', group: 'Dívidas e metas' },
  { id: 'metas', label: 'Metas', needs: 'goals', group: 'Dívidas e metas' },
  { id: 'planejador', label: 'Planejador', needs: 'planner', group: 'Inteligência' },
  { id: 'cenarios', label: 'E se...?', needs: 'scenarios', group: 'Inteligência' },
  { id: 'mercado', label: 'Mercado', group: 'Inteligência' },
  { id: 'treinador', label: 'Treinador', group: 'Inteligência' },
  { id: 'simulador', label: 'Simulador', needs: 'simulator', group: 'Inteligência' },
  { id: 'familia', label: 'Compartilhar', needs: 'household', group: 'Conta' },
  { id: 'indicar', label: 'Indique e ganhe', group: 'Conta' },
  { id: 'perfil', label: 'Perfil', group: 'Conta' },
  { id: 'plano', label: 'Plano e dados', group: 'Conta' },
];

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const monthNow = () => new Date().toISOString().slice(0, 7);
const monthLabel = (m) => cap(new Date(`${m}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
const shiftMonth = (m, delta) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + delta, 1)).toISOString().slice(0, 7);
};
const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
const daysUntil = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000);

function progress(pct, label, { over = false, done = false } = {}) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return el(
    'div', { class: `progress${over ? ' is-over' : ''}${done ? ' is-done' : ''}`, role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(v), 'aria-label': label },
    el('i', { style: `width:${v}%` }),
  );
}

function empty(title, text, ...actions) {
  return el('div', { class: 'empty' }, el('strong', {}, title), el('p', { class: 'muted' }, text), actions.length ? el('div', { class: 'button-row' }, ...actions) : null);
}

function monthNav(ctx) {
  const prev = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': 'Mês anterior' }, icon('arrow-left'));
  const next = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': 'Próximo mês', disabled: ctx.month >= monthNow() }, icon('arrow-right'));
  prev.addEventListener('click', () => ctx.setMonth(shiftMonth(ctx.month, -1)));
  next.addEventListener('click', () => ctx.setMonth(shiftMonth(ctx.month, 1)));
  return el('div', { class: 'month-nav no-print' }, prev, el('strong', { class: 'month-label', role: 'status' }, monthLabel(ctx.month)), next);
}

/** Recurso que o plano atual não inclui: mostra o que o upgrade traz, em vez de esconder a aba. */
function locked(ctx, { title, feature, blurb, bullets }) {
  const target = PLANS.find((p) => p.features.includes(feature));
  const go = el('button', { class: 'btn btn-primary', type: 'button' }, `Ver o plano ${target.name}`, icon('arrow-right'));
  go.addEventListener('click', () => ctx.goTab('plano'));
  return card(
    el('h2', {}, title),
    el('div', { class: 'locked-box' }, icon('lock', 'icon icon-lock'), el('div', {}, el('strong', {}, `Disponível a partir do plano ${target.name} (${brl(target.priceCents)}/mês)`), el('p', { class: 'muted' }, blurb))),
    el('ul', { class: 'tick-list left' }, ...bullets.map((b) => el('li', {}, icon('check'), b))),
    el('div', { class: 'button-row no-print' }, go),
  );
}

// ---------------------------------------------------------------- Visão geral
export function viewGeral(ctx) {
  const d = ctx.data;
  const s = d.summary;
  const out = [];

  if (d.alerts.length > 0) {
    out.push(card(el('h2', {}, 'Atenção'), ...d.alerts.map((a) => el('p', { class: a.level === 'warn' ? 'note note-amber' : 'note' }, icon(a.level === 'warn' ? 'alert' : 'info'), el('span', {}, el('strong', {}, a.title), ' — ', a.detail)))));
  }

  const hasData = d.entries.length > 0;
  out.push(
    card(
      monthNav(ctx),
      el('div', { class: 'balance' }, el('span', { class: 'muted' }, 'Saldo do mês'), el('strong', { class: `balance-num ${s.balanceCents < 0 ? 'neg' : 'pos'}` }, brl(s.balanceCents))),
      el(
        'dl', { class: 'stats stats-2' },
        el('div', { class: 'stat' }, el('dt', {}, 'Entrou'), el('dd', { class: 'pos' }, brl(s.incomeCents))),
        el('div', { class: 'stat' }, el('dt', {}, 'Saiu'), el('dd', {}, brl(s.spendCents))),
      ),
      s.savingsRate !== null ? el('p', { class: 'muted' }, s.savingsRate >= 0 ? `Você guardou ${Math.round(s.savingsRate * 100)}% do que entrou neste mês.` : 'Neste mês saiu mais do que entrou.') : null,
      !hasData
        ? empty('Nada lançado neste mês ainda', 'Comece por um gasto ou por um extrato do banco: em poucos minutos você vê para onde vai o dinheiro.', (() => {
            const b = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('plus'), 'Adicionar lançamento');
            b.addEventListener('click', () => ctx.goTab('lancamentos'));
            return b;
          })())
        : null,
    ),
  );

  const spent = s.byCategory.filter((c) => c.cents > 0);
  if (spent.length > 0) {
    const max = Math.max(...spent.map((c) => c.limitCents ?? c.cents), 1);
    out.push(
      card(
        el('h2', {}, 'Para onde foi o dinheiro'),
        el(
          'ul', { class: 'cat-list' },
          ...spent.map((c) => {
            const pct = c.limitCents ? (c.cents / c.limitCents) * 100 : (c.cents / max) * 100;
            return el(
              'li', {},
              el('div', { class: 'cat-head' }, el('span', {}, CATEGORY_LABEL[c.category] ?? c.category), el('strong', { class: c.over ? 'neg' : '' }, brl(c.cents), c.limitCents ? el('span', { class: 'muted' }, ` de ${brl(c.limitCents)}`) : null)),
              progress(pct, `${CATEGORY_LABEL[c.category] ?? c.category}: ${brl(c.cents)}`, { over: c.over }),
            );
          }),
        ),
        ctx.has('alerts') ? el('p', { class: 'fine' }, 'Quer um aviso antes de estourar? Defina limites na aba Orçamento.') : null,
      ),
    );
  }

  const active = (d.goals ?? []).filter((g) => !g.completedAt).slice(0, 3);
  if (ctx.has('goals') && active.length > 0) {
    const more = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Ver todas as metas', icon('arrow-right'));
    more.addEventListener('click', () => ctx.goTab('metas'));
    out.push(
      card(
        el('h2', {}, 'Suas metas'),
        ...active.map((g) => {
          const pct = (g.savedCents / g.targetCents) * 100;
          return el('div', { class: 'goal-mini' }, el('div', { class: 'cat-head' }, el('span', {}, g.name), el('strong', {}, `${Math.round(pct)}%`)), progress(pct, `Meta ${g.name}`));
        }),
        el('div', { class: 'no-print' }, more),
      ),
    );
  }
  return el('div', { class: 'acc-stack' }, ...out);
}

// ---------------------------------------------------------------- Lançamentos
export function viewLancamentos(ctx) {
  const d = ctx.data;
  const kind = { value: 'gasto' };
  const seg = el(
    'div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Tipo do lançamento' },
    ...[['gasto', 'Gasto'], ['entrada', 'Entrada']].map(([v, label]) => {
      const b = el('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(v === 'gasto'), 'data-kind': v }, label);
      b.addEventListener('click', () => {
        kind.value = v;
        seg.querySelectorAll('.seg-btn').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      });
      return b;
    }),
  );
  const wallets = ctx.wallets?.wallets ?? [];
  const walletSel = wallets.length ? el('select', { class: 'input', id: 'lc-carteira', 'aria-label': 'Carteira' }, el('option', { value: '' }, 'Sem carteira'), ...wallets.map((x) => el('option', { value: x.id }, x.name))) : null;
  const amount = moneyInput({ id: 'lc-valor', ariaLabel: 'Valor' });
  const date = el('input', { class: 'input', id: 'lc-data', type: 'date', value: ctx.month === monthNow() ? new Date().toISOString().slice(0, 10) : `${ctx.month}-01` });
  const note = el('input', { class: 'input', id: 'lc-desc', type: 'text', maxlength: '120', placeholder: 'Ex.: mercado, salário, farmácia' });
  const addBtn = el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Adicionar');
  const form = el(
    'form', { class: 'entry-form' },
    el('div', { class: 'field' }, el('span', { class: 'label' }, 'Tipo'), seg),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'lc-valor' }, 'Valor (R$)'), amount.input),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'lc-data' }, 'Data'), date),
    el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'lc-desc' }, 'Descrição'), note),
    walletSel ? el('div', { class: 'field' }, el('label', { class: 'label', for: 'lc-carteira' }, 'Carteira'), walletSel) : null,
    addBtn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = amount.cents();
    if (!cents) return toast('Digite o valor.');
    if (!date.value) return toast('Escolha a data.');
    addBtn.disabled = true;
    const text = note.value.trim() || (kind.value === 'gasto' ? 'Gasto' : 'Entrada');
    try {
      await ctx.api.addEntries([{ date: date.value, amountCents: kind.value === 'gasto' ? -cents : cents, note: text, walletId: walletSel?.value || null }]);
      toast('Lançamento adicionado.');
      ctx.month = date.value.slice(0, 7);
      ctx.refresh();
    } catch {
      addBtn.disabled = false;
      toast('Não consegui adicionar agora.');
    }
  });

  let importBox = null;
  if (ctx.has('import')) {
    const input = el('input', { type: 'file', accept: '.csv,.ofx,.txt', hidden: true, 'aria-label': 'Arquivo do extrato' });
    const btn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('list'), 'Importar extrato (CSV ou OFX)');
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const { entries: parsed, skipped } = parseExtract(await file.text(), file.name);
      if (parsed.length === 0) return toast('Não consegui ler nenhum lançamento desse arquivo.');
      try {
        const res = await ctx.api.addEntries(parsed.map((x) => ({ ...x, source: 'import', category: categorize(x.note, x.amountCents), walletId: walletSel?.value || null })));
        toast(`${res.added} lançamentos importados${res.duplicates ? `, ${res.duplicates} repetidos ignorados` : ''}${skipped ? `, ${skipped} linhas não reconhecidas` : ''}.`);
        ctx.refresh();
      } catch {
        toast('Não consegui importar agora.');
      }
      input.value = '';
    });
    importBox = el('div', { class: 'import-box no-print' }, input, btn, el('span', { class: 'fine' }, 'Baixe o extrato no app ou site do banco. Repetidos são ignorados.'));
  }

  const walletName = new Map(wallets.map((x) => [x.id, x.name]));
  const rows = d.entries.map((x) => {
    const del = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Remover ${x.note}` }, icon('trash'));
    del.addEventListener('click', async () => {
      try {
        await ctx.api.deleteEntry(x.id);
        toast('Lançamento removido.');
        ctx.refresh();
      } catch {
        toast('Não consegui remover agora.');
      }
    });
    const cat = el('select', { class: 'input input-sm', 'aria-label': `Categoria de ${x.note}` }, ...CATEGORIES.map((c) => el('option', { value: c, selected: c === x.category }, CATEGORY_LABEL[c])));
    cat.addEventListener('change', () => ctx.api.setEntryCategory(x.id, cat.value).then(() => toast('Categoria atualizada.')).catch(() => toast('Não consegui salvar a categoria.')));
    return el(
      'li', { class: 'entry-row' },
      el('span', { class: 'entry-date muted' }, fmtDay(x.date)),
      el('span', { class: 'entry-note' }, x.note, x.walletId && walletName.get(x.walletId) ? el('span', { class: 'wallet-tag' }, ` · ${walletName.get(x.walletId)}`) : null),
      cat,
      el('strong', { class: `entry-amount ${x.amountCents < 0 ? 'neg' : 'pos'}` }, brl(x.amountCents)),
      del,
    );
  });

  return el(
    'div', { class: 'acc-stack' },
    card(el('h2', {}, 'Novo lançamento'), form, importBox),
    card(monthNav(ctx), rows.length > 0 ? el('ul', { class: 'entries' }, ...rows) : empty('Nenhum lançamento neste mês', 'Adicione acima ou importe o extrato do banco.')),
  );
}

// ---------------------------------------------------------------- Orçamento (limites por categoria)
export function viewOrcamento(ctx) {
  const d = ctx.data;
  const onlyMonth = el('input', { type: 'checkbox', id: 'lim-so-mes' });
  const copy = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Copiar limites do mês anterior');
  copy.addEventListener('click', async () => {
    try {
      const r = await ctx.api.copyBudgetMonth(ctx.month);
      toast(r.copied ? `${r.copied} limites copiados.` : 'Nada novo para copiar (o mês anterior não tinha limites só dele).');
      ctx.refresh();
    } catch {
      toast('Não consegui copiar agora.');
    }
  });
  const spentBy = Object.fromEntries(d.summary.byCategory.map((c) => [c.category, c.cents]));
  const rows = CATEGORIES.filter((c) => c !== 'renda').map((c) => {
    const limit = d.limits[c] ?? null;
    const spent = spentBy[c] ?? 0;
    const field = moneyInput({ id: `lim-${c}`, ariaLabel: `Limite mensal de ${CATEGORY_LABEL[c]}`, value: limit, placeholder: 'sem limite', small: true });
    field.input.addEventListener('change', async () => {
      const cents = field.cents();
      try {
        const value = cents && cents > 0 ? cents : null;
        await (onlyMonth.checked ? ctx.api.setMonthLimit(ctx.month, c, value) : ctx.api.setLimit(c, value));
        toast(cents ? 'Limite salvo.' : 'Limite removido.');
        ctx.refresh();
      } catch {
        toast('Não consegui salvar agora.');
      }
    });
    const over = limit !== null && spent > limit;
    return el(
      'li', { class: 'budget-row' },
      el('div', { class: 'budget-top' }, el('label', { class: 'label', for: `lim-${c}` }, CATEGORY_LABEL[c]), field.input),
      el('div', { class: 'budget-bottom' }, progress(limit ? (spent / limit) * 100 : 0, `${CATEGORY_LABEL[c]}: gasto do mês em relação ao limite`, { over }), el('span', { class: `fine ${over ? 'neg' : ''}` }, limit ? `${brl(spent)} de ${brl(limit)}` : spent > 0 ? `${brl(spent)} gastos, sem limite` : 'sem gastos')),
    );
  });
  return card(
    el('h2', {}, 'Limites por categoria'),
    el('p', { class: 'section-sub' }, 'Defina quanto você quer gastar por mês em cada área. Avisamos quando chegar perto e quando passar. Deixe vazio para não avisar.'),
    monthNav(ctx),
    el('div', { class: 'button-row no-print' }, el('label', { class: 'check', for: 'lim-so-mes' }, onlyMonth, ' Valer só para este mês'), copy),
    el('ul', { class: 'budget-list' }, ...rows),
  );
}

// ---------------------------------------------------------------- Metas
function goalCard(ctx, g) {
  const pct = (g.savedCents / g.targetCents) * 100;
  const done = Boolean(g.completedAt);
  const left = g.dueOn ? daysUntil(g.dueOn) : null;
  const dueChip = g.dueOn && !done ? el('span', { class: `pill ${left < 0 ? 'tone-critical' : left <= 30 ? 'tone-attention' : 'tone-ok'}` }, left < 0 ? 'Prazo vencido' : left === 0 ? 'Vence hoje' : `${left} dias`) : null;

  let addBox = null;
  if (!done) {
    const amount = moneyInput({ id: `ap-${g.id}`, ariaLabel: `Valor a guardar em ${g.name}`, placeholder: 'Quanto guardar' });
    const btn = el('button', { class: 'btn btn-secondary btn-sm', type: 'submit' }, icon('plus'), 'Guardar');
    addBox = el('form', { class: 'contrib-form no-print' }, amount.input, btn);
    addBox.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cents = amount.cents();
      if (!cents) return toast('Digite o valor.');
      btn.disabled = true;
      try {
        await ctx.api.addGoalContribution(g.id, { amountCents: cents });
        toast(g.savedCents + cents >= g.targetCents ? 'Meta concluída! 🎉' : 'Aporte guardado.');
        ctx.refresh();
      } catch {
        btn.disabled = false;
        toast('Não consegui guardar agora.');
      }
    });
  }

  const history = (g.contributions ?? []).map((c) => {
    const undo = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Desfazer aporte de ${brl(c.amountCents)}` }, 'Desfazer');
    undo.addEventListener('click', async () => {
      try {
        await ctx.api.deleteGoalContribution(g.id, c.id);
        ctx.refresh();
      } catch {
        toast('Não consegui desfazer agora.');
      }
    });
    return el('li', {}, el('span', { class: 'muted' }, fmtDay(c.date)), el('span', {}, c.note || 'Aporte'), el('strong', {}, brl(c.amountCents)), undo);
  });

  const remove = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('trash'), 'Remover meta');
  remove.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Remover esta meta?', text: `“${g.name}” e o histórico de aportes serão apagados. Isso não pode ser desfeito.`, confirmLabel: 'Remover', danger: true }))) return;
    try {
      await ctx.api.deleteGoal(g.id);
      ctx.refresh();
    } catch {
      toast('Não consegui remover agora.');
    }
  });

  return el(
    'article', { class: `goal-card${done ? ' is-done' : ''}` },
    el('div', { class: 'goal-top' }, el('h3', {}, g.name), done ? el('span', { class: 'pill tone-ok' }, `Concluída em ${new Date(g.completedAt).toLocaleDateString('pt-BR')}`) : dueChip),
    el('p', { class: 'goal-nums' }, el('strong', {}, brl(g.savedCents)), el('span', { class: 'muted' }, ` de ${brl(g.targetCents)} · ${Math.min(100, Math.round(pct))}%`)),
    progress(pct, `Meta ${g.name}`, { done }),
    !done ? el('p', { class: 'fine' }, `Faltam ${brl(Math.max(0, g.targetCents - g.savedCents))}${g.dueOn ? ` até ${new Date(`${g.dueOn}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}.`) : null,
    addBox,
    history.length > 0 ? el('details', { class: 'goal-history' }, el('summary', {}, 'Últimos aportes'), el('ul', {}, ...history)) : null,
    el('div', { class: 'no-print' }, remove),
  );
}

export function viewMetas(ctx) {
  if (!ctx.has('goals')) {
    return locked(ctx, {
      title: 'Metas',
      feature: 'goals',
      blurb: 'Transforme “queria juntar dinheiro” em um número, um prazo e um caminho.',
      bullets: ['Crie metas com valor e prazo (reserva, viagem, quitar uma dívida)', 'Guarde aportes aos poucos e veja o progresso', 'Receba aviso quando o prazo estiver perto', 'Treinador completo, que sugere onde cortar'],
    });
  }
  const goals = ctx.data.goals ?? [];
  const templatesBox = el('div', { class: 'goal-templates no-print' });
  const active = goals.filter((g) => !g.completedAt);
  const finished = goals.filter((g) => g.completedAt);

  const name = el('input', { class: 'input', id: 'mt-nome', maxlength: '80', placeholder: 'Ex.: Reserva de emergência' });
  const target = moneyInput({ id: 'mt-alvo', ariaLabel: 'Valor da meta' });
  const initial = moneyInput({ id: 'mt-ini', ariaLabel: 'Quanto você já tem', placeholder: '0,00' });
  const due = el('input', { class: 'input', id: 'mt-prazo', type: 'date', 'aria-label': 'Prazo (opcional)' });
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Criar meta');
  const form = el(
    'form', { class: 'goal-form' },
    el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'mt-nome' }, 'Nome da meta'), name),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'mt-alvo' }, 'Quanto quer juntar (R$)'), target.input),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'mt-ini' }, 'Quanto já tem (R$)'), initial.input),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'mt-prazo' }, 'Prazo (opcional)'), due),
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cents = target.cents();
    if (!name.value.trim() || !cents) return toast('Confira o nome e o valor da meta.');
    btn.disabled = true;
    try {
      await ctx.api.saveGoal({ name: name.value.trim(), targetCents: cents, savedCents: initial.cents() ?? 0, dueOn: due.value || null });
      toast('Meta criada.');
      ctx.refresh();
    } catch (error) {
      btn.disabled = false;
      toast(error?.status === 422 ? 'Você chegou ao limite de metas.' : 'Não consegui criar agora.');
    }
  });

  const applyTemplate = (t) => {
    name.value = t.name;
    target.input.value = t.targetCents ? (t.targetCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
    target.input.dispatchEvent(new Event('input', { bubbles: true }));
    const d = new Date();
    d.setMonth(d.getMonth() + t.months);
    due.value = d.toISOString().slice(0, 10);
    form.closest('details').open = true;
    (t.targetCents ? btn : target.input).focus();
  };
  ctx.api.getGoalTemplates().then((r) => templatesBox.replaceChildren(el('p', { class: 'fine muted' }, 'Comece por um modelo pronto (os valores usam o seu gasto médio):'), el('div', { class: 'button-row' }, ...r.templates.map((t) => {
    const b = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', title: t.hint }, t.name);
    b.addEventListener('click', () => applyTemplate(t));
    return b;
  })))).catch(() => {});
  return el(
    'div', { class: 'acc-stack' },
    card(
      el('h2', {}, 'Suas metas'),
      active.length > 0 ? el('div', { class: 'goal-list' }, ...active.map((g) => goalCard(ctx, g))) : empty('Nenhuma meta em andamento', 'Comece com algo pequeno e concreto: uma reserva de um mês de gastos, por exemplo.'),
    ),
    el('details', { class: 'card d-section new-goal', open: active.length === 0 }, el('summary', {}, icon('plus'), 'Nova meta'), templatesBox, form),
    finished.length > 0 ? card(el('h2', {}, 'Concluídas'), el('div', { class: 'goal-list' }, ...finished.map((g) => goalCard(ctx, g)))) : null,
  );
}

// ---------------------------------------------------------------- Treinador
export function viewTreinador(ctx) {
  const out = ctx.coach;
  if (!out) return card(el('h2', {}, 'Treinador'), empty('Não consegui carregar agora', 'Tente de novo em instantes.'));
  const upgrade = out.limited
    ? (() => {
        const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Ver o plano Ousado', icon('arrow-right'));
        b.addEventListener('click', () => ctx.goTab('plano'));
        return el('div', { class: 'note note-amber' }, icon('info'), el('div', {}, el('p', {}, 'Seu plano mostra as 3 dicas principais. No Ousado e no Desbravador o treinador é completo.'), el('div', { class: 'no-print' }, b)));
      })()
    : null;
  return card(
    el('h2', {}, 'Treinador'),
    el('p', { class: 'section-sub' }, 'Dicas calculadas com os seus próprios lançamentos: sempre com número, nunca genéricas.'),
    out.insights.length > 0
      ? el('div', { class: 'insight-list' }, ...out.insights.map((i) => el('article', { class: 'insight' }, el('h3', {}, i.title), el('p', {}, i.detail))))
      : empty('Ainda sem dicas', 'Lance alguns gastos (ou importe o extrato) e o treinador começa a mostrar onde dá para melhorar.'),
    upgrade,
  );
}

// ---------------------------------------------------------------- Simulador
export function viewSimulador(ctx) {
  if (!ctx.has('simulator')) {
    return locked(ctx, {
      title: 'Simulador de investimento',
      feature: 'simulator',
      blurb: 'Veja, com a taxa que você escolher, quanto um aporte mensal pode virar ao longo do tempo.',
      bullets: ['Compare cenários com taxas hipotéticas', 'Desconte a inflação para ver o valor real', 'Educativo: não recomenda produto nenhum'],
    });
  }
  const initial = moneyInput({ id: 'sm-ini', ariaLabel: 'Valor inicial', placeholder: '0,00' });
  const monthly = moneyInput({ id: 'sm-mes', ariaLabel: 'Aporte mensal', placeholder: '0,00' });
  const months = el('input', { class: 'input', id: 'sm-meses', type: 'number', min: '1', max: '600', value: '60', inputmode: 'numeric' });
  const rate = el('input', { class: 'input', id: 'sm-taxa', type: 'text', inputmode: 'decimal', value: '10' });
  const infl = el('input', { class: 'input', id: 'sm-infl', type: 'text', inputmode: 'decimal', value: '4' });
  const out = el('div', { class: 'tool-out', 'aria-live': 'polite' });
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Simular');
  const pctNum = (v) => Number(String(v).replace(',', '.')) || 0;
  const form = el(
    'form', { class: 'entry-form' },
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sm-ini' }, 'Valor inicial (R$)'), initial.input),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sm-mes' }, 'Aporte mensal (R$)'), monthly.input),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sm-meses' }, 'Prazo (meses)'), months),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sm-taxa' }, 'Taxa ao ano (%)'), rate),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'sm-infl' }, 'Inflação ao ano (%)'), infl),
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      const res = await ctx.api.simulateInvestmentApi({ initialCents: initial.cents() ?? 0, monthlyCents: monthly.cents() ?? 0, months: Math.max(1, Math.min(600, Number(months.value) || 12)), scenarios: [{ name: 'Cenário', annualPct: pctNum(rate.value) }], inflationAnnualPct: pctNum(infl.value) });
      const r = res.results[0];
      out.replaceChildren(
        el(
          'dl', { class: 'stats' },
          el('div', { class: 'stat' }, el('dt', {}, 'Total investido'), el('dd', {}, brl(r.investedCents))),
          el('div', { class: 'stat' }, el('dt', {}, 'Valor final'), el('dd', {}, brl(r.finalCents))),
          el('div', { class: 'stat' }, el('dt', {}, 'Ganho'), el('dd', {}, brl(r.gainCents))),
          el('div', { class: 'stat' }, el('dt', {}, 'Final, sem a inflação'), el('dd', {}, brl(r.realFinalCents))),
        ),
        el('p', { class: 'fine' }, res.notice),
      );
    } catch {
      toast('Não consegui simular agora.');
    }
    btn.disabled = false;
  });
  return card(el('h2', {}, 'Simulador de investimento'), el('p', { class: 'section-sub' }, 'Educativo: você escolhe a taxa hipotética. Não é recomendação de investimento.'), form, out);
}

// ---------------------------------------------------------------- Plano (renovar, trocar, cancelar, sair, apagar)
export const viewPlano = (ctx) => viewPlanoBilling(ctx, FEATURE_LABEL);

export function viewPlanejador(ctx) {
  if (!ctx.has('planner')) {
    return locked(ctx, {
      title: 'Planejador com IA',
      feature: 'planner',
      blurb: 'Pergunte em linguagem simples ("como fecho o mês?", "qual dívida pago primeiro?") e receba uma resposta baseada nos seus números reais.',
      bullets: ['Usa seus lançamentos, dívidas e prazos do mês', 'Nunca inventa valores: os números vêm da sua conta', 'Até 10 perguntas por dia'],
    });
  }
  const q = el('textarea', { class: 'input', id: 'pl-pergunta', rows: '3', maxlength: '500', placeholder: 'Ex.: Como fecho este mês sem atrasar nada? Qual dívida eu ataco primeiro?' });
  const ask = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Perguntar');
  const out = el('div', { class: 'planner-out', 'aria-live': 'polite' });
  const form = el('form', { class: 'tool-form' }, el('div', { class: 'field' }, el('label', { class: 'label', for: 'pl-pergunta' }, 'Sua pergunta'), q), ask);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (q.value.trim().length < 5) return toast('Escreva a pergunta com um pouco mais de detalhe.');
    ask.disabled = true;
    out.replaceChildren(el('p', { class: 'muted', role: 'status' }, 'Pensando com os seus números…'));
    try {
      const r = await ctx.api.askPlanner(q.value.trim());
      out.replaceChildren(
        el('p', {}, r.answer),
        el('ul', { class: 'tick-list left' }, ...r.nextSteps.map((s) => el('li', {}, icon('check'), s))),
        el('p', { class: 'fine muted' }, r.source === 'ia' ? 'Resposta escrita por IA com base nos seus dados. É orientação de organização, não consultoria financeira licenciada.' : 'Resposta calculada pelas regras do Fôlego com base nos seus dados.'),
      );
    } catch (err) {
      out.replaceChildren(el('p', { class: 'neg' }, err?.status === 429 ? 'Você usou as perguntas de hoje. Volte amanhã.' : 'Não consegui responder agora. Tente de novo.'));
    }
    ask.disabled = false;
  });
  return card(el('h2', {}, 'Pergunte ao Fôlego'), el('p', { class: 'section-sub' }, 'A resposta usa os lançamentos do mês, suas dívidas e os próximos vencimentos.'), form, out);
}

export function viewCompartilhar(ctx) {
  return viewFamilia(ctx, () => locked(ctx, { title: 'Conta compartilhada', feature: 'household', blurb: 'Divida o controle do dinheiro de casa com quem divide as contas com você.', bullets: ['Convide uma pessoa pelo e-mail', 'Vocês veem e editam a mesma conta', 'Só o titular paga e cancela'] }));
}

export function viewCenariosTab(ctx) {
  if (!ctx.has('scenarios')) {
    return locked(ctx, { title: 'E se...?', feature: 'scenarios', blurb: 'Teste uma mudança na vida (novo emprego, mudar de casa, cortar gastos) e veja o efeito no seu orçamento antes de decidir.', bullets: ['Parte da média real dos seus lançamentos', 'Modelos prontos: novo emprego, menos horas, mudança de casa, renda extra', 'Mostra o mês novo, o saldo em até 5 anos e quando a reserva aperta'] });
  }
  return viewCenarios(ctx);
}

export const VIEWS = { cobrancas: viewCobrancas, cenarios: viewCenariosTab, indicar: viewIndicar, perfil: viewPerfil, familia: viewCompartilhar, coach: viewCoach, mercado: viewMercado, geral: viewGeral, lancamentos: viewLancamentos, orcamento: viewOrcamento, dividas: viewDividas, carteiras: viewCarteiras, lembretes: viewLembretes, metas: viewMetas, treinador: viewTreinador, simulador: viewSimulador, planejador: viewPlanejador, plano: viewPlano };
export const NEEDS_MONTH = new Set(['geral', 'lancamentos', 'orcamento', 'metas']);
export { monthNow };
