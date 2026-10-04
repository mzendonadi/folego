// Ferramentas gratuitas: rodam no navegador (nada é enviado ao servidor) e levam ao diagnóstico.
import { el, icon } from './dom.js';
import { todayISO } from './format.js';
import { KIND_LABEL } from './copy.js';
import { prescriptionCheck, scamCheck, SCAM_QUESTIONS, RIGHTS } from '../vendor/engine.js';
import { track } from './track.js';

const card = (id, title, sub, ...children) =>
  el('section', { class: 'card d-section', id, 'aria-labelledby': `${id}-t` }, el('h2', { id: `${id}-t` }, title), el('p', { class: 'section-sub' }, sub), ...children);

const KINDS = ['credit_card', 'overdraft', 'personal_loan', 'store_credit', 'utility', 'rent', 'financing', 'payroll_loan', 'other'];

// ---------- calculadora de prescrição ----------
function prescriptionTool() {
  const kind = el('select', { class: 'input', id: 'pt-kind' }, ...KINDS.map((k) => el('option', { value: k }, KIND_LABEL[k] ?? k)));
  const kindHint = el('p', { class: 'fine', id: 'pt-kind-dica', hidden: true }, 'Para "Outra", usamos o prazo geral presumido. O prazo de verdade depende do tipo de dívida (contrato, cheque, aluguel, conta de consumo...), então confirme com um advogado ou a Defensoria Pública.');
  kind.setAttribute('aria-describedby', 'pt-kind-dica');
  kind.addEventListener('change', () => {
    kindHint.hidden = kind.value !== 'other';
  });
  const month = el('input', { class: 'input', id: 'pt-month', type: 'month', max: todayISO().slice(0, 7), required: true });
  const out = el('div', { class: 'tool-out', role: 'status', 'aria-live': 'polite' });
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Ver se pode ter prescrito');
  const form = el(
    'form', { class: 'tool-form' },
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-kind' }, 'Tipo da dívida'), kind, kindHint),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-month' }, 'Mês em que você deixou de pagar (a parcela mais antiga em aberto)'), month),
    btn,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!month.value) return;
    track('tool', { tool: 'prescricao' });
    const r = prescriptionCheck({ kind: kind.value, firstDefaultOn: `${month.value}-01`, asOf: todayISO() });
    const years = r.yearsElapsed === null ? null : String(r.yearsElapsed).replace('.', ',');
    const tone = { possible: 'note note-amber', approaching: 'note note-amber', not_prescribed: 'note', not_in_default: 'note' }[r.status];
    const title = {
      possible: 'Pode ter prescrito',
      approaching: 'Está perto de completar o prazo',
      not_prescribed: 'Ainda não completou o prazo',
      not_in_default: 'Sem atraso informado',
    }[r.status];
    const text = {
      possible: `Já se passaram cerca de ${years} anos e o prazo presumido para este tipo é de ${r.thresholdYears}. Antes de pagar ou negociar, confirme: reconhecer a dívida ou pagar uma parte pode reiniciar a contagem.`,
      approaching: `Já se passaram cerca de ${years} anos de um prazo presumido de ${r.thresholdYears}. Evite negociar ou reconhecer a dívida sem antes conferir.`,
      not_prescribed: `Passaram cerca de ${years} anos de um prazo presumido de ${r.thresholdYears}. Ainda vale negociar com calma.`,
      not_in_default: 'Sem atraso, não há o que prescrever.',
    }[r.status];
    out.replaceChildren(
      el('div', { class: tone }, icon('info'), el('div', {}, el('strong', {}, title), el('p', {}, text))),
      el('p', { class: 'fine' }, 'Resultado indicativo, não é parecer jurídico. O prazo varia conforme o caso e pode ser interrompido. Na dúvida, procure a Defensoria Pública ou um advogado.'),
    );
  });
  return card('prescricao', 'Calculadora de prescrição', 'Descubra se uma cobrança antiga pode já ter passado do prazo. Nada do que você digitar sai do seu aparelho.', form, out);
}

// ---------- detector de golpe ----------
function scamTool() {
  const answers = {};
  const out = el('div', { class: 'tool-out', role: 'status', 'aria-live': 'polite' });
  const form = el(
    'form', { class: 'tool-form' },
    el('fieldset', { class: 'fieldset' }, el('legend', { class: 'label' }, 'Marque o que aconteceu'), ...SCAM_QUESTIONS.map((q) => {
      const input = el('input', { type: 'checkbox', id: `sc-${q.id}` });
      input.addEventListener('change', () => {
        answers[q.id] = input.checked;
      });
      return el('div', { class: 'check' }, input, el('label', { for: `sc-${q.id}` }, q.text));
    })),
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Analisar'),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    track('tool', { tool: 'golpe' });
    const v = scamCheck(answers);
    out.replaceChildren(
      el('div', { class: v.level === 'low' ? 'note' : 'note note-amber' }, icon(v.level === 'low' ? 'info' : 'alert'), el('div', {}, el('strong', {}, v.title), el('p', {}, v.text))),
      el('h3', {}, 'O que fazer agora'),
      el('ul', { class: 'bullets' }, ...v.steps.map((s) => el('li', {}, s))),
    );
  });
  return card('golpe', 'Detector de golpe de “limpa nome”', 'Recebeu uma proposta ou cobrança estranha? Responda e veja o risco. Nada é enviado.', form, out);
}

// ---------- guia de direitos ----------
function rightsGuide() {
  return card(
    'direitos', 'Guia de direitos de quem está endividado', 'O que a lei diz, em linguagem simples. Serve para você conversar com mais segurança.',
    el('div', { class: 'faq' }, ...RIGHTS.map((t) => el('details', {}, el('summary', {}, t.title), el('div', {}, el('ul', { class: 'bullets' }, ...t.points.map((p) => el('li', {}, p))))))),
    el('p', { class: 'fine' }, 'Informação geral, não substitui orientação de advogado ou da Defensoria Pública.'),
  );
}

export function renderTools(root, { onStart }) {
  root.replaceChildren(
    prescriptionTool(),
    scamTool(),
    rightsGuide(),
    el(
      'section', { class: 'card discover' },
      el('h2', {}, 'Quer o quadro completo?'),
      el('p', {}, 'Em 3 minutos o Fôlego mostra por onde começar, quanto dá para economizar e a ordem certa de pagar. Grátis até ver o resultado.'),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: onStart }, 'Ver meu diagnóstico grátis', icon('arrow-right')),
    ),
  );
}
