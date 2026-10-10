// Chatbot da FôlIA (landing e Prumo): botão flutuante + janela de conversa.
// Antes de conversar a pessoa informa celular com DDD e e-mail (obrigatórios) e aceita o contato: é o que permite à equipe retomar a conversa.
// A conversa fica no servidor (criptografada); aqui só guardamos, na aba, o token que identifica a conversa por 24 h.
import { API_BASE } from '../config.js';
import { el, icon, toast, prefersReducedMotion } from './dom.js';
import { turnstileHeaders } from './turnstile.js';

const KEY = 'folego:chat';
const SUGGESTIONS = ['Quero organizar minhas dívidas', 'Quanto custa?', 'Como funciona o Prumo?'];

let siteKeyP = null;
const turnstileKey = () => {
  siteKeyP ??= fetch(`${API_BASE}/features`, { credentials: 'same-origin', headers: { 'x-folego': '1' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => j?.turnstileSiteKey ?? null)
    .catch(() => null);
  return siteKeyP;
};

async function call(method, path, { body, token, guard } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'x-folego': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(guard ? await turnstileHeaders(await turnstileKey()) : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(json?.message ?? 'Não consegui agora. Tente de novo em instantes.'), { status: res.status, code: json?.error });
  return json;
}

const store = {
  get() {
    try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; }
  },
  set(v) {
    try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch { /* sem armazenamento: vale só enquanto a janela está aberta */ }
  },
};

/** Marca do Fôlego: anel aberto (o "fôlego") e um ponto no centro. */
function mark(size = 28) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<circle cx="16" cy="16" r="10.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-dasharray="52 14" transform="rotate(-62 16 16)"/><circle cx="16" cy="16" r="2.6" fill="currentColor"/>';
  return svg;
}

const formatPhone = (raw) => {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
};

export function initChat() {
  if (!API_BASE || document.querySelector('.fl-chat')) return; // sem servidor (modo demonstração) não há chat
  let token = store.get();
  let started = false;
  let busy = false;

  const fab = el('button', { class: 'fl-chat-fab', type: 'button', 'aria-label': 'Abrir o chat com a FôlIA', 'aria-expanded': 'false', 'aria-controls': 'fl-chat-panel' }, mark(30), el('span', { class: 'fl-chat-fab-text' }, 'Fale com a FôlIA'));
  const log = el('div', { class: 'fl-chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversa com a FôlIA' });
  const body = el('div', { class: 'fl-chat-body' });
  const close = el('button', { class: 'fl-chat-close', type: 'button', 'aria-label': 'Fechar o chat' }, icon('x'));
  const head = el('header', { class: 'fl-chat-head' }, el('span', { class: 'fl-chat-avatar' }, mark(26)), el('div', { class: 'fl-chat-who' }, el('strong', {}, 'FôlIA'), el('span', {}, 'Assistente virtual do Fôlego')), close);
  const panel = el('section', { class: 'fl-chat-panel', id: 'fl-chat-panel', role: 'dialog', 'aria-label': 'Chat com a FôlIA', hidden: true }, head, body);
  const root = el('div', { class: 'fl-chat' }, panel, fab);
  document.body.append(root);

  const bubble = (role, text) => el('div', { class: `fl-msg fl-msg-${role === 'user' ? 'me' : 'bot'}` }, el('p', {}, text));
  const scrollDown = () => { log.scrollTop = log.scrollHeight; };

  function drawChat(messages) {
    started = true;
    const input = el('textarea', { class: 'fl-chat-input', rows: '1', maxlength: '800', placeholder: 'Escreva sua mensagem', 'aria-label': 'Sua mensagem' });
    const send = el('button', { class: 'fl-chat-send', type: 'submit', 'aria-label': 'Enviar mensagem' }, icon('arrow-right'));
    const form = el('form', { class: 'fl-chat-form' }, input, send);
    const chips = el('div', { class: 'fl-chat-chips' });
    log.replaceChildren(...messages.filter((m) => m.role !== 'team').map((m) => bubble(m.role, m.text)));
    if (messages.length <= 2) {
      for (const s of SUGGESTIONS) {
        const c = el('button', { class: 'fl-chip', type: 'button' }, s);
        c.addEventListener('click', () => submit(s));
        chips.append(c);
      }
    }
    body.replaceChildren(log, chips, form, el('p', { class: 'fl-chat-note' }, 'Assistente virtual. Não substitui orientação jurídica ou financeira personalizada.'));
    scrollDown();

    async function submit(text) {
      text = text.trim();
      if (!text || busy) return;
      busy = true;
      chips.remove();
      input.value = '';
      input.style.height = '';
      send.disabled = true;
      log.append(bubble('user', text));
      const typing = el('div', { class: 'fl-msg fl-msg-bot fl-typing', role: 'status', 'aria-label': 'A FôlIA está escrevendo' }, el('span', {}), el('span', {}), el('span', {}));
      log.append(typing);
      scrollDown();
      try {
        const out = await call('POST', '/chat/message', { body: { text }, token });
        typing.replaceWith(bubble('assistant', out.reply.text));
      } catch (e) {
        typing.remove();
        if (e.status === 401) {
          store.set('');
          token = '';
          toast('Sua conversa expirou. Informe seus dados para continuar.');
          drawForm();
          return;
        }
        input.value = text;
        toast(e.message);
      } finally {
        busy = false;
        send.disabled = false;
        scrollDown();
        input.focus();
      }
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input.value); }
    });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 110)}px`; });
    input.focus();
  }

  function drawForm() {
    started = false;
    const name = el('input', { class: 'input', id: 'fl-c-nome', type: 'text', autocomplete: 'given-name', maxlength: '80', placeholder: 'Como podemos te chamar? (opcional)' });
    const phone = el('input', { class: 'input', id: 'fl-c-tel', type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', maxlength: '16', placeholder: '(11) 91234-5678', required: true });
    const email = el('input', { class: 'input', id: 'fl-c-email', type: 'email', autocomplete: 'email', maxlength: '200', placeholder: 'voce@email.com', required: true });
    const consent = el('input', { type: 'checkbox', id: 'fl-c-ok', required: true });
    const trap = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true', class: 'ct-trap' });
    const go = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Começar a conversa');
    const field = (label, input, hint) => el('div', { class: 'field' }, el('label', { class: 'label', for: input.id }, label), input, hint ? el('span', { class: 'fine' }, hint) : null);
    phone.addEventListener('input', () => { phone.value = formatPhone(phone.value); });
    const form = el('form', { class: 'fl-chat-start', novalidate: true },
      el('h2', {}, 'Oi! Eu sou a FôlIA.'),
      el('p', { class: 'fl-chat-lead' }, 'Tiro dúvidas, indico o melhor caminho e deixo a nossa equipe pronta para te ajudar. Para começar, deixe seus dados de contato.'),
      field('Nome', name),
      field('Celular com DDD', phone, 'Só celular, com DDD.'),
      field('E-mail', email),
      el('label', { class: 'fl-chat-consent' }, consent, el('span', {}, 'Aceito que o Fôlego entre em contato pelo celular e e-mail informados. Posso pedir para parar a qualquer momento.')),
      trap, go,
      el('p', { class: 'fl-chat-note' }, 'Não pedimos CPF, senha nem dados de cartão.'));
    body.replaceChildren(form);
    name.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const digits = phone.value.replace(/\D/g, '');
      if (digits.length !== 11 || digits[2] !== '9') return toast('Informe um celular com DDD, por exemplo (11) 91234-5678.');
      if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return toast('Confira o e-mail para podermos falar com você.');
      if (!consent.checked) return toast('Marque a autorização de contato para continuar.');
      go.disabled = true;
      go.textContent = 'Abrindo…';
      try {
        const utm = {};
        for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
          const v = new URLSearchParams(location.search).get(k);
          if (v) utm[k] = v.slice(0, 160);
        }
        const out = await call('POST', '/chat/start', {
          guard: true,
          body: { origin: document.body.dataset.route === 'account' ? 'prumo' : 'landing', ...(name.value.trim() ? { name: name.value.trim() } : {}), phone: phone.value, email: email.value.trim(), consent: true, ...(Object.keys(utm).length ? { utm } : {}), website: trap.value },
        });
        if (!out.token) throw new Error('Não consegui abrir a conversa agora. Tente de novo.');
        token = out.token;
        store.set(token);
        drawChat(out.messages?.length ? out.messages : [{ role: 'assistant', text: out.greeting }]);
      } catch (error) {
        go.disabled = false;
        go.textContent = 'Começar a conversa';
        toast(error.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' : error.message);
      }
    });
  }

  async function openPanel() {
    panel.hidden = false;
    root.classList.add('is-open');
    fab.setAttribute('aria-expanded', 'true');
    fab.setAttribute('aria-label', 'Fechar o chat com a FôlIA');
    if (started) return;
    if (token) {
      body.replaceChildren(el('p', { class: 'fl-chat-wait', role: 'status' }, 'Retomando a conversa…'));
      try {
        const h = await call('GET', '/chat/history', { token });
        return drawChat(h.messages);
      } catch {
        store.set('');
        token = '';
      }
    }
    drawForm();
  }
  function closePanel() {
    panel.hidden = true;
    root.classList.remove('is-open');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-label', 'Abrir o chat com a FôlIA');
  }
  fab.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
  close.addEventListener('click', () => { closePanel(); fab.focus(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { closePanel(); fab.focus(); }
  });
  // Um convite discreto, uma vez por visita: o botão se abre num rótulo por alguns segundos e volta a ser só o ícone.
  if (!prefersReducedMotion()) {
    let seen = false;
    try { seen = sessionStorage.getItem('folego:chat-hint') === '1'; } catch { /* ignora */ }
    if (!seen) {
      setTimeout(() => {
        if (panel.hidden) { fab.classList.add('is-hint'); setTimeout(() => fab.classList.remove('is-hint'), 6000); }
        try { sessionStorage.setItem('folego:chat-hint', '1'); } catch { /* ignora */ }
      }, 9000);
    }
  }
}
