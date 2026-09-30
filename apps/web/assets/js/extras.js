// Seções da entrega além do Mapa: link de acesso, complementos à venda e calendário.
import { el, icon, toast, copyText } from './dom.js';
import { brl } from './format.js';
import { CATALOG, ADDONS } from './catalog.js';

const card = (id, title, ...children) => el('section', { class: 'card d-section', id, 'aria-labelledby': `${id}-t` }, el('h2', { id: `${id}-t` }, title), ...children);

function saveFile(filename, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ---------- link de acesso ----------
export function accessSection(makeLink, expiresAt, sendEmail = null) {
  const out = el('div', { class: 'access-out' });
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString('pt-BR') : null;
  const btn = el('button', { class: 'btn btn-secondary', type: 'button' }, icon('lock'), 'Gerar meu link de acesso');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const url = await makeLink();
      const input = el('input', { class: 'input pix-code', type: 'text', readonly: true, value: url, 'aria-label': 'Seu link de acesso' });
      const copy = el('button', { class: 'btn btn-primary', type: 'button' }, icon('copy'), 'Copiar link');
      copy.addEventListener('click', async () => toast((await copyText(url)) ? 'Link copiado. Guarde em um lugar seguro.' : 'Não consegui copiar. Selecione o link e copie manualmente.'));
      out.replaceChildren(
        el('div', { class: 'pix-code-row' }, input, copy),
        el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Quem tiver este link abre o seu Mapa. Não compartilhe. Se gerar outro, este deixa de funcionar.')),
      );
      btn.textContent = 'Gerar um novo link';
    } catch {
      toast('Não consegui gerar o link agora. Tente de novo.');
    }
    btn.disabled = false;
  });
  return card(
    'acesso', 'Guarde seu link de acesso',
    el('p', { class: 'section-sub' }, `Você não precisa criar conta nem senha. Este aparelho já reconhece você, mas se trocar de celular, limpar o navegador ou quiser abrir em outro computador, o link abre o seu Mapa${until ? ` até ${until}` : ''}.`),
    el('div', { class: 'no-print' }, btn, out),
    sendEmail ? emailForm(sendEmail) : null,
  );
}

function emailForm(sendEmail) {
  const input = el('input', { class: 'input', id: 'acc-email', type: 'email', autocomplete: 'email', placeholder: 'seu@email.com', 'aria-label': 'E-mail para receber o link' });
  const btn = el('button', { class: 'btn btn-quiet', type: 'submit' }, 'Enviar o link por e-mail');
  const form = el('form', { class: 'no-print email-form' }, el('p', { class: 'fine' }, 'Ou receba o link no e-mail. Usamos o endereço só para enviar e não o guardamos.'), el('div', { class: 'pix-code-row' }, input, btn));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value.includes('@')) return toast('Confira o e-mail digitado.');
    btn.disabled = true;
    try {
      await sendEmail(input.value.trim());
      toast('Enviado. Olhe também a caixa de spam.');
      input.value = '';
    } catch (error) {
      toast(error?.status === 429 ? 'Você já pediu por e-mail algumas vezes hoje. Copie o link na tela.' : 'Não consegui enviar agora. Copie o link na tela.');
    }
    btn.disabled = false;
  });
  return form;
}

// ---------- complementos à venda ----------
export function addonsSection(items, { lettersEligible }, onBuy) {
  const offers = ADDONS.filter((code) => CATALOG[code].active !== false && !items.includes(code) && (code !== 'defense_letters' || lettersEligible));
  if (offers.length === 0) return null;
  return card(
    'complementos', 'Complementos para o seu Mapa',
    el('p', { class: 'section-sub' }, 'Pague só pelo que fizer sentido. Cada um é avulso, por Pix, sem renovação.'),
    el(
      'div', { class: 'addons no-print' },
      ...offers.map((code) => {
        const p = CATALOG[code];
        const btn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, `Adicionar por ${brl(p.cents)}`, icon('arrow-right'));
        btn.addEventListener('click', () => onBuy([code]));
        return el('div', { class: 'addon' }, el('h3', {}, p.name), el('p', { class: 'muted' }, p.blurb), btn);
      }),
    ),
  );
}

// ---------- calendário ----------
const KIND = { orcamento: 'Orçamento', essencial: 'Conta essencial', prescricao: 'Atenção', negociar: 'Negociar', pagar: 'Pagar', revisar: 'Revisão' };

const fold = (line) => {
  const out = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = ` ${rest.slice(73)}`;
  }
  out.push(rest);
  return out.join('\r\n');
};
const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Arquivo .ics (abre no Google Agenda, Apple e Outlook). Eventos de dia inteiro com lembrete às 9h. */
export function buildIcs(items) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Folego//Calendario 30 dias//PT-BR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Fôlego: 30 dias'];
  items.forEach((it, i) => {
    const day = it.date.replaceAll('-', '');
    const next = new Date(Date.parse(`${it.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${day}-${i}@folego.online`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${esc(`Fôlego: ${it.title}`)}`,
      `DESCRIPTION:${esc(it.detail)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.title)}`, 'TRIGGER:PT9H', 'END:VALARM',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function calendarSection(items) {
  const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
  return card(
    'calendario', 'Calendário dos 30 dias',
    el('p', { class: 'section-sub' }, 'Uma ação de cada vez, com data. Baixe para o calendário do celular e receba lembretes às 9h.'),
    el('div', { class: 'button-row no-print' }, el('button', { class: 'btn btn-primary', type: 'button', onclick: () => saveFile('folego-30-dias.ics', 'text/calendar;charset=utf-8', buildIcs(items)) }, icon('clock'), 'Baixar para meu calendário (.ics)')),
    el(
      'ol', { class: 'agenda' },
      ...items.map((it) =>
        el(
          'li', { class: `agenda-item kind-${it.kind}` },
          el('div', { class: 'agenda-date' }, el('strong', {}, it.day === 0 ? 'Hoje' : `Dia ${it.day}`), el('span', { class: 'muted' }, fmt(it.date))),
          el('div', { class: 'agenda-body' }, el('span', { class: 'pill' }, KIND[it.kind]), el('h3', {}, it.title), el('p', { class: 'muted' }, it.detail)),
        ),
      ),
    ),
  );
}
