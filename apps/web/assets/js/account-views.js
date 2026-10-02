// Assinatura: o conteúdo de cada aba de #/conta. Cada função recebe o "ctx" montado em account.js
// ({ api, acc, plan, has, month, data, coach, goTab, refresh, setMonth, startPix, ... }) e devolve UM elemento.
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';
import { moneyInput } from './money.js';
import { confirmDialog } from './confirm.js';
import { viewCarteiras, viewLembretes } from './account-extras-views.js';
import { PLANS, CATEGORIES, CATEGORY_LABEL, categorize, parseExtract } from '../vendor/engine.js';

export const FEATURE_LABEL = { ledger: 'Controle de gastos', import: 'Importar extrato', alerts: 'Alertas de limite', coach_limited: 'Treinador (3 dicas)', goals: 'Metas com aportes', coach: 'Treinador completo', simulator: 'Simulador de investimento' };

/** Abas da conta. `needs` = recurso do plano exigido (a aba aparece sempre; sem o recurso mostra o que o upgrade traz). */
export const TABS = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'lancamentos', label: 'Lançamentos' },
  { id: 'carteiras', label: 'Carteiras' },
  { id: 'lembretes', label: 'Lembretes' },
  { id: 'orcamento', label: 'Orçamento' },
  { id: 'metas', label: 'Metas', needs: 'goals' },
  { id: 'treinador', label: 'Treinador' },
  { id: 'simulador', label: 'Simulador', needs: 'simulator' },
  { id: 'plano', label: 'Plano' },
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
        const res = await ctx.api.addEntries(parsed.map((x) => ({ ...x, source: 'import', category: categorize(x.note, x.amountCents) })));
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
  const spentBy = Object.fromEntries(d.summary.byCategory.map((c) => [c.category, c.cents]));
  const rows = CATEGORIES.filter((c) => c !== 'renda').map((c) => {
    const limit = d.limits[c] ?? null;
    const spent = spentBy[c] ?? 0;
    const field = moneyInput({ id: `lim-${c}`, ariaLabel: `Limite mensal de ${CATEGORY_LABEL[c]}`, value: limit, placeholder: 'sem limite', small: true });
    field.input.addEventListener('change', async () => {
      const cents = field.cents();
      try {
        await ctx.api.setLimit(c, cents && cents > 0 ? cents : null);
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

  return el(
    'div', { class: 'acc-stack' },
    card(
      el('h2', {}, 'Suas metas'),
      active.length > 0 ? el('div', { class: 'goal-list' }, ...active.map((g) => goalCard(ctx, g))) : empty('Nenhuma meta em andamento', 'Comece com algo pequeno e concreto: uma reserva de um mês de gastos, por exemplo.'),
    ),
    el('details', { class: 'card d-section new-goal', open: active.length === 0 }, el('summary', {}, icon('plus'), 'Nova meta'), form),
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
export function viewPlano(ctx) {
  const { acc, plan } = ctx;
  const end = acc.subscription.periodEnd;
  const days = Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
  const cancelAt = acc.subscription.cancelAtPeriodEnd;

  const renew = el('button', { class: 'btn btn-primary', type: 'button' }, `Renovar por mais 30 dias · ${brl(plan.priceCents)}`, icon('arrow-right'));
  renew.addEventListener('click', () => ctx.startPix(plan));

  const others = PLANS.filter((p) => p.code !== plan.code).map((p) => {
    const up = p.priceCents > plan.priceCents;
    const b = el('button', { class: up ? 'btn btn-secondary' : 'btn btn-quiet', type: 'button' }, `${up ? 'Passar para' : 'Trocar para'} ${p.name} · ${brl(p.priceCents)}`);
    b.addEventListener('click', () => ctx.startPix(p));
    return el(
      'article', { class: 'plan-opt' },
      el('h3', {}, p.name), el('p', { class: 'muted' }, p.tagline),
      el('ul', { class: 'bullets' }, ...p.features.map((f) => el('li', {}, FEATURE_LABEL[f]))),
      p.soon.length > 0 ? el('p', { class: 'fine' }, `Em breve: ${p.soon.join(' ')}`) : null,
      b,
    );
  });

  const cancelBtn = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, cancelAt ? 'Manter a assinatura' : 'Não renovar');
  cancelBtn.addEventListener('click', async () => {
    try {
      await ctx.api.setSubscriptionCancel(!cancelAt);
      toast(cancelAt ? 'Combinado: vamos continuar te avisando antes de vencer.' : 'Combinado: não vamos te lembrar de renovar.');
      ctx.reloadAccount();
    } catch {
      toast('Não consegui atualizar agora.');
    }
  });
  const logoutBtn = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Sair deste aparelho');
  logoutBtn.addEventListener('click', async () => {
    await ctx.api.logout().catch(() => {});
    ctx.reloadAccount();
  });
  const deleteBtn = el('button', { class: 'btn btn-danger btn-sm', type: 'button' }, icon('trash'), 'Apagar minha conta');
  deleteBtn.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Apagar a conta agora?', text: 'Vamos apagar seus lançamentos, limites, metas e a assinatura. Isso não pode ser desfeito e não há reembolso do período pago.', confirmLabel: 'Apagar tudo', danger: true }))) return;
    try {
      await ctx.api.deleteAccount();
      ctx.reloadAccount();
    } catch {
      toast('Não consegui apagar agora. Tente de novo.');
    }
  });

  return el(
    'div', { class: 'acc-stack' },
    card(
      el('h2', {}, `Plano ${plan.name}`),
      el('p', { class: 'plan-line' }, el('span', { class: `pill ${days <= 3 ? 'tone-attention' : 'tone-ok'}` }, days === 0 ? 'Vence hoje' : `${days} ${days === 1 ? 'dia' : 'dias'} restantes`), el('span', { class: 'muted' }, ` até ${new Date(end).toLocaleDateString('pt-BR')}${cancelAt ? ' · não será renovado' : ''}`)),
      el('p', { class: 'muted' }, 'Pagamento único por Pix, a cada 30 dias. Nada é cobrado sozinho: se não renovar, o acesso termina no fim do período e você pode voltar quando quiser.'),
      el('div', { class: 'button-row no-print' }, renew),
    ),
    card(el('h2', {}, 'Outros planos'), el('p', { class: 'section-sub' }, 'Ao mudar de plano, os dias que você já tem continuam valendo; o novo período soma 30 dias.'), el('div', { class: 'plans' }, ...others)),
    card(el('h2', {}, 'Conta'), el('p', { class: 'muted' }, acc.email), el('div', { class: 'button-row no-print' }, cancelBtn, logoutBtn, deleteBtn)),
  );
}

export const VIEWS = { geral: viewGeral, lancamentos: viewLancamentos, orcamento: viewOrcamento, carteiras: viewCarteiras, lembretes: viewLembretes, metas: viewMetas, treinador: viewTreinador, simulador: viewSimulador, plano: viewPlano };
export const NEEDS_MONTH = new Set(['geral', 'lancamentos', 'orcamento', 'metas']);
export { monthNow };
