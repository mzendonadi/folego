// Chatbot: quem chamou a FôlIA (landing e Prumo), o que conversou, quanto virou venda e a retomada do contato.
import { api } from '../api.js';
import { el, icon, toast, int, pct, dt, card, cardOpts, kpi, kpis, grid, table, bar, columns, badge, field, drawer, pager, periodSelect, empty } from '../ui.js';

const STATUS = { novo: ['Novo', 'warn'], em_contato: ['Em contato', 'muted'], convertido: ['Convertido', 'ok'], descartado: ['Descartado', 'muted'] };
const ORIGIN = { landing: 'Site', prumo: 'Prumo' };

const digits = (s) => String(s ?? '').replace(/\D/g, '');
const firstName = (l) => (l.name ? l.name.split(' ')[0] : '');
const minutes = (m) => (m === null || m === undefined ? '—' : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`);

/** Mensagem pronta para a equipe retomar o contato (a pessoa edita antes de enviar). */
const followUp = (l) => `Olá${firstName(l) ? `, ${firstName(l)}` : ''}! Aqui é da equipe do Fôlego. Vi que você conversou com a nossa assistente${l.origin === 'prumo' ? ' no Prumo' : ' no site'} e quero te ajudar a dar o próximo passo. Posso te explicar rapidinho como funciona?`;

export async function chatbotScreen(ctx) {
  const days = ctx.state.days;
  const st = { status: '', origin: '', q: '', page: 0 };
  const [m, first] = await Promise.all([api.chatResumo(days), api.chatContatos({ pagina: 0 })]);

  const head = el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, `Período: últimos ${days === 3650 ? 'todos os' : days} ${days === 3650 ? 'registros' : 'dias'}. Quem chama o chat informa celular com DDD e e-mail antes de conversar.`), periodSelect(days, (v) => ctx.setDays(v)));

  const top = kpis(
    kpi('Contatos', int(m.leads), `${int(m.messagesFromPeople)} mensagens recebidas`),
    kpi('Pelo site', int(m.byOrigin.landing)),
    kpi('Pelo Prumo', int(m.byOrigin.prumo)),
    kpi('Aguardando contato', int(m.byStatus.novo), m.late ? `${int(m.late)} há mais de 24 h` : 'nenhum atrasado', m.late ? 'bad' : m.byStatus.novo ? 'warn' : ''),
    kpi('Em contato', int(m.byStatus.em_contato)),
    kpi('Convertidos', int(m.byStatus.convertido), 'viraram clientes', m.byStatus.convertido ? 'good' : ''),
    kpi('Conversão', pct(m.conversionPct), 'dos contatos do período', 'good'),
    kpi('Tempo até o 1º contato', minutes(m.avgFirstContactMinutes), `${pct(m.contactedPct)} já contatados`),
  );

  const steps = [['Chamaram o chat', m.leads], ['Já contatados pela equipe', m.byStatus.em_contato + m.byStatus.convertido], ['Viraram clientes', m.byStatus.convertido]];
  const funnel = card(
    'Do chat à venda',
    el('ol', { class: 'bo-funnel' }, ...steps.map(([label, n], i) => el('li', {}, el('div', { class: 'bo-funnel-row' }, el('span', {}, label), el('strong', {}, int(n)), el('span', { class: 'muted' }, i === 0 || !steps[i - 1][1] ? '' : `${pct((n / steps[i - 1][1]) * 100)} do passo anterior`)), bar(n, steps[0][1] || 1, i === steps.length - 1 ? 'good' : 'primary')))),
    cardOpts({ sub: 'Convertido = pagou depois de chamar o chat (cruzado pelo e-mail informado) ou marcado por você.' }),
  );
  const perDay = card('Contatos por dia', columns(m.byDay.map((d) => ({ label: new Date(`${d.day}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: d.leads })), { label: 'Contatos do chatbot por dia' }));

  const ai = card(
    'Atendimento da assistente',
    kpis(kpi('Respostas da IA', int(m.repliesAi)), kpi('Respostas por regras', int(m.repliesRules), 'sem IA ou no limite'), kpi('Tokens de entrada', int(m.tokensIn)), kpi('Tokens de saída', int(m.tokensOut))),
    m.aiOn
      ? el('p', { class: 'fine' }, 'IA ligada. Os preços citados pela assistente vêm sempre de "Produtos e preços".')
      : el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'IA desligada ou sem chave: a assistente responde por regras e avisa que a equipe entra em contato. Coloque a chave (ANTHROPIC_API_KEY) nos Secrets para ligar.')),
  );

  // ---- lista de contatos ----
  const listBox = el('div', { class: 'bo-stack' });
  const statusSel = el('select', { class: 'input input-sm', 'aria-label': 'Filtrar por situação' }, el('option', { value: '' }, 'Todas as situações'), ...Object.entries(STATUS).map(([k, [l]]) => el('option', { value: k }, l)));
  const originSel = el('select', { class: 'input input-sm', 'aria-label': 'Filtrar por origem' }, el('option', { value: '' }, 'Site e Prumo'), el('option', { value: 'landing' }, 'Só o site'), el('option', { value: 'prumo' }, 'Só o Prumo'));
  const search = el('input', { class: 'input input-sm', type: 'search', placeholder: 'Buscar nome, e-mail ou celular', 'aria-label': 'Buscar contato' });
  const reloadList = async () => {
    const r = await api.chatContatos({ status: st.status, origem: st.origin, busca: st.q, pagina: st.page });
    draw(r);
  };
  statusSel.addEventListener('change', () => { st.status = statusSel.value; st.page = 0; reloadList(); });
  originSel.addEventListener('change', () => { st.origin = originSel.value; st.page = 0; reloadList(); });
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { st.q = search.value.trim(); st.page = 0; reloadList(); }, 300);
  });

  function draw(r) {
    const pg = pager(r.page, r.total, r.pageSize, (p) => { st.page = p; reloadList(); });
    listBox.replaceChildren(
      ...[table(
        [
          { label: 'Contato', render: (l) => el('span', { class: 'bo-stack-sm' }, el('strong', {}, l.name ?? 'Sem nome'), el('span', { class: 'fine muted' }, l.email), el('span', { class: 'fine muted' }, l.phone)) },
          { label: 'Origem', render: (l) => ORIGIN[l.origin] ?? l.origin },
          { label: 'Situação', render: (l) => badge(...STATUS[l.status]) },
          { label: 'Mensagens', align: 'right', render: (l) => int(l.messages) },
          { label: 'Última atividade', render: (l) => dt(l.lastMessageAt ?? l.createdAt) },
        ],
        r.items,
        { emptyText: 'Ninguém chamou o chatbot com esses filtros ainda.', onRow: (l) => openLead(l.id) },
      ), pg].filter(Boolean),
    );
  }

  async function openLead(id) {
    const d = drawer('Contato do chatbot');
    const render = (data) => {
      const l = data.lead;
      const phone = digits(l.phone);
      const wa = `https://wa.me/${phone}?text=${encodeURIComponent(followUp(l))}`;
      const notes = el('textarea', { class: 'input', rows: '3', maxlength: '2000', 'aria-label': 'Anotações internas' });
      notes.value = l.notes ?? '';
      const note = el('input', { class: 'input', type: 'text', maxlength: '1000', placeholder: 'Ex.: liguei, vai decidir sexta', 'aria-label': 'Registrar contato feito' });
      const setStatus = async (status) => {
        try { render(await api.chatAtualizar(l.id, { status })); toast('Situação atualizada.'); reloadList(); } catch (e) { toast(e.message); }
      };
      const statusBtns = Object.entries(STATUS).map(([k, [label]]) => {
        const b = el('button', { class: `btn btn-sm ${l.status === k ? 'btn-primary' : 'btn-secondary'}`, type: 'button', 'aria-pressed': String(l.status === k) }, label);
        b.addEventListener('click', () => setStatus(k));
        return b;
      });
      const saveNotes = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Salvar anotações');
      saveNotes.addEventListener('click', async () => {
        try { render(await api.chatAtualizar(l.id, { notes: notes.value })); toast('Anotações salvas.'); } catch (e) { toast(e.message); }
      });
      const log = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Registrar contato');
      log.addEventListener('click', async () => {
        if (note.value.trim().length < 2) return toast('Escreva o que foi combinado.');
        try { render(await api.chatAnotar(l.id, note.value.trim())); toast('Contato registrado.'); reloadList(); } catch (e) { toast(e.message); }
      });
      const copy = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('copy'), 'Copiar mensagem');
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(followUp(l)); toast('Mensagem copiada.'); } catch { toast('Não consegui copiar.'); } });

      d.body.replaceChildren(
        el('div', { class: 'bo-head-line' }, el('h3', {}, l.name ?? 'Sem nome'), badge(...STATUS[l.status]), badge(ORIGIN[l.origin] ?? l.origin, 'muted'), l.isSubscriber ? badge('já tem cadastro', 'ok') : null),
        el('p', { class: 'fine muted' }, `Chamou em ${dt(l.createdAt)} · ${int(l.messages)} mensagens${l.contactedAt ? ` · contatado em ${dt(l.contactedAt)}` : ''}${l.convertedAt ? ` · convertido em ${dt(l.convertedAt)}` : ''}`),
        el('section', {}, el('h4', {}, 'Retomar o contato'),
          el('div', { class: 'bo-actions' },
            el('a', { class: 'btn btn-primary btn-sm', href: wa, target: '_blank', rel: 'noopener noreferrer' }, icon('chat'), 'WhatsApp'),
            el('a', { class: 'btn btn-secondary btn-sm', href: `tel:+${phone}` }, icon('phone'), l.phone),
            el('a', { class: 'btn btn-secondary btn-sm', href: `mailto:${l.email}?subject=${encodeURIComponent('Fôlego: posso te ajudar?')}&body=${encodeURIComponent(followUp(l))}` }, icon('mail'), 'E-mail'),
            copy),
          el('p', { class: 'fine muted' }, 'O WhatsApp abre com uma mensagem pronta para você ajustar. Depois de falar, registre abaixo.')),
        el('section', {}, el('h4', {}, 'Situação'), el('div', { class: 'bo-actions' }, ...statusBtns)),
        el('section', {}, el('h4', {}, 'Conversa'),
          data.messages.length
            ? el('ol', { class: 'bo-chatlog' }, ...data.messages.map((x) => el('li', { class: `bo-msg bo-msg-${x.role}` }, el('span', { class: 'bo-msg-who' }, x.role === 'user' ? (l.name ? firstName(l) : 'Cliente') : x.role === 'team' ? 'Equipe' : 'FôlIA', el('time', { class: 'fine muted', datetime: x.at }, ` ${dt(x.at)}`)), el('p', {}, x.text))))
            : empty('Sem mensagens.')),
        el('section', {}, el('h4', {}, 'Registrar contato feito'), field('O que foi combinado', note), log),
        el('section', {}, el('h4', {}, 'Anotações internas'), field('Só a equipe vê', notes), saveNotes),
      );
    };
    try { render(await api.chatContato(id)); } catch (e) { d.body.replaceChildren(el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, e.message))); }
  }

  draw(first);
  const list = card('Contatos do chatbot', el('div', { class: 'bo-filters' }, statusSel, originSel, search), listBox, cardOpts({ sub: 'Clique num contato para ver a conversa e retomar o contato. Celular e e-mail são dados pessoais: use só para atender quem pediu.' }));

  return el('div', { class: 'bo-stack' }, head, top, grid(2, funnel, perDay), list, ai);
}
