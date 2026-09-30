// Seções geradas em segundo plano depois do pagamento: roteiros de negociação, cartas e renda extra.
import { el, icon, toast, copyText } from './dom.js';
import { brl } from './format.js';
import { KIND_LABEL } from './copy.js';
import { incomeSection } from './income.js';

const list = (items, cls = 'bullets') => el('ul', { class: cls }, ...items.map((t) => el('li', {}, t)));

function card(id, title, ...children) {
  return el('section', { class: 'card d-section', id, 'aria-labelledby': `${id}-t` }, el('h2', { id: `${id}-t` }, title), ...children);
}

function statusBox(icon_, title, text) {
  return el('div', { class: 'pending' }, icon(icon_), el('div', {}, el('strong', {}, title), el('p', { class: 'muted' }, text)));
}

function copyButton(label, getText) {
  return el(
    'button',
    {
      class: 'btn btn-secondary btn-sm no-print',
      type: 'button',
      onclick: async () => {
        const ok = await copyText(getText());
        toast(ok ? 'Texto copiado.' : 'Não consegui copiar. Selecione o texto e copie manualmente.');
      },
    },
    icon('copy'),
    label,
  );
}

function downloadButton(filename, getText) {
  return el(
    'button',
    {
      class: 'btn btn-quiet btn-sm no-print',
      type: 'button',
      onclick: () => {
        const url = URL.createObjectURL(new Blob([getText()], { type: 'text/plain;charset=utf-8' }));
        const a = el('a', { href: url, download: filename });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      },
    },
    'Baixar .txt',
  );
}

const block = (title, ...children) => el('div', { class: 'script-block' }, el('h4', {}, title), ...children);

function debtScript(d) {
  const kind = KIND_LABEL[d.kind] ?? d.kind;
  const offer = d.oferta
    ? el(
        'dl',
        { class: 'offer' },
        el('div', {}, el('dt', {}, `Abertura (${d.oferta.openingPct}% de desconto)`), el('dd', {}, brl(d.oferta.openingCents))),
        el('div', {}, el('dt', {}, `Alvo (${d.oferta.targetPct}%)`), el('dd', {}, brl(d.oferta.targetCents))),
        el('div', {}, el('dt', {}, `Não passe de (${d.oferta.limitPct}%)`), el('dd', {}, brl(d.oferta.limitCents))),
      )
    : null;
  return el(
    'article',
    { class: 'script' },
    el('h3', {}, d.creditorName, ' ', el('span', { class: 'muted' }, `· ${kind}`)),
    el('p', {}, d.resumo),
    block('Antes de ligar', list(d.antes_de_ligar)),
    block('Como começar a conversa', el('blockquote', { class: 'quote' }, d.abertura), copyButton('Copiar', () => d.abertura)),
    block('Argumentos', list(d.argumentos)),
    block('Sua proposta', el('p', {}, d.proposta), offer),
    block('Mensagem pronta (WhatsApp ou e-mail)', el('pre', { class: 'message' }, d.mensagem_whatsapp), copyButton('Copiar mensagem', () => d.mensagem_whatsapp)),
    block('O que evitar', list(d.evitar)),
    block('Se recusarem', el('p', {}, d.se_recusarem)),
  );
}

export function scriptsSection(g) {
  const s = g?.scripts;
  if (!s || s.status === 'unavailable') {
    return card('roteiros', 'Roteiros de negociação', statusBox('info', 'Indisponível nesta demonstração', 'Na versão real, os roteiros por credor são escritos logo depois do pagamento.'));
  }
  if (s.status === 'pending' || s.status === 'generating') {
    return card('roteiros', 'Roteiros de negociação', statusBox('clock', 'Estamos escrevendo seus roteiros…', 'Leva cerca de 1 minuto. Você não precisa fazer nada: esta parte da página se atualiza sozinha.'));
  }
  if (s.status === 'failed' || !s.content) {
    return card('roteiros', 'Roteiros de negociação', statusBox('alert', 'Não conseguimos preparar agora', 'Isso é problema nosso, não seu. Recarregue a página em alguns minutos; o Mapa continua disponível.'));
  }
  const c = s.content;
  const origin =
    s.source === 'ai'
      ? 'Escritos com ajuda de inteligência artificial a partir dos seus números (sem nomes nem dados pessoais). Leia e ajuste com o seu jeito de falar antes de usar.'
      : 'Roteiros montados com os seus números. Ajuste com o seu jeito de falar antes de usar.';
  return card(
    'roteiros',
    'Roteiros de negociação',
    el('p', { class: 'section-sub' }, origin),
    c.capacityCents > 0
      ? el('p', { class: 'note' }, icon('info'), el('span', {}, `Teto mensal para todos os acordos somados: ${brl(c.capacityCents)}. Não aceite parcelas que passem disso.`))
      : el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Seu orçamento está sem folga hoje. Diga com sinceridade ao credor o que consegue pagar e só aceite o que couber.')),
    ...c.debts.map(debtScript),
    c.held.length > 0
      ? el('div', { class: 'notice notice-amber' }, icon('alert'), el('div', {}, el('h3', { class: 'notice-title' }, 'Não negocie estas antes de conferir'), ...c.held.map((h) => el('p', {}, el('strong', {}, `${h.creditorName}. `), h.aviso))))
      : null,
    block('Dicas para todas as conversas', list(c.general)),
  );
}

// ---------- cartas: campos pessoais preenchidos NO NAVEGADOR (nada disso vai ao servidor) ----------
const FIELD_DEFS = [
  ['nome', 'Nome completo', '[SEU NOME COMPLETO]', 'name'],
  ['cpf', 'CPF', '[SEU CPF]', 'off'],
  ['cidade', 'Cidade', '[CIDADE]', 'address-level2'],
  ['email', 'E-mail', '[SEU E-MAIL]', 'email'],
  ['telefone', 'Telefone', '[SEU TELEFONE]', 'tel'],
];

export const todayLong = (now = new Date()) => now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Troca os campos entre colchetes pelo que a pessoa digitou. O que ficou vazio continua entre colchetes. */
export function fillLetter(text, data, contract = '') {
  let out = text.replaceAll('[DATA]', data.data || '[DATA]');
  for (const [key, , placeholder] of FIELD_DEFS) if (data[key]) out = out.replaceAll(placeholder, data[key]);
  if (contract) out = out.replace(/\[NÚMERO DO CONTRATO OU PROTOCOLO, SE TIVER\]/g, contract);
  return out;
}

/** Campos ainda entre colchetes (o número do contrato é opcional e não conta). */
export function missingFields(text) {
  return [...new Set((text.match(/\[[^\]\n]+\]/g) ?? []).filter((f) => !/SE TIVER/.test(f)))];
}

const maskCpf = (v) => {
  const d = v.replace(/\D/g, '').slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
};

async function savePdf(docs, filename) {
  toast('Gerando o PDF…');
  try {
    const { buildPdf } = await import('../vendor/pdf.js');
    const bytes = await buildPdf(docs);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (error) {
    console.error(error);
    toast('Não consegui gerar o PDF agora. Use "Copiar carta" ou "Baixar .txt".');
  }
}

function lettersUi(c) {
  const data = { nome: '', cpf: '', cidade: '', email: '', telefone: '', data: todayLong() };
  const contracts = new Map();
  const views = []; // { l, pre, status }

  const textOf = (l) => fillLetter(l.corpo, data, contracts.get(l.id) ?? '');
  const refresh = () => {
    let total = 0;
    for (const v of views) {
      const text = textOf(v.l);
      v.pre.textContent = text;
      const missing = missingFields(text);
      total += missing.length;
      v.status.replaceChildren(icon(missing.length ? 'alert' : 'check'), el('span', {}, missing.length ? `Faltam ${missing.length} ${missing.length === 1 ? 'campo' : 'campos'}: ${missing.join(', ')}` : 'Pronta para enviar'));
      v.status.className = `letter-status ${missing.length ? 'is-missing' : 'is-ready'}`;
    }
    allNote.textContent = total === 0 ? 'Todas as cartas estão preenchidas.' : `Ainda faltam campos em algumas cartas (${total} no total). Você pode baixar assim mesmo e completar à mão.`;
  };

  const form = el(
    'div',
    { class: 'fill-form no-print' },
    el('h3', {}, 'Preencha uma vez, vale para todas as cartas'),
    el('p', { class: 'note' }, icon('shield'), el('span', {}, 'Estes dados ficam só neste navegador: não são enviados ao Fôlego nem a ninguém. Se fechar a página, é só preencher de novo.')),
    el(
      'div',
      { class: 'field-row' },
      ...FIELD_DEFS.map(([key, label, , auto]) => {
        const input = el('input', { class: 'input', id: `fill-${key}`, type: key === 'email' ? 'email' : 'text', autocomplete: auto, inputmode: key === 'cpf' || key === 'telefone' ? 'numeric' : undefined, maxlength: '80' });
        input.addEventListener('input', () => {
          if (key === 'cpf') input.value = maskCpf(input.value);
          data[key] = input.value.trim();
          refresh();
        });
        return el('div', { class: 'field' }, el('label', { class: 'label', for: `fill-${key}` }, label), input);
      }),
    ),
  );

  const allNote = el('p', { class: 'muted', role: 'status' });
  const downloadAll = el(
    'button',
    {
      class: 'btn btn-primary no-print',
      type: 'button',
      onclick: () => savePdf(c.letters.map((l) => ({ title: l.titulo, body: textOf(l) })), 'cartas-folego.pdf'),
    },
    'Baixar todas em um PDF',
  );

  const cards = c.letters.map((l) => {
    const pre = el('pre', { class: 'letter' });
    const status = el('p', { class: 'letter-status', role: 'status' });
    const contract = el('input', { class: 'input', id: `ct-${l.id}`, type: 'text', maxlength: '60', placeholder: 'Ex.: número do contrato, do cartão ou do protocolo' });
    contract.addEventListener('input', () => {
      contracts.set(l.id, contract.value.trim());
      refresh();
    });
    views.push({ l, pre, status });
    return el(
      'article',
      { class: 'script' },
      el('h3', {}, l.titulo),
      el('p', { class: 'muted' }, `Para: ${l.destinatario} · Assunto: ${l.assunto}`),
      el('div', { class: 'field no-print' }, el('label', { class: 'label', for: `ct-${l.id}` }, 'Número do contrato ou protocolo (opcional)'), contract),
      pre,
      status,
      el(
        'div',
        { class: 'button-row' },
        copyButton('Copiar carta', () => textOf(l)),
        downloadButton(`${l.id}.txt`, () => textOf(l)),
        el('button', { class: 'btn btn-primary btn-sm no-print', type: 'button', onclick: () => savePdf([{ title: l.titulo, body: textOf(l) }], `${l.id}.pdf`) }, icon('printer'), 'Baixar PDF'),
      ),
      l.anexos.length > 0 ? block('Anexe', list(l.anexos)) : null,
      block('Como enviar', list(l.como_enviar)),
      ...l.avisos.map((a) => el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, a))),
    );
  });
  refresh();
  return { form, allNote, downloadAll, cards };
}

export function lettersSection(g) {
  const s = g?.letters;
  if (!s || s.status === 'unavailable') {
    return card('cartas', 'Kit de cartas e defesas', statusBox('info', 'Indisponível nesta demonstração', 'Na versão real, as cartas ficam prontas logo depois do pagamento.'));
  }
  if (s.status === 'pending' || s.status === 'generating') {
    return card('cartas', 'Kit de cartas e defesas', statusBox('clock', 'Preparando suas cartas…', 'Esta parte da página se atualiza sozinha.'));
  }
  if (s.status === 'failed' || !s.content) {
    return card('cartas', 'Kit de cartas e defesas', statusBox('alert', 'Não conseguimos preparar agora', 'Isso é problema nosso. Recarregue a página em alguns minutos.'));
  }
  const c = s.content;
  if (c.letters.length === 0) {
    return card('cartas', 'Kit de cartas e defesas', el('p', {}, 'Nenhuma carta se aplica ao seu caso agora: não há dívida em atraso ou possivelmente prescrita.'), block('Dicas', list(c.general)));
  }
  const ui = lettersUi(c);
  return card(
    'cartas',
    'Kit de cartas e defesas',
    el('p', { class: 'section-sub' }, 'São modelos prontos: preencha seus dados abaixo, confira o texto e baixe em PDF para enviar. Confirme com um advogado ou a Defensoria Pública se o modelo se aplica ao seu caso.'),
    ui.form,
    el('div', { class: 'button-row no-print' }, ui.downloadAll, ui.allNote),
    ...ui.cards,
    block('Dicas', list(c.general)),
  );
}

export const isPending = (g) => Object.values(g ?? {}).some((x) => x && (x.status === 'pending' || x.status === 'generating'));

/** Troca só as seções geradas, sem mexer no resto da página nem na rolagem. */
export function renderGenerated(root, g, { withLetters, onIncomeInterview, onIncomeTask }) {
  const swap = (id, node) => {
    const old = root.querySelector(`#${id}`);
    if (old && node) old.replaceWith(node);
  };
  swap('roteiros', scriptsSection(g));
  if (withLetters) swap('cartas', lettersSection(g));
  if (g?.income) swap('renda', incomeSection(g.income, { onSubmitInterview: onIncomeInterview, onToggleTask: onIncomeTask }));
}
