// Formulário do diagnóstico: mesma estrutura e mesmo estado em qualquer tela.
// Celular: um passo por vez. Desktop: linha do tempo que nasce apagada e acende a cada passo concluído.
import { $, $$, el, icon, announce, focusSoon, prefersReducedMotion } from './dom.js';
import { state, saveDraft, newDebt } from './state.js';
import { EMPLOYMENT, AGE_BANDS, UFS, DEBT_KINDS, OVERDUE_BANDS, KIND_LABEL } from './copy.js';
import { brl, centsToField, fieldToCents, maskMoneyLive, percentToBps, todayISO, plural } from './format.js';

const STEPS = [
  { id: 'vinculo', title: 'Como o seu dinheiro chega hoje?', short: 'Vínculo' },
  { id: 'renda', title: 'Quanto entra por mês, já descontado?', short: 'Renda' },
  { id: 'perfil', title: 'Só mais duas informações rápidas', short: 'Perfil' },
  { id: 'gastos', title: 'Quanto sai por mês nas despesas fixas?', short: 'Gastos' },
  { id: 'dividas', title: 'Agora, o que você deve?', short: 'Dívidas' },
  { id: 'revisao', title: 'Confere e a gente calcula', short: 'Revisão' },
];

let timelineEl;
let summaryEl;
let onSubmit = () => {};
let onStep = () => {};

// ---------- helpers de campo ----------
function field({ id, label, hint, control, className = '' }) {
  return el(
    'div',
    { class: `field ${className}`.trim() },
    el('label', { for: id, class: 'label' }, label),
    hint ? el('p', { class: 'hint', id: `${id}-hint` }, hint) : null,
    control,
    el('p', { class: 'error', id: `${id}-err`, hidden: true }),
  );
}

function describe(input, id, hasHint) {
  input.setAttribute('aria-describedby', `${hasHint ? `${id}-hint ` : ''}${id}-err`);
  return input;
}

function moneyControl(id, cents, hasHint = true) {
  const input = el('input', {
    id, class: 'input money-input', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: '0,00', 'data-money': '',
  });
  input.value = cents === null || cents === undefined ? '' : centsToField(cents);
  describe(input, id, hasHint);
  return el('div', { class: 'money' }, el('span', { class: 'money-prefix', 'aria-hidden': 'true' }, 'R$'), input);
}

function selectControl(id, options, value, placeholder, hasHint = false) {
  const select = el('select', { id, class: 'input select' });
  select.append(el('option', { value: '' }, placeholder));
  for (const [v, label] of options) select.append(el('option', { value: v }, label));
  select.value = value ?? '';
  describe(select, id, hasHint);
  return select;
}

function showError(controlId, message) {
  const control = document.getElementById(controlId);
  const err = document.getElementById(`${controlId}-err`);
  if (control) control.setAttribute('aria-invalid', 'true');
  if (err) {
    err.replaceChildren(icon('alert'), document.createTextNode(message));
    err.hidden = false;
  }
}

function clearError(controlId) {
  const control = document.getElementById(controlId);
  const err = document.getElementById(`${controlId}-err`);
  if (control) control.removeAttribute('aria-invalid');
  if (err) {
    err.hidden = true;
    err.replaceChildren();
  }
}

// ---------- corpo de cada passo ----------
function bodyVinculo() {
  const group = el('div', { class: 'choices', role: 'radiogroup', id: 'employment', 'aria-labelledby': 'step-title-0', 'aria-describedby': 'employment-err' });
  for (const opt of EMPLOYMENT) {
    const input = el('input', { type: 'radio', name: 'employment', value: opt.value, 'data-field': 'employmentType' });
    input.checked = state.answers.employmentType === opt.value;
    group.append(el('label', { class: 'choice' }, input, el('span', { class: 'choice-body' }, el('strong', {}, opt.label), el('span', { class: 'muted' }, opt.hint))));
  }
  // "Outra situação": abre um campo opcional para a pessoa contar como o dinheiro entra (aparece na conferência e fica no caso).
  const note = el('input', { id: 'employment-note', class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', placeholder: 'Ex.: bicos, diarista, aguardando benefício, ajuda da família', 'data-field': 'employmentNote' });
  note.value = state.answers.employmentNote ?? '';
  describe(note, 'employment-note', true);
  const noteField = field({ id: 'employment-note', label: 'Conte em poucas palavras (opcional)', hint: 'Não pedimos nome nem CPF. Só ajuda a entender o seu caso.', control: note, className: 'field-employment-note' });
  noteField.hidden = state.answers.employmentType !== 'other';
  return [
    el('p', { class: 'hint' }, 'Isso ajuda a entender quais caminhos fazem sentido pra você. A gente não pede CPF.'),
    group,
    el('p', { class: 'error', id: 'employment-err', hidden: true }),
    noteField,
  ];
}

function bodyRenda() {
  return [
    field({
      id: 'income', label: 'Renda líquida por mês', hint: 'Some salário, benefício e bicos. Pode ser aproximado.',
      control: moneyControl('income', state.answers.netIncomeCents),
    }),
  ];
}

function bodyPerfil() {
  return [
    el('p', { class: 'hint' }, 'Usamos só pra ajustar as orientações. Nada de nome, endereço ou documento.'),
    el(
      'div',
      { class: 'field-row' },
      field({ id: 'age', label: 'Sua faixa de idade', control: selectControl('age', AGE_BANDS, state.answers.ageBand, 'Escolha…') }),
      field({ id: 'uf', label: 'Seu estado', control: selectControl('uf', UFS.map((u) => [u, u]), state.answers.uf, 'Escolha…') }),
    ),
  ];
}

function bodyGastos() {
  return [
    field({
      id: 'fixed', label: 'Despesas fixas por mês', hint: 'Moradia, comida, transporte, contas de casa, escola. Não some as dívidas aqui: elas entram no próximo passo.',
      control: moneyControl('fixed', state.answers.fixedExpensesCents),
    }),
  ];
}

function bodyDividas() {
  return [
    el('p', { class: 'hint' }, 'Conte as que mais pesam. Se não souber algum valor, use o aproximado. Detalhes extras são opcionais.'),
    el('div', { class: 'debts', id: 'debts' }),
    el('button', { class: 'btn btn-secondary', type: 'button', id: 'add-debt' }, icon('plus'), 'Adicionar outra dívida'),
  ];
}

function bodyRevisao() {
  return [
    el('dl', { class: 'review', id: 'review' }),
    el(
      'div',
      { class: 'consent field' },
      el('div', { class: 'check' },
        el('input', { type: 'checkbox', id: 'consent', 'data-field': 'consent', 'aria-describedby': 'consent-err' }),
        el('label', { for: 'consent' }, 'Li e aceito os '),
        el('button', { class: 'link', type: 'button', 'data-open': 'dlg-terms' }, 'Termos de Uso e a Política de Privacidade'),
        '.',
      ),
      el('p', { class: 'hint' }, 'É um resumo curto. Se quiser, abra o documento completo.'),
      el('p', { class: 'error', id: 'consent-err', hidden: true }),
    ),
  ];
}

const BODIES = [bodyVinculo, bodyRenda, bodyPerfil, bodyGastos, bodyDividas, bodyRevisao];

// ---------- dívidas ----------
function debtCard(d, index, total) {
  const p = d.uid;
  const card = el('fieldset', { class: 'debt', 'data-debt': p });
  card.append(el('legend', { class: 'debt-legend' }, `Dívida ${index + 1}`));
  if (total > 1) {
    card.append(el('button', { class: 'btn btn-quiet btn-sm debt-remove', type: 'button', 'data-remove': p, 'aria-label': `Remover dívida ${index + 1}` }, icon('trash'), 'Remover'));
  }

  const creditor = el('input', { id: `${p}-creditor`, class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', 'data-field': 'creditor', 'data-debt': p });
  creditor.value = d.creditor;
  describe(creditor, `${p}-creditor`, true);
  card.append(field({ id: `${p}-creditor`, label: 'Quem é o credor?', hint: 'Ex.: nome do banco, da loja ou da empresa.', control: creditor }));

  const kind = selectControl(`${p}-kind`, DEBT_KINDS, d.kind, 'Escolha o tipo…');
  kind.dataset.field = 'kind';
  kind.dataset.debt = p;
  card.append(field({ id: `${p}-kind`, label: 'Que tipo de dívida é?', control: kind }));

  // "Outra": abre um campo para a pessoa dizer qual dívida é (aparece no Mapa e nos roteiros).
  const kindNote = el('input', { id: `${p}-kindnote`, class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', placeholder: 'Ex.: empréstimo com parente, mensalidade escolar, multa', 'data-field': 'kindNote', 'data-debt': p });
  kindNote.value = d.kindNote ?? '';
  describe(kindNote, `${p}-kindnote`, false);
  const kindNoteField = field({ id: `${p}-kindnote`, label: 'Qual dívida é essa?', control: kindNote, className: 'field-kindnote' });
  kindNoteField.hidden = d.kind !== 'other';
  card.append(kindNoteField);

  const balance = moneyControl(`${p}-balance`, d.balanceCents);
  $('input', balance).dataset.field = 'balance';
  $('input', balance).dataset.debt = p;
  card.append(field({ id: `${p}-balance`, label: 'Quanto falta pagar hoje?', hint: 'O valor total que você deve, com juros. Aproximado serve.', control: balance }));

  const payment = moneyControl(`${p}-payment`, d.paymentCents);
  $('input', payment).dataset.field = 'payment';
  $('input', payment).dataset.debt = p;
  card.append(field({ id: `${p}-payment`, label: 'Quanto você paga por mês nela?', hint: 'Se não está pagando nada, deixe em branco.', control: payment }));

  const overdueGroup = el('div', { class: 'choices choices-inline', role: 'radiogroup', id: `${p}-overdue`, 'aria-labelledby': `${p}-overdue-label`, 'aria-describedby': `${p}-overdue-err` });
  for (const [value, label] of [['no', 'Está em dia'], ['yes', 'Está em atraso']]) {
    const input = el('input', { type: 'radio', name: `${p}-overdue-r`, value, 'data-field': 'overdue', 'data-debt': p });
    input.checked = d.overdue === value;
    overdueGroup.append(el('label', { class: 'choice choice-sm' }, input, el('span', { class: 'choice-body' }, el('strong', {}, label))));
  }
  card.append(el('div', { class: 'field' }, el('span', { class: 'label', id: `${p}-overdue-label` }, 'Como ela está?'), overdueGroup, el('p', { class: 'error', id: `${p}-overdue-err`, hidden: true })));

  const band = selectControl(`${p}-band`, OVERDUE_BANDS, d.overdueBand, 'Escolha…');
  band.dataset.field = 'overdueBand';
  band.dataset.debt = p;
  const bandField = field({ id: `${p}-band`, label: 'Em atraso há quanto tempo?', control: band, className: 'field-overdue' });
  bandField.hidden = d.overdue !== 'yes';
  card.append(bandField);

  const installments = el('input', { id: `${p}-inst`, class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex.: 24', 'data-field': 'installments', 'data-debt': p });
  installments.value = d.installments;
  describe(installments, `${p}-inst`, false);
  const rate = el('input', { id: `${p}-rate`, class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Ex.: 8,5', 'data-field': 'ratePct', 'data-debt': p });
  rate.value = d.ratePct;
  describe(rate, `${p}-rate`, true);
  const month = el('input', { id: `${p}-month`, class: 'input', type: 'month', max: todayISO().slice(0, 7), 'data-field': 'firstDefaultMonth', 'data-debt': p });
  month.value = d.firstDefaultMonth;
  describe(month, `${p}-month`, true);
  const hasMore = Boolean(d.installments || d.ratePct || d.firstDefaultMonth);
  const more = el(
    'details',
    { class: 'more' },
    el('summary', {}, 'Sei mais detalhes (opcional)'),
    el(
      'div',
      { class: 'more-body' },
      el('p', { class: 'hint' }, 'Quanto mais a gente sabe, mais preciso o resultado. Se não souber, usamos médias de mercado e avisamos.'),
      field({ id: `${p}-inst`, label: 'Parcelas que faltam', control: installments }),
      field({ id: `${p}-rate`, label: 'Juros por mês (%)', hint: 'Está no contrato ou na fatura. Ex.: 8,5', control: rate }),
      field({ id: `${p}-month`, label: 'Mês em que atrasou pela primeira vez', hint: 'Ajuda a saber se a cobrança pode estar prescrita.', control: month }),
    ),
  );
  more.open = hasMore;
  card.append(more);
  return card;
}

function renderDebts() {
  const host = $('#debts', timelineEl);
  if (!host) return;
  host.replaceChildren(...state.answers.debts.map((d, i, all) => debtCard(d, i, all.length)));
}

// ---------- linha do tempo ----------
function buildTimeline() {
  timelineEl.replaceChildren(
    ...STEPS.map((step, i) => {
      const body = el('form', { class: 'step-body', novalidate: true, 'data-step-form': String(i) }, ...BODIES[i]());
      const isLast = i === STEPS.length - 1;
      body.append(
        el(
          'div',
          { class: 'step-actions' },
          i > 0 ? el('button', { class: 'btn btn-quiet', type: 'button', 'data-back': '' }, icon('arrow-left'), 'Voltar') : el('span'),
          el('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, isLast ? 'Ver meu diagnóstico' : 'Continuar', icon('arrow-right')),
        ),
      );
      return el(
        'li',
        { class: 'step', id: `step-${i}`, 'data-step': String(i) },
        el('div', { class: 'step-rail', 'aria-hidden': 'true' }, el('span', { class: 'step-node' }, icon('check'))),
        el(
          'div',
          { class: 'step-card' },
          el(
            'div',
            { class: 'step-head' },
            el('div', { class: 'step-head-text' }, el('h2', { class: 'step-title', id: `step-title-${i}`, tabindex: '-1' }, step.title), el('p', { class: 'step-done-summary', id: `step-sum-${i}` })),
            el('button', { class: 'btn btn-quiet btn-sm step-edit', type: 'button', 'data-edit': String(i), 'aria-label': `Editar: ${step.short}` }, 'Editar'),
          ),
          body,
        ),
      );
    }),
  );
  renderDebts();
}

function stepSummary(i) {
  const a = state.answers;
  if (i === 0) {
    const label = EMPLOYMENT.find((e) => e.value === a.employmentType)?.label ?? '';
    return a.employmentType === 'other' && (a.employmentNote ?? '').trim() ? `${label}: ${a.employmentNote.trim()}` : label;
  }
  if (i === 1) return a.netIncomeCents === null ? '' : brl(a.netIncomeCents);
  if (i === 2) return [AGE_BANDS.find(([v]) => v === a.ageBand)?.[1], a.uf].filter(Boolean).join(' · ');
  if (i === 3) return a.fixedExpensesCents === null ? '' : brl(a.fixedExpensesCents);
  if (i === 4) {
    const n = a.debts.length;
    const total = a.debts.reduce((s, d) => s + (d.balanceCents ?? 0), 0);
    return `${n} ${plural(n, 'dívida', 'dívidas')} · ${brl(total)}`;
  }
  return '';
}

function stateOf(i) {
  if (i === state.step) return 'active';
  return state.doneSteps.includes(i) ? 'done' : 'future';
}

function refreshStates() {
  const total = STEPS.length;
  $$('.step', timelineEl).forEach((li, i) => {
    const s = stateOf(i);
    li.dataset.state = s;
    $('.step-body', li).hidden = s !== 'active';
    $('.step-card', li).inert = s === 'future';
    $('.step-edit', li).hidden = s !== 'done';
    $(`#step-sum-${i}`, li).textContent = s === 'done' ? stepSummary(i) : '';
    if (s === 'active') li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
  const fill = $('#progress-fill');
  if (fill) fill.style.width = `${((state.step + 1) / total) * 100}%`;
  const label = $('#progress-label');
  if (label) label.textContent = `Passo ${state.step + 1} de ${total} · ${STEPS[state.step].short}`;
  if (state.step === 5) renderReview();
  renderSummary();
}

function renderReview() {
  const a = state.answers;
  const rows = [
    ['Como entra o dinheiro', stepSummary(0)],
    ['Renda por mês', stepSummary(1)],
    ['Perfil', stepSummary(2)],
    ['Despesas fixas', stepSummary(3)],
    ['Dívidas', stepSummary(4)],
  ];
  const dl = $('#review', timelineEl);
  dl.replaceChildren(
    ...rows.map(([term, value], i) => el('div', { class: 'review-row' }, el('dt', {}, term), el('dd', {}, el('span', {}, value || '—'), el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'data-edit': String(i), 'aria-label': `Editar ${term.toLowerCase()}` }, 'Editar')))),
  );
  $('#consent', timelineEl).checked = a.consent;
}

function totals() {
  const a = state.answers;
  const total = a.debts.reduce((s, d) => s + (d.balanceCents ?? 0), 0);
  const payments = a.debts.reduce((s, d) => s + (d.paymentCents ?? 0), 0);
  const surplus = a.netIncomeCents !== null && a.fixedExpensesCents !== null ? a.netIncomeCents - a.fixedExpensesCents - payments : null;
  return { total, payments, surplus };
}

function renderSummary() {
  const a = state.answers;
  const { total, payments, surplus } = totals();
  const row = (k, v) => el('div', { class: 'summary-row' }, el('dt', {}, k), el('dd', {}, v));
  summaryEl.replaceChildren(
    el('h2', { class: 'summary-title' }, 'O que você contou'),
    el(
      'dl',
      { class: 'summary-list' },
      row('Renda por mês', a.netIncomeCents === null ? '—' : brl(a.netIncomeCents)),
      row('Despesas fixas', a.fixedExpensesCents === null ? '—' : brl(a.fixedExpensesCents)),
      row('Dívidas', `${a.debts.filter((d) => d.balanceCents).length} · ${brl(total)}`),
      row('Parcelas por mês', brl(payments)),
    ),
    surplus === null
      ? el('p', { class: 'summary-note' }, 'A sobra do mês aparece aqui quando você preencher renda e despesas.')
      : el('div', { class: `summary-surplus ${surplus < 0 ? 'is-negative' : ''}` }, el('span', {}, 'Sobra aproximada do mês'), el('strong', {}, brl(surplus)), surplus < 0 ? el('span', { class: 'summary-note' }, 'Está faltando. É comum, e o Mapa mostra por onde começar.') : null),
  );
}

// ---------- validação ----------
function clearStepErrors(i) {
  $$('[aria-invalid="true"]', $(`#step-${i}`, timelineEl)).forEach((c) => clearError(c.id));
  $$('.error', $(`#step-${i}`, timelineEl)).forEach((e) => {
    e.hidden = true;
    e.replaceChildren();
  });
}

const MAX_MONTHLY_CENTS = 100_000_000; // R$ 1.000.000 por mês
const MAX_DEBT_CENTS = 10_000_000_000; // R$ 100.000.000

function validateStep(i) {
  const a = state.answers;
  const errors = []; // [controlId, message]
  if (i === 0 && !a.employmentType) errors.push(['employment', 'Escolha a opção que mais parece com a sua.']);
  if (i === 1 && a.netIncomeCents === null) errors.push(['income', 'Conte quanto entra por mês, mesmo que aproximado. Se não entra nada, digite 0.']);
  if (i === 1 && a.netIncomeCents !== null && a.netIncomeCents > MAX_MONTHLY_CENTS) errors.push(['income', 'Esse valor parece alto demais para um mês. Confira (digite só os reais, ex.: 3200).']);
  if (i === 2) {
    if (!a.ageBand) errors.push(['age', 'Escolha sua faixa de idade.']);
    if (!a.uf) errors.push(['uf', 'Escolha seu estado.']);
  }
  if (i === 3 && a.fixedExpensesCents === null) errors.push(['fixed', 'Conte quanto sai por mês, mesmo que aproximado.']);
  if (i === 3 && a.fixedExpensesCents !== null && a.fixedExpensesCents > MAX_MONTHLY_CENTS) errors.push(['fixed', 'Esse valor parece alto demais para um mês. Confira (digite só os reais, ex.: 1700).']);
  if (i === 4) {
    for (const d of a.debts) {
      if (!d.creditor.trim()) errors.push([`${d.uid}-creditor`, 'Escreva o nome do credor. Pode ser só “Banco” ou “Loja”.']);
      if (!d.kind) errors.push([`${d.uid}-kind`, 'Escolha o tipo de dívida.']);
      if (d.kind === 'other' && !(d.kindNote ?? '').trim()) errors.push([`${d.uid}-kindnote`, 'Diga em poucas palavras qual dívida é.']);
      if (!d.balanceCents) errors.push([`${d.uid}-balance`, 'Diga quanto falta pagar, mesmo que aproximado.']);
      else if (d.balanceCents > MAX_DEBT_CENTS) errors.push([`${d.uid}-balance`, 'Esse valor parece alto demais para uma dívida. Confira os números.']);
      if (!d.overdue) errors.push([`${d.uid}-overdue`, 'Diga se está em dia ou em atraso.']);
      if (d.overdue === 'yes' && !d.overdueBand && !d.firstDefaultMonth) errors.push([`${d.uid}-band`, 'Escolha há quanto tempo está em atraso.']);
      if (d.installments !== '' && !(Number.isInteger(Number(d.installments)) && Number(d.installments) >= 1 && Number(d.installments) <= 600)) errors.push([`${d.uid}-inst`, 'Use um número inteiro, de 1 a 600.']);
      if (d.ratePct !== '' && percentToBps(d.ratePct) === undefined) errors.push([`${d.uid}-rate`, 'Use um número entre 0 e 100. Ex.: 8,5']);
      if (d.firstDefaultMonth && d.firstDefaultMonth > todayISO().slice(0, 7)) errors.push([`${d.uid}-month`, 'Esse mês ainda não chegou.']);
    }
  }
  if (i === 5 && !a.consent) errors.push(['consent', 'Pra continuar, marque que leu os termos.']);
  return errors;
}

function applyErrors(i, errors) {
  clearStepErrors(i);
  for (const [id, msg] of errors) showError(id, msg);
  const first = document.getElementById(errors[0][0]);
  const focusTarget = first?.matches?.('[role="radiogroup"]') ? $('input', first) : first;
  focusSoon(focusTarget);
  announce(`${errors.length} ${plural(errors.length, 'campo precisa', 'campos precisam')} de ajuste. ${errors[0][1]}`);
}

// ---------- navegação ----------
export function goTo(i, { focus = true } = {}) {
  state.step = Math.max(0, Math.min(STEPS.length - 1, i));
  refreshStates();
  saveDraft();
  const li = $(`#step-${state.step}`, timelineEl);
  if (focus) {
    focusSoon($(`#step-title-${state.step}`, li));
    li.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    announce(`Passo ${state.step + 1} de ${STEPS.length}: ${STEPS[state.step].title}`);
    onStep(STEPS[state.step].id);
  }
}

function next(i) {
  const errors = validateStep(i);
  if (errors.length > 0) {
    applyErrors(i, errors);
    return;
  }
  clearStepErrors(i);
  if (!state.doneSteps.includes(i)) state.doneSteps.push(i);
  if (i === STEPS.length - 1) {
    saveDraft();
    onSubmit(buildInput());
    return;
  }
  goTo(i + 1);
}

// ---------- entrada → motor ----------
function monthToISODate(month) {
  return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : undefined;
}

function daysBetween(fromISO, toISO) {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  return Math.max(0, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000));
}

export function buildInput() {
  const a = state.answers;
  const asOf = todayISO();
  return {
    asOf,
    profile: {
      netIncomeCents: a.netIncomeCents ?? 0,
      fixedExpensesCents: a.fixedExpensesCents ?? 0,
      employmentType: a.employmentType,
      ...(a.employmentType === 'other' && (a.employmentNote ?? '').trim() ? { employmentNote: a.employmentNote.trim() } : {}),
      ageBand: a.ageBand,
      uf: a.uf,
    },
    debts: a.debts.map((d, i) => {
      const firstDefaultOn = d.overdue === 'yes' ? monthToISODate(d.firstDefaultMonth) : undefined;
      const daysOverdue = d.overdue !== 'yes' ? 0 : firstDefaultOn ? daysBetween(firstDefaultOn, asOf) : Number(d.overdueBand || 0);
      const debt = {
        id: `d${i + 1}`,
        creditorName: d.creditor.trim(),
        kind: d.kind,
        balanceCents: d.balanceCents ?? 0,
        daysOverdue,
      };
      if (d.paymentCents !== null) debt.monthlyPaymentCents = d.paymentCents;
      if (d.installments !== '') debt.remainingInstallments = Number(d.installments);
      const bps = percentToBps(d.ratePct);
      if (bps !== undefined) debt.monthlyRateBps = bps;
      if (firstDefaultOn) debt.firstDefaultOn = firstDefaultOn;
      if (d.kind === 'other' && (d.kindNote ?? '').trim()) debt.kindNote = d.kindNote.trim();
      return debt;
    }),
  };
}

/** Inverso de buildInput: devolve ao formulário os dados do Mapa já pago, para a pessoa corrigir e refazer. */
export function answersFromInput(input) {
  const p = input.profile;
  const nearestBand = (days) => OVERDUE_BANDS.map(([v]) => Number(v)).reduce((a, b) => (Math.abs(b - days) < Math.abs(a - days) ? b : a));
  return {
    employmentType: p.employmentType ?? '',
    employmentNote: p.employmentNote ?? '',
    netIncomeCents: p.netIncomeCents ?? null,
    ageBand: p.ageBand ?? '',
    uf: p.uf ?? '',
    fixedExpensesCents: p.fixedExpensesCents ?? null,
    consent: true, // os termos já foram aceitos na compra
    debts: input.debts.map((d) => ({
      ...newDebt(),
      creditor: d.creditorName ?? '',
      kind: d.kind ?? '',
      kindNote: d.kindNote ?? '',
      balanceCents: d.balanceCents ?? null,
      paymentCents: d.monthlyPaymentCents ?? null,
      overdue: d.daysOverdue > 0 ? 'yes' : 'no',
      overdueBand: d.daysOverdue > 0 && !d.firstDefaultOn ? String(nearestBand(d.daysOverdue)) : '',
      installments: d.remainingInstallments === undefined || d.remainingInstallments === null ? '' : String(d.remainingInstallments),
      ratePct: d.monthlyRateBps === undefined || d.monthlyRateBps === null ? '' : String(d.monthlyRateBps / 100).replace('.', ','),
      firstDefaultMonth: d.firstDefaultOn ? String(d.firstDefaultOn).slice(0, 7) : '',
    })),
  };
}

// ---------- eventos ----------
function debtOf(target) {
  const uidValue = target.dataset.debt;
  return uidValue ? state.answers.debts.find((d) => d.uid === uidValue) : undefined;
}

function onInput(event) {
  const t = event.target;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;

  if (t.matches('[data-money]')) {
    if (event.type === 'change') {
      // saiu do campo: fecha o valor ("1.700" → "1.700,00")
      const closed = fieldToCents(t.value);
      t.value = closed === null ? '' : centsToField(closed);
    } else {
      t.value = maskMoneyLive(t.value);
      t.setSelectionRange(t.value.length, t.value.length);
    }
  }

  const key = t.dataset.field;
  const a = state.answers;
  const d = debtOf(t);
  const cents = t.matches('[data-money]') ? fieldToCents(t.value) : null;

  if (d) {
    if (key === 'creditor') d.creditor = t.value;
    else if (key === 'kind') {
      d.kind = t.value;
      const noteField = $(`#${d.uid}-kindnote`)?.closest('.field');
      if (noteField) {
        noteField.hidden = d.kind !== 'other';
        if (d.kind === 'other') $(`#${d.uid}-kindnote`)?.focus();
      }
    } else if (key === 'kindNote') d.kindNote = t.value;
    else if (key === 'balance') d.balanceCents = cents;
    else if (key === 'payment') d.paymentCents = cents;
    else if (key === 'overdue') {
      d.overdue = t.value;
      const bandField = $(`#${d.uid}-band`)?.closest('.field');
      if (bandField) bandField.hidden = d.overdue !== 'yes';
      clearError(`${d.uid}-overdue`);
    } else if (key === 'overdueBand') d.overdueBand = t.value;
    else if (key === 'installments') d.installments = t.value.replace(/\D/g, '');
    else if (key === 'ratePct') d.ratePct = t.value;
    else if (key === 'firstDefaultMonth') d.firstDefaultMonth = t.value;
    if (key === 'installments' && t.value !== d.installments) t.value = d.installments;
  } else if (key === 'employmentNote') {
    a.employmentNote = t.value;
  } else if (key === 'employmentType') {
    a.employmentType = t.value;
    clearError('employment');
    const noteField = $('.field-employment-note');
    if (noteField) {
      noteField.hidden = a.employmentType !== 'other';
      if (a.employmentType === 'other') $('#employment-note')?.focus();
    }
  } else if (key === 'consent') {
    a.consent = t.checked;
    clearError('consent');
  }

  if (t.id === 'income') a.netIncomeCents = cents;
  if (t.id === 'fixed') a.fixedExpensesCents = cents;
  if (t.id === 'age') a.ageBand = t.value;
  if (t.id === 'uf') a.uf = t.value;

  if (t.id) clearError(t.id);
  saveDraft();
  renderSummary();
}

function onClick(event) {
  const t = event.target instanceof Element ? event.target.closest('button') : null;
  if (!t) return;
  if (t.id === 'add-debt') {
    const debt = newDebt();
    state.answers.debts.push(debt);
    renderDebts();
    saveDraft();
    renderSummary();
    focusSoon(document.getElementById(`${debt.uid}-creditor`));
    announce(`Dívida ${state.answers.debts.length} adicionada`);
  } else if (t.dataset.remove) {
    state.answers.debts = state.answers.debts.filter((d) => d.uid !== t.dataset.remove);
    if (state.answers.debts.length === 0) state.answers.debts = [newDebt()];
    renderDebts();
    saveDraft();
    renderSummary();
    focusSoon($('#add-debt', timelineEl));
    announce('Dívida removida');
  } else if (t.dataset.edit !== undefined) {
    goTo(Number(t.dataset.edit));
  } else if (t.hasAttribute('data-back')) {
    goTo(state.step - 1);
  }
}

function onSubmitForm(event) {
  const form = event.target.closest('form[data-step-form]');
  if (!form) return;
  event.preventDefault();
  next(Number(form.dataset.stepForm));
}

export function initIntake({ timeline, summary, onComplete, onStep: stepHook = () => {} }) {
  timelineEl = timeline;
  summaryEl = summary;
  onSubmit = onComplete;
  onStep = stepHook;
  buildTimeline();
  timelineEl.addEventListener('input', onInput);
  timelineEl.addEventListener('change', onInput);
  timelineEl.addEventListener('click', onClick);
  timelineEl.addEventListener('submit', onSubmitForm);
  refreshStates();
}

/** Recria o formulário a partir do estado (depois de restaurar rascunho ou apagar dados). */
export function rebuildIntake() {
  buildTimeline();
  refreshStates();
}

export function isComplete() {
  return STEPS.every((_, i) => validateStep(i).length === 0);
}

export const kindLabel = (kind) => KIND_LABEL[kind] ?? kind;
