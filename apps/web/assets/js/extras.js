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
    el('p', { class: 'fine' }, 'Quem tiver o link abre o seu Mapa: não compartilhe. Ao abrir o link em outro aparelho, o Mapa passa a abrir só lá; para voltar a abrir neste, gere um link novo (o anterior deixa de valer).'),
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
const KIND = { orcamento: 'Orçamento', essencial: 'Conta essencial', prescricao: 'Atenção', negociar: 'Negociar', pagar: 'Pagar', revisar: 'Revisão', estrategia: 'Estratégia', marco: 'Marco' };

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
const nextDay = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Arquivo .ics: é o formato padrão de calendário, aceito por Google Agenda, iPhone/Mac (Apple Calendário) e Outlook.
 * Eventos de dia inteiro com lembrete às 9h do próprio dia.
 */
export function buildIcs(items) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Folego//Calendario de acoes//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Fôlego: plano de ação', 'X-WR-TIMEZONE:America/Sao_Paulo'];
  items.forEach((it, i) => {
    const day = it.date.replaceAll('-', '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${day}-${i}@folego.online`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${nextDay(it.date).replaceAll('-', '')}`,
      `SUMMARY:${esc(`Fôlego: ${it.title}`)}`,
      `DESCRIPTION:${esc(it.detail)}`,
      `CATEGORIES:${esc(KIND[it.kind] ?? 'Fôlego')}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(it.title)}`, 'TRIGGER:PT9H', 'END:VALARM',
      'END:VEVENT',
    );
  });
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Link que abre o Google Agenda com o evento já preenchido (um evento por vez; para todos de uma vez, importe o arquivo). */
export function googleCalendarUrl(it) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: `Fôlego: ${it.title}`, dates: `${it.date.replaceAll('-', '')}/${nextDay(it.date).replaceAll('-', '')}`, details: it.detail });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function calendarSection(items) {
  const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: '2-digit' });
  const download = () => saveFile('folego-plano-de-acao.ics', 'text/calendar;charset=utf-8', buildIcs(items));
  const soon = items.filter((it) => it.day <= 30);
  const later = items.filter((it) => it.day > 30);
  const how = el('div', { class: 'cal-how', hidden: true });
  const show = (title, steps) => {
    how.hidden = false;
    how.replaceChildren(el('h3', {}, title), el('ol', { class: 'strat-steps' }, ...steps.map((s) => el('li', {}, s))));
  };
  const btn = (label, onclick, primary = false) => el('button', { class: `btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-sm`, type: 'button', onclick }, icon('clock'), label);
  const row = (it) =>
    el(
      'li', { class: `agenda-item kind-${it.kind}` },
      el('div', { class: 'agenda-date' }, el('strong', {}, it.day === 0 ? 'Hoje' : it.day <= 30 ? `Dia ${it.day}` : fmt(it.date).split(',').pop().trim()), el('span', { class: 'muted' }, it.day <= 30 ? fmt(it.date) : '')),
      el(
        'div', { class: 'agenda-body' },
        el('span', { class: 'pill' }, KIND[it.kind] ?? it.kind),
        el('h3', {}, it.title),
        el('p', { class: 'muted' }, it.detail),
        el('a', { class: 'link no-print', href: googleCalendarUrl(it), target: '_blank', rel: 'noopener noreferrer' }, 'Adicionar só este ao Google Agenda'),
      ),
    );
  return card(
    'calendario', 'Calendário do seu plano',
    el('p', { class: 'section-sub' }, `${items.length} lembretes: as ações dos primeiros 30 dias, as estratégias do seu caso e os marcos dos próximos meses (dia de pagar, dívida quitada, livre das dívidas). Funciona no Google Agenda, no iPhone e no Outlook.`),
    el(
      'div', { class: 'button-row no-print' },
      btn('Google Agenda', () => {
        download();
        show('No Google Agenda (todos de uma vez)', ['O arquivo "folego-plano-de-acao.ics" acabou de ser baixado.', 'No computador, abra calendar.google.com, clique na engrenagem → Configurações → Importar e exportar.', 'Escolha o arquivo baixado, selecione a agenda e clique em Importar.', 'No celular Android, basta abrir o arquivo baixado e escolher "Agenda". Se preferir, use o link "Adicionar só este ao Google Agenda" em cada item abaixo.']);
      }, true),
      btn('iPhone / Mac', () => {
        download();
        show('No iPhone, iPad ou Mac (Calendário da Apple)', ['O arquivo "folego-plano-de-acao.ics" acabou de ser baixado.', 'No iPhone: toque no arquivo baixado (ele aparece no Safari ou no app Arquivos) e depois em "Adicionar Todos".', 'No Mac: dê dois cliques no arquivo e escolha em qual calendário guardar.', 'Os lembretes chegam às 9h do dia de cada ação.']);
      }),
      btn('Outlook', () => {
        download();
        show('No Outlook', ['O arquivo "folego-plano-de-acao.ics" acabou de ser baixado.', 'No computador: dê dois cliques no arquivo; o Outlook abre e pergunta se quer importar.', 'No Outlook pela internet (outlook.com): Calendário → Adicionar calendário → Carregar do arquivo.', 'Escolha o calendário e confirme.']);
      }),
    ),
    how,
    el('h3', {}, 'Primeiros 30 dias'),
    el('ol', { class: 'agenda' }, ...soon.map(row)),
    later.length > 0 ? el('h3', {}, 'Próximos meses: pagamentos e marcos') : null,
    later.length > 0 ? el('ol', { class: 'agenda' }, ...later.map(row)) : null,
  );
}
