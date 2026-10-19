// Caixa de entrada de WhatsApp (estilo WhatsApp Business) usada no portal do parceiro (API da Meta) e no backoffice do Fôlego (Bird).
// Só desenha e conversa com o servidor; as regras (janela de 24 h, permissão, SAIR, tipos de arquivo, limites) ficam no servidor.
// `host` liga o componente a cada painel: { call(method, path, body), upload(blob, { mime, filename, purpose }), blob(path) }, com caminhos relativos ao WhatsApp (/threads, /media/:id...).
import { el, toast } from './dom.js';
import { confirmDialog } from './confirm.js';

const PATHS = {
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
  clip: 'M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8',
  forward: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0-5 5v6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  stop: 'M6 6h12v12H6z',
  dots: 'M12 6.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 20.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  down: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  back: 'M19 12H5M12 19l-7-7 7-7',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
};
const NS = 'http://www.w3.org/2000/svg';
function ico(name, size = 20) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', String(size));
  s.setAttribute('height', String(size));
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('fill', name === 'dots' ? 'currentColor' : 'none');
  s.setAttribute('stroke', name === 'dots' ? 'none' : 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', PATHS[name]);
  s.append(p);
  return s;
}

const MSG_STATUS = { fila: 'na fila', enviada: 'enviada', entregue: 'entregue', lida: 'lida', falhou: 'não enviada', recebida: '' };
const OPTIN = { desconhecido: 'Sem permissão informada', sim: 'Tem permissão', nao: 'Pediu para não receber' };
const KIND = { image: 'Foto', audio: 'Áudio', document: 'Documento', video: 'Vídeo', sticker: 'Figurinha' };
const ACCEPT = 'image/jpeg,image/png,audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/amr,video/mp4,video/3gpp,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.txt,.mp3,.m4a,.ogg,.mp4,.jpg,.jpeg,.png';
const MAX_REC_SECONDS = 300;

const hm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dmy = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const dayLabel = (iso) => {
  const d = new Date(iso);
  const t = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, t)) return 'Hoje';
  const y = new Date(t);
  y.setDate(t.getDate() - 1);
  return same(d, y) ? 'Ontem' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};
const listTime = (iso) => (iso ? (new Date(iso).toDateString() === new Date().toDateString() ? hm(iso) : dmy(iso)) : '');
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const initials = (name) => (String(name).replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '#');
const hue = (name) => [...String(name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

function modal({ title, body, foot, wide = false }) {
  const closeBtn = el('button', { class: 'btn btn-quiet btn-sm wi-x', type: 'button', 'aria-label': 'Fechar' }, ico('x', 18));
  const dialog = el('dialog', { class: `dialog ${wide ? '' : 'dialog-sm'} wi-dlg`, 'aria-label': title },
    el('div', { class: 'dialog-inner' },
      el('header', { class: 'dialog-head wi-dlg-head' }, el('h2', {}, title), closeBtn),
      el('div', { class: 'dialog-body' }, ...[].concat(body).filter(Boolean)),
      foot ? el('footer', { class: 'dialog-foot' }, ...[].concat(foot).filter(Boolean)) : null));
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('cancel', close);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close };
}

export function waInbox({ host, start = {}, features = {} }) {
  const root = el('div', { class: 'wi' });
  const st = { filter: 'todas', q: '', current: null, detail: null, sig: '', selecting: false, picked: new Set(), rec: null };
  let timer = 0;
  const stop = () => window.clearInterval(timer);

  // ---------------------------------------------------------------------------------------------- arquivos (blob autenticado)
  const blobs = new Map();
  const blobUrl = (id) => {
    if (!blobs.has(id)) blobs.set(id, host.blob(`/media/${id}`).then((b) => URL.createObjectURL(b)).catch((e) => { blobs.delete(id); throw e; }));
    return blobs.get(id);
  };
  const save = async (md) => {
    try {
      const url = await blobUrl(md.id);
      const a = el('a', { href: url, download: md.filename ?? 'arquivo' });
      document.body.append(a);
      a.click();
      a.remove();
    } catch (e) { toast(e.message || 'Não consegui baixar o arquivo.'); }
  };

  function avatar(name, mediaId, cls = '') {
    const a = el('span', { class: `wi-av ${cls}`, 'aria-hidden': 'true' }, initials(name));
    a.style.setProperty('--h', String(hue(name)));
    if (mediaId) blobUrl(mediaId).then((u) => { a.textContent = ''; a.style.backgroundImage = `url("${u}")`; a.classList.add('has-img'); }).catch(() => {});
    return a;
  }

  // ---------------------------------------------------------------------------------------------- lista
  const listBox = el('aside', { class: 'wi-list', 'aria-label': 'Conversas' });
  const chatBox = el('section', { class: 'wi-chat', 'aria-label': 'Conversa aberta' });
  root.append(listBox, chatBox);
  const emptyChat = () => chatBox.replaceChildren(el('div', { class: 'wi-empty' }, ico('send', 36), el('strong', {}, 'Escolha uma conversa'), el('p', {}, 'As mensagens chegam aqui assim que o contato escreve. Para falar com um número novo, use o botão Novo.')));
  emptyChat();

  const listHead = el('div', { class: 'wi-list-head' });
  const listItems = el('div', { class: 'wi-items', role: 'list' });
  listBox.append(listHead, listItems);

  const search = el('input', { class: 'input wi-search', type: 'search', placeholder: 'Buscar conversa', 'aria-label': 'Buscar conversa' });
  search.addEventListener('change', () => { st.q = search.value.trim(); paintList(); });
  const addBtn = el('button', { class: 'btn btn-primary btn-sm wi-add', type: 'button', 'aria-label': 'Nova conversa' }, ico('plus', 18), 'Novo');
  addBtn.addEventListener('click', () => newConversation());
  const chips = el('div', { class: 'wi-chips' });
  listHead.append(el('div', { class: 'wi-list-top' }, el('div', { class: 'wi-search-wrap' }, ico('search', 16), search), addBtn), chips);

  async function paintList() {
    const p = new URLSearchParams();
    if (st.filter !== 'todas') p.set('filtro', st.filter);
    if (st.q) p.set('q', st.q);
    const r = await host.call('GET', `/threads?${p}`);
    chips.replaceChildren(...[['todas', 'Todas'], ['nao_lidas', `Não lidas${r.unread ? ` (${r.unread})` : ''}`], ['abertas', 'Abertas'], ['fechadas', 'Encerradas']].map(([k, l]) => {
      const b = el('button', { class: 'wi-chip', type: 'button', 'aria-pressed': String(st.filter === k) }, l);
      b.addEventListener('click', () => { st.filter = k; paintList(); });
      return b;
    }));
    listItems.replaceChildren(...(r.items.length ? r.items.map((t) => {
      const row = el('button', { class: `wi-thread${st.current === t.id ? ' is-on' : ''}${t.unread ? ' is-unread' : ''}`, type: 'button', role: 'listitem' },
        avatar(t.name, t.avatarMediaId),
        el('span', { class: 'wi-thread-body' },
          el('span', { class: 'wi-thread-top' }, el('strong', {}, t.name), el('time', { class: 'wi-time' }, listTime(t.lastAt))),
          el('span', { class: 'wi-thread-prev' }, el('span', { class: 'wi-prev-text' }, `${t.previewOut ? 'Você: ' : ''}${t.preview || '—'}`), t.unread ? el('span', { class: 'wi-badge' }, String(t.unread)) : null),
          el('span', { class: 'wi-thread-meta' }, t.optedOut ? 'Pediu para não receber' : t.windowOpen ? 'Janela de 24 h aberta' : 'Janela fechada', t.mode === 'ia' ? ' · IA' : '')));
      row.addEventListener('click', () => openThread(t.id));
      return row;
    }) : [el('p', { class: 'wi-none' }, 'Nenhuma conversa aqui ainda.')]));
    return r;
  }

  // ---------------------------------------------------------------------------------------------- conversa
  let pane = null; // { head, log, bar, foot, id }

  function lightbox(md) {
    const img = el('img', { class: 'wi-lightbox-img', alt: md.filename ?? 'Foto' });
    blobUrl(md.id).then((u) => { img.src = u; }).catch(() => toast('Não consegui abrir a foto.'));
    const dl = el('button', { class: 'btn btn-secondary', type: 'button' }, ico('down', 18), 'Baixar');
    dl.addEventListener('click', () => save(md));
    modal({ title: md.filename ?? 'Foto', body: [img], foot: [dl], wide: true });
  }

  function mediaNode(m) {
    const md = m.media;
    if (!md) return m.kind === 'text' || m.kind === 'template' ? null : el('p', { class: 'wi-miss' }, `${KIND[m.kind] ?? 'Arquivo'} indisponível`);
    if (m.kind === 'image' || m.kind === 'sticker') {
      const img = el('img', { class: 'wi-img', alt: 'Foto da conversa', loading: 'lazy' });
      const b = el('button', { class: 'wi-img-btn', type: 'button', 'aria-label': 'Ampliar a foto' }, img);
      blobUrl(md.id).then((u) => { img.src = u; }).catch(() => b.replaceWith(el('p', { class: 'wi-miss' }, 'Foto indisponível')));
      b.addEventListener('click', () => lightbox(md));
      return b;
    }
    if (m.kind === 'audio') {
      const a = el('audio', { class: 'wi-audio', controls: true, preload: 'metadata', 'aria-label': m.voice ? 'Mensagem de voz' : 'Áudio' });
      blobUrl(md.id).then((u) => { a.src = u; }).catch(() => a.replaceWith(el('p', { class: 'wi-miss' }, 'Áudio indisponível')));
      return a;
    }
    if (m.kind === 'video') {
      const v = el('video', { class: 'wi-video', controls: true, preload: 'metadata', 'aria-label': 'Vídeo' });
      blobUrl(md.id).then((u) => { v.src = u; }).catch(() => v.replaceWith(el('p', { class: 'wi-miss' }, 'Vídeo indisponível')));
      return v;
    }
    const chip = el('button', { class: 'wi-doc', type: 'button', 'aria-label': `Baixar ${md.filename ?? 'documento'}` }, ico('file', 26), el('span', { class: 'wi-doc-name' }, md.filename ?? 'Documento', el('small', {}, md.size ? size(md.size) : '')), ico('down', 18));
    chip.addEventListener('click', () => save(md));
    return chip;
  }

  function bubble(m) {
    const out = m.direction === 'out';
    const fwd = el('button', { class: 'wi-fwd', type: 'button', 'aria-label': 'Encaminhar esta mensagem' }, ico('forward', 16));
    fwd.addEventListener('click', (e) => { e.stopPropagation(); forwardDialog([m.id]); });
    const cb = st.selecting ? el('input', { class: 'wi-pick', type: 'checkbox', 'aria-label': 'Selecionar mensagem' }) : null;
    if (cb) {
      cb.checked = st.picked.has(m.id);
      cb.addEventListener('change', () => { if (cb.checked) st.picked.add(m.id); else st.picked.delete(m.id); paintBar(); });
    }
    const text = m.text && m.kind !== 'audio' ? el('p', { class: 'wi-text' }, m.text) : null;
    const meta = el('span', { class: 'wi-meta' }, hm(m.at), out ? ` · ${m.author === 'ia' ? 'IA' : m.author === 'sistema' ? 'automática' : 'você'}` : '', MSG_STATUS[m.status] ? ` · ${MSG_STATUS[m.status]}` : '', m.error ? ` · ${m.error}` : '');
    const body = el('div', { class: `wi-msg ${out ? 'out' : 'in'}${m.status === 'falhou' ? ' bad' : ''}${m.kind === 'template' ? ' tpl' : ''}` }, m.forwarded ? el('span', { class: 'wi-fwd-tag' }, ico('forward', 12), ' Encaminhada') : null, mediaNode(m), text, meta, st.selecting ? null : fwd);
    const row = el('div', { class: `wi-row ${out ? 'out' : 'in'}${st.selecting ? ' is-selecting' : ''}` }, cb, body);
    if (cb) row.addEventListener('click', (e) => { if (e.target === cb) return; cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); });
    return row;
  }

  function renderLog(d) {
    const log = pane.log;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const nodes = [];
    let last = '';
    for (const m of d.messages) {
      const day = new Date(m.at).toDateString();
      if (day !== last) { nodes.push(el('div', { class: 'wi-day' }, el('span', {}, dayLabel(m.at)))); last = day; }
      nodes.push(bubble(m));
    }
    log.replaceChildren(...(nodes.length ? nodes : [el('p', { class: 'wi-none' }, 'Nenhuma mensagem ainda.')]));
    if (atBottom || pane.first) { log.scrollTop = log.scrollHeight; pane.first = false; }
  }

  function paintBar() {
    const bar = pane.bar;
    bar.hidden = !st.selecting;
    if (!st.selecting) { bar.replaceChildren(); return; }
    const n = st.picked.size;
    const cancel = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Cancelar');
    cancel.addEventListener('click', () => { st.selecting = false; st.picked.clear(); renderLog(st.detail); paintBar(); });
    const go = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, ico('forward', 16), `Encaminhar${n ? ` (${n})` : ''}`);
    go.disabled = n === 0;
    go.addEventListener('click', () => forwardDialog([...st.picked]));
    bar.replaceChildren(el('span', { class: 'wi-bar-n' }, n === 1 ? '1 mensagem selecionada' : `${n} mensagens selecionadas`), cancel, go);
  }

  function buildPane(d) {
    const back = el('button', { class: 'btn btn-quiet btn-sm wi-back', type: 'button', 'aria-label': 'Voltar para a lista' }, ico('back', 20));
    back.addEventListener('click', () => { root.classList.remove('is-chat'); st.current = null; paintList(); });
    const head = el('header', { class: 'wi-head' });
    const log = el('div', { class: 'wi-log', role: 'log', 'aria-live': 'polite', tabindex: '0', 'aria-label': 'Mensagens' });
    const bar = el('div', { class: 'wi-selbar' });
    bar.hidden = true;
    const foot = el('div', { class: 'wi-foot' });
    pane = { head, log, bar, foot, id: d.id, first: true, back };
    chatBox.replaceChildren(head, log, bar, foot);
  }

  function paintHead(d) {
    const menu = el('div', { class: 'wi-menu', role: 'menu' });
    menu.hidden = true;
    const item = (label, fn, danger = false) => {
      const b = el('button', { class: `wi-menu-item${danger ? ' is-danger' : ''}`, type: 'button', role: 'menuitem' }, label);
      b.addEventListener('click', () => { menu.hidden = true; fn(); });
      return b;
    };
    menu.append(
      item('Ver e editar o perfil', () => profileDialog(d)),
      item('Selecionar mensagens', () => { st.selecting = true; st.picked.clear(); renderLog(d); paintBar(); }),
      item(d.state === 'aberta' ? 'Encerrar conversa' : 'Reabrir conversa', async () => { await host.call('PATCH', `/threads/${d.id}`, { state: d.state === 'aberta' ? 'fechada' : 'aberta' }); paintList(); openThread(d.id); }),
      ...(d.optedOut ? [] : [item('Pediu para não ser contatado', async () => {
        if (!(await confirmDialog({ title: 'Marcar como "não contatar"?', text: 'Nenhuma mensagem será enviada a este contato.', confirmLabel: 'Marcar' }))) return;
        await host.call('PATCH', `/threads/${d.id}`, { optedOut: true }); openThread(d.id); paintList();
      }, true)]),
      ...(features.agent && !d.optedOut ? [item(d.mode === 'ia' ? 'Assumir (tirar a IA)' : 'Passar para a IA', async () => {
        try { await host.call('PATCH', `/threads/${d.id}`, { mode: d.mode === 'ia' ? 'humano' : 'ia' }); openThread(d.id); paintList(); } catch (err) { toast(err.message); }
      })] : []),
    );
    const more = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': 'Mais opções', 'aria-haspopup': 'menu' }, ico('dots', 20));
    more.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', () => { menu.hidden = true; }, { once: true });
    const who = el('button', { class: 'wi-who', type: 'button', 'aria-label': 'Abrir o perfil do contato' }, avatar(d.name, d.avatarMediaId, 'lg'),
      el('span', {}, el('strong', {}, d.name), el('small', {}, `${d.phone} · ${OPTIN[d.waOptin] ?? ''}${d.windowOpen ? ' · janela aberta' : ' · janela fechada'}`)));
    who.addEventListener('click', () => profileDialog(d));
    pane.head.replaceChildren(pane.back, who, el('div', { class: 'wi-head-tools' }, d.optedOut ? el('span', { class: 'wi-pill bad' }, 'Não contatar') : null, more, menu));
  }

  async function openThread(id, { silent = false } = {}) {
    let d;
    try { d = await host.call('GET', `/threads/${id}`); } catch (e) { if (!silent) toast(e.message); return; }
    const sig = `${d.messages.length}:${d.messages.at(-1)?.id}:${d.messages.map((m) => m.status[0]).join('')}:${d.state}:${d.optedOut}:${d.name}:${d.avatarMediaId}:${d.windowOpen}:${d.mode}`;
    const fresh = st.current !== id || !pane || pane.id !== id || !chatBox.contains(pane.log);
    if (!fresh && sig === st.sig && silent) return;
    st.current = id;
    st.detail = d;
    st.sig = sig;
    if (fresh) { st.selecting = false; st.picked.clear(); buildPane(d); }
    root.classList.add('is-chat');
    paintHead(d);
    renderLog(d);
    paintBar();
    if (fresh || !pane.foot.firstChild || pane.foot.dataset.mode !== footMode(d)) paintFoot(d);
    if (!silent) paintList().catch(() => {});
  }

  const footMode = (d) => (d.optedOut ? 'optout' : d.windowOpen ? 'free' : 'template');

  // ---------------------------------------------------------------------------------------------- escrever, anexar e gravar
  function paintFoot(d) {
    const foot = pane.foot;
    foot.dataset.mode = footMode(d);
    if (d.optedOut) { foot.replaceChildren(el('p', { class: 'wi-note' }, 'Este contato não recebe mais mensagens.')); return; }
    if (!d.windowOpen) { foot.replaceChildren(templateSender(d)); return; }
    const text = el('textarea', { class: 'wi-input', rows: '1', maxlength: '1000', placeholder: 'Escreva uma mensagem', 'aria-label': 'Mensagem' });
    const fileIn = el('input', { type: 'file', accept: ACCEPT, tabindex: '-1' });
    fileIn.hidden = true;
    const clip = el('button', { class: 'wi-round', type: 'button', 'aria-label': 'Anexar foto, documento ou áudio' }, ico('clip', 22));
    clip.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', () => { const f = fileIn.files?.[0]; fileIn.value = ''; if (f) attachDialog(f, d); });
    const send = el('button', { class: 'wi-round primary', type: 'button', 'aria-label': 'Enviar' }, ico('send', 20));
    const mic = el('button', { class: 'wi-round primary', type: 'button', 'aria-label': 'Gravar mensagem de voz' }, ico('mic', 20));
    const swap = () => { const has = text.value.trim().length > 0; send.hidden = !has; mic.hidden = has; };
    text.addEventListener('input', () => { swap(); text.style.height = 'auto'; text.style.height = `${Math.min(text.scrollHeight, 140)}px`; });
    const doSend = async () => {
      const t = text.value.trim();
      if (!t) return;
      send.disabled = true;
      try { await host.call('POST', `/threads/${d.id}/messages`, { text: t }); text.value = ''; text.style.height = 'auto'; swap(); await openThread(d.id); paintList(); } catch (err) { toast(err.message); }
      send.disabled = false;
    };
    send.addEventListener('click', doSend);
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); } });
    mic.addEventListener('click', () => recordVoice(d, foot));
    foot.replaceChildren(el('div', { class: 'wi-composer' }, clip, fileIn, text, send, mic));
    swap();
  }

  function attachDialog(file, d) {
    const isImg = /^image\/(jpeg|png)$/.test(file.type);
    const preview = isImg ? el('img', { class: 'wi-preview-img', alt: 'Pré-visualização da foto' }) : el('div', { class: 'wi-doc static' }, ico(file.type.startsWith('audio/') ? 'mic' : 'file', 26), el('span', { class: 'wi-doc-name' }, file.name, el('small', {}, size(file.size))));
    if (isImg) preview.src = URL.createObjectURL(file);
    const caption = el('textarea', { class: 'input', rows: '2', maxlength: '1000', placeholder: 'Escreva uma legenda (opcional)', 'aria-label': 'Legenda' });
    const send = el('button', { class: 'btn btn-primary', type: 'button' }, ico('send', 18), 'Enviar');
    const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Cancelar');
    const m = modal({ title: isImg ? 'Enviar foto' : 'Enviar arquivo', body: [preview, file.type.startsWith('audio/') ? null : caption], foot: [cancel, send] });
    cancel.addEventListener('click', m.close);
    send.addEventListener('click', async () => {
      send.disabled = true;
      try {
        const up = await host.upload(file, { mime: file.type || 'application/octet-stream', filename: file.name });
        await host.call('POST', `/threads/${d.id}/messages`, { mediaId: up.id, caption: caption.value.trim() });
        m.close();
        await openThread(d.id);
        paintList();
      } catch (err) { send.disabled = false; toast(err.message); }
    });
  }

  async function recordVoice(d, foot) {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return toast('Este navegador não grava áudio. Anexe um arquivo de áudio com o clipe.');
    // Formatos que o WhatsApp aceita: OGG/Opus (Firefox) ou MP4/AAC (Chrome, Edge e Safari atuais). WebM não é aceito.
    const mime = ['audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/mpeg'].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mime) return toast('Este navegador grava áudio em um formato que o WhatsApp não aceita. Atualize o navegador ou anexe um arquivo de áudio.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Permita o uso do microfone no navegador para gravar.'); }
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    let secs = 0;
    let discard = false;
    rec.addEventListener('dataavailable', (e) => { if (e.data.size) chunks.push(e.data); });
    const clock = el('span', { class: 'wi-rec-time', role: 'timer' }, '0:00');
    const tick = window.setInterval(() => { secs += 1; clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; if (secs >= MAX_REC_SECONDS) rec.stop(); }, 1000);
    const cancel = el('button', { class: 'wi-round', type: 'button', 'aria-label': 'Descartar a gravação' }, ico('x', 22));
    const done = el('button', { class: 'wi-round primary', type: 'button', 'aria-label': 'Parar e enviar a mensagem de voz' }, ico('send', 20));
    const prev = [...foot.childNodes];
    const restore = () => { window.clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); foot.replaceChildren(...prev); st.rec = null; };
    cancel.addEventListener('click', () => { discard = true; rec.stop(); });
    done.addEventListener('click', () => rec.stop());
    rec.addEventListener('stop', async () => {
      restore();
      if (discard || chunks.length === 0) return;
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      try {
        const ext = blob.type === 'audio/ogg' ? 'ogg' : blob.type === 'audio/mpeg' ? 'mp3' : 'm4a';
        const up = await host.upload(blob, { mime: blob.type, filename: `voz.${ext}` });
        await host.call('POST', `/threads/${d.id}/messages`, { mediaId: up.id, voice: true });
        await openThread(d.id);
        paintList();
      } catch (err) { toast(err.message); }
    });
    foot.replaceChildren(el('div', { class: 'wi-composer wi-recording' }, cancel, el('span', { class: 'wi-rec-dot', 'aria-hidden': 'true' }), clock, el('span', { class: 'wi-rec-hint' }, 'Gravando…'), done));
    st.rec = rec;
    rec.start(250);
  }

  function templateSender(d) {
    // Modelo já enviado e a pessoa ainda não respondeu: a Meta só libera texto livre, anexos e áudio depois da resposta.
    // Em vez de manter o painel grande do modelo, mostra um aviso curto e o campo de mensagem travado, como no WhatsApp.
    const lastTpl = (d.messages ?? []).filter((m) => m.direction === 'out' && m.kind === 'template' && m.status !== 'falhou').at(-1);
    if (d.canTemplate && lastTpl && st.fullTpl !== d.id) {
      const lock = el('div', { class: 'wi-composer is-locked' },
        el('button', { class: 'wi-round', type: 'button', disabled: true, 'aria-label': 'Anexar (libera quando a pessoa responder)' }, ico('clip', 22)),
        el('textarea', { class: 'wi-input', rows: '1', disabled: true, placeholder: 'Libera quando a pessoa responder', 'aria-label': 'Mensagem (bloqueada até a pessoa responder)' }),
        el('button', { class: 'wi-round primary', type: 'button', disabled: true, 'aria-label': 'Gravar áudio (libera quando a pessoa responder)' }, ico('mic', 20)));
      const again = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Enviar outro modelo');
      again.addEventListener('click', () => { st.fullTpl = d.id; paintFoot(d); });
      return el('div', { class: 'wi-wait' },
        el('p', { class: 'wi-note' }, `Modelo enviado às ${hm(lastTpl.at)}. Quando ${d.name.split(' ')[0]} responder, o texto livre, os anexos e o áudio são liberados aqui.`, ' ', again),
        lock);
    }
    const holder = el('div', { class: 'wi-tpl' }, el('p', { class: 'wi-note' }, d.canTemplate ? 'A janela de 24 h está fechada. Para falar com este contato, envie um modelo aprovado:' : 'Sem permissão de WhatsApp para este contato. Marque a permissão no perfil dele (só se você a tem) ou aguarde ele escrever.'));
    if (!d.canTemplate) {
      const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Abrir o perfil');
      b.addEventListener('click', () => profileDialog(d));
      holder.append(b);
      return holder;
    }
    host.call('GET', '/templates').then(({ templates }) => {
      const ok = templates.filter((t) => t.status === 'aprovado');
      if (!ok.length) { holder.append(el('p', { class: 'wi-note warn' }, 'Nenhum modelo aprovado. Crie e aprove em Modelos.')); return; }
      const sel = el('select', { class: 'input', 'aria-label': 'Modelo' }, ...ok.map((t) => el('option', { value: t.id }, t.name)));
      const prev = el('p', { class: 'wi-tpl-prev' });
      const vars = el('input', { class: 'input', type: 'text', placeholder: 'Variáveis separadas por |', value: d.name.split(' ')[0] });
      const refresh = () => { const t = ok.find((x) => x.id === sel.value); prev.textContent = t.body; vars.hidden = t.slots === 0; };
      sel.addEventListener('change', refresh);
      refresh();
      const send = el('button', { class: 'btn btn-primary', type: 'button' }, 'Enviar modelo');
      send.addEventListener('click', async () => {
        send.disabled = true;
        try { await host.call('POST', `/threads/${d.id}/messages`, { templateId: sel.value, vars: vars.value.split('|').map((v) => v.trim()).filter(Boolean) }); toast('Modelo enviado.'); st.fullTpl = null; await openThread(d.id); paintFoot(st.detail ?? d); paintList(); } catch (err) { send.disabled = false; toast(err.message); }
      });
      holder.append(sel, prev, vars, send);
    }).catch((err) => holder.append(el('p', { class: 'wi-note warn' }, err.message)));
    return holder;
  }

  // ---------------------------------------------------------------------------------------------- encaminhar, número novo e perfil
  async function forwardDialog(messageIds) {
    if (!messageIds.length) return;
    const picked = new Set();
    const q = el('input', { class: 'input', type: 'search', placeholder: 'Buscar conversa', 'aria-label': 'Buscar conversa' });
    const box = el('div', { class: 'wi-pick-list', role: 'group', 'aria-label': 'Conversas' });
    const hint = el('p', { class: 'fine muted' }, 'Escolha até 5 conversas. Só chega a quem escreveu nas últimas 24 h.');
    const go = el('button', { class: 'btn btn-primary', type: 'button' }, ico('forward', 16), 'Encaminhar');
    go.disabled = true;
    const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Cancelar');
    const m = modal({ title: `Encaminhar ${messageIds.length === 1 ? 'mensagem' : `${messageIds.length} mensagens`}`, body: [q, hint, box], foot: [cancel, go] });
    cancel.addEventListener('click', m.close);
    const paint = async () => {
      const p = new URLSearchParams();
      if (q.value.trim()) p.set('q', q.value.trim());
      const r = await host.call('GET', `/threads?${p}`);
      box.replaceChildren(...r.items.filter((t) => t.id !== st.current && !t.optedOut).map((t) => {
        const cb = el('input', { type: 'checkbox', 'aria-label': t.name });
        cb.checked = picked.has(t.id);
        cb.addEventListener('change', () => {
          if (cb.checked) { if (picked.size >= 5) { cb.checked = false; return toast('No máximo 5 conversas por vez.'); } picked.add(t.id); } else picked.delete(t.id);
          go.disabled = picked.size === 0;
        });
        return el('label', { class: 'wi-pick-row' }, cb, avatar(t.name, t.avatarMediaId), el('span', { class: 'wi-pick-name' }, el('strong', {}, t.name), el('small', {}, t.windowOpen ? 'Janela aberta' : 'Janela fechada')));
      }));
    };
    q.addEventListener('change', paint);
    paint().catch((e) => toast(e.message));
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        const r = await host.call('POST', `/threads/${st.current}/forward`, { messageIds, threadIds: [...picked] });
        const sent = r.results.filter((x) => x.sent > 0).length;
        const skipped = r.results.filter((x) => x.sent === 0);
        toast(`${sent ? `Encaminhada para ${sent} conversa(s).` : 'Nada foi encaminhado.'}${skipped.length ? ` ${skipped.map((s) => `${s.name}: ${s.skipped}`).join(' ')}` : ''}`);
        m.close();
        st.selecting = false;
        st.picked.clear();
        await openThread(st.current);
        paintList();
      } catch (err) { go.disabled = false; toast(err.message); }
    });
  }

  async function newConversation(pre = {}) {
    const phone = el('input', { class: 'input', type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '(41) 99999-0000', id: 'wi-new-phone' });
    const name = el('input', { class: 'input', type: 'text', maxlength: '60', autocomplete: 'off', placeholder: 'Nome (opcional)', id: 'wi-new-name' });
    const optin = el('input', { type: 'checkbox', id: 'wi-new-optin' });
    const tplSel = el('select', { class: 'input', id: 'wi-new-tpl', 'aria-label': 'Primeira mensagem (modelo)' }, el('option', { value: '' }, 'Só abrir a conversa'));
    const vars = el('input', { class: 'input', type: 'text', placeholder: 'Variáveis separadas por |' });
    vars.hidden = true;
    const go = el('button', { class: 'btn btn-primary', type: 'button' }, 'Abrir conversa');
    const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Cancelar');
    let templates = [];
    host.call('GET', '/templates').then((r) => {
      templates = r.templates.filter((t) => t.status === 'aprovado');
      for (const t of templates) tplSel.append(el('option', { value: t.id }, t.name));
      const hint = pre.templateHint && templates.find((t) => t.name.includes(pre.templateHint));
      if (hint) { tplSel.value = hint.id; tplSel.dispatchEvent(new Event('change')); }
    }).catch(() => {});
    if (pre.phone) phone.value = pre.phone;
    if (pre.name) name.value = pre.name;
    tplSel.addEventListener('change', () => { const t = templates.find((x) => x.id === tplSel.value); vars.hidden = !t || t.slots === 0; if (t && !vars.value) vars.value = name.value.trim().split(' ')[0] ?? ''; });
    const m = modal({
      title: 'Nova conversa',
      body: [
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'wi-new-phone' }, 'WhatsApp (com DDD)'), phone),
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'wi-new-name' }, 'Nome'), name),
        el('div', { class: 'check' }, optin, el('label', { for: 'wi-new-optin' }, 'Esta pessoa me autorizou a receber mensagens por WhatsApp (marque só se for verdade).')),
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'wi-new-tpl' }, 'Primeira mensagem'), tplSel, vars, el('p', { class: 'fine muted' }, 'A primeira mensagem para um número que ainda não escreveu é sempre um modelo aprovado.')),
      ],
      foot: [cancel, go],
    });
    cancel.addEventListener('click', m.close);
    go.addEventListener('click', async () => {
      if (phone.value.replace(/\D/g, '').length < 10) return toast('Digite o WhatsApp com DDD.');
      if (tplSel.value && !optin.checked) return toast('Para enviar um modelo, confirme que a pessoa autorizou receber mensagens.');
      go.disabled = true;
      try {
        const r = await host.call('POST', '/threads/new', { phone: phone.value.trim(), name: name.value.trim() || undefined, optin: optin.checked, ...(tplSel.value ? { templateId: tplSel.value, vars: vars.value.split('|').map((v) => v.trim()).filter(Boolean) } : {}) });
        m.close();
        await paintList();
        await openThread(r.threadId);
        pre.onOpened?.(r);
      } catch (err) { go.disabled = false; toast(err.message); }
    });
    phone.focus();
  }

  function profileDialog(d) {
    const name = el('input', { class: 'input', type: 'text', maxlength: '60', value: d.name, id: 'wi-p-name' });
    const notes = el('textarea', { class: 'input', rows: '4', maxlength: '2000', placeholder: 'Observações sobre este contato (só a equipe vê)', id: 'wi-p-notes' }, d.notes ?? '');
    const optin = el('input', { type: 'checkbox', id: 'wi-p-optin' });
    optin.checked = d.optin === true || d.waOptin === 'sim';
    const av = avatar(d.name, d.avatarMediaId, 'xl');
    const fileIn = el('input', { type: 'file', accept: 'image/jpeg,image/png', tabindex: '-1' });
    fileIn.hidden = true;
    const change = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, ico('pencil', 16), 'Trocar foto');
    const remove = d.avatarMediaId ? el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Remover foto') : null;
    let newAvatar;
    change.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0];
      fileIn.value = '';
      if (!f) return;
      try {
        const up = await host.upload(f, { mime: f.type, filename: f.name, purpose: 'avatar' });
        newAvatar = up.id;
        av.textContent = '';
        av.style.backgroundImage = `url("${URL.createObjectURL(f)}")`;
        av.classList.add('has-img');
      } catch (err) { toast(err.message); }
    });
    remove?.addEventListener('click', () => { newAvatar = null; av.style.backgroundImage = ''; av.classList.remove('has-img'); av.textContent = initials(name.value); });
    const saveBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Salvar');
    const cancel = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Fechar');
    const m = modal({
      title: 'Perfil do contato',
      body: [
        el('div', { class: 'wi-prof-top' }, av, el('div', { class: 'wi-prof-actions' }, change, remove, fileIn), el('p', { class: 'fine muted' }, 'O WhatsApp não entrega a foto do contato por aqui: esta foto e as observações ficam só no seu painel.')),
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'wi-p-name' }, 'Nome'), name),
        el('div', { class: 'field' }, el('span', { class: 'label' }, 'WhatsApp'), el('p', { class: 'wi-phone' }, d.phone)),
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'wi-p-notes' }, 'Observações'), notes),
        d.contactId || d.deliveryId ? el('p', { class: 'fine muted' }, OPTIN[d.waOptin] ?? '') : el('div', { class: 'check' }, optin, el('label', { for: 'wi-p-optin' }, 'Esta pessoa me autorizou a receber mensagens por WhatsApp.')),
      ],
      foot: [cancel, saveBtn],
    });
    cancel.addEventListener('click', m.close);
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        const body = { name: name.value.trim() || undefined, notes: notes.value.trim() };
        if (newAvatar !== undefined) body.avatarMediaId = newAvatar;
        if (!(d.contactId || d.deliveryId)) body.optin = optin.checked;
        await host.call('PATCH', `/threads/${d.id}/profile`, body);
        toast('Perfil salvo.');
        m.close();
        await openThread(d.id);
        paintList();
      } catch (err) { saveBtn.disabled = false; toast(err.message); }
    });
  }

  // ---------------------------------------------------------------------------------------------- partida e atualização
  (async () => {
    try {
      await paintList();
      if (start.contact || start.delivery) {
        const r = await host.call('POST', '/start', start.contact ? { contactId: start.contact } : { deliveryId: start.delivery });
        await paintList();
        await openThread(r.threadId);
      } else if (start.thread) await openThread(start.thread);
      else if (start.prefill) newConversation(start.prefill);
    } catch (e) { if (!e.silent) toast(e.message); }
  })();

  // Atualiza a cada 15 s sem apagar o que a pessoa está digitando: a conversa aberta só redesenha as mensagens se algo mudou.
  timer = window.setInterval(async () => {
    if (!root.isConnected) return stop();
    if (st.rec) return;
    try {
      await paintList();
      if (st.current) await openThread(st.current, { silent: true });
    } catch { /* sem rede agora: tenta de novo no próximo ciclo */ }
  }, 15_000);

  return { node: root, stop };
}
