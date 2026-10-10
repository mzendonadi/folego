// Sino de notificações do backoffice (canto superior direito do cabeçalho).
// Balança e mostra o contador enquanto houver alerta não visto; ao abrir a lista, os alertas passam a "vistos" e o sino volta ao normal.
// Se um alerta piorar (mais cancelamentos, nova falha), o servidor devolve como não visto e o sino volta a chamar a atenção.
import { el, icon } from '../dom.js';
import { api } from './api.js';

const SEVERITY = { critica: ['Crítico', 'bad'], atencao: ['Atenção', 'warn'], info: ['Aviso', 'info'] };
const POLL_MS = 60_000;

export function createBell({ goto }) {
  let alerts = [];
  let unseen = 0;
  let open = false;
  let fresh = new Set();
  let timer = null;

  const count = el('span', { class: 'bo-bell-count', 'aria-hidden': 'true' });
  const btn = el('button', { class: 'bo-bell-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'bo-bell-panel' }, icon('bell', 'icon icon-lg'), count);
  const panel = el('div', { class: 'bo-bell-panel', id: 'bo-bell-panel', role: 'dialog', 'aria-label': 'Notificações do sistema', hidden: true });
  const root = el('div', { class: 'bo-bell' }, btn, panel);

  function paintButton() {
    btn.classList.toggle('is-ringing', unseen > 0);
    count.textContent = unseen > 9 ? '9+' : String(unseen || '');
    count.hidden = unseen === 0;
    btn.setAttribute('aria-label', unseen > 0 ? `Notificações: ${unseen} nova${unseen > 1 ? 's' : ''}` : alerts.length ? `Notificações: ${alerts.length} em acompanhamento, nenhuma nova` : 'Notificações: tudo em ordem');
  }

  function paintPanel() {
    const head = el('div', { class: 'bo-bell-head' }, el('strong', {}, 'Notificações'), el('span', { class: 'fine muted' }, alerts.length ? `${alerts.length} em acompanhamento` : 'Tudo em ordem'));
    const body = alerts.length
      ? el('ul', { class: 'bo-bell-list' }, ...alerts.map((a) => {
          const [label, tone] = SEVERITY[a.severity] ?? SEVERITY.info;
          const item = el('button', { class: `bo-bell-item bo-bell-${tone}`, type: 'button' },
            el('span', { class: 'bo-bell-dot', 'aria-hidden': 'true' }),
            el('span', { class: 'bo-bell-text' },
              el('span', { class: 'bo-bell-title' }, a.title, fresh.has(a.key) ? el('span', { class: 'bo-bell-new' }, 'novo') : null),
              el('span', { class: 'fine muted' }, a.detail)),
            el('span', { class: 'bo-bell-sev' }, label));
          item.addEventListener('click', () => {
            close();
            goto(a.route);
          });
          return el('li', {}, item);
        }))
      : el('p', { class: 'bo-bell-empty muted' }, 'Nenhuma irregularidade encontrada: o sistema está saudável e não há clientes ou contatos esperando.');
    panel.replaceChildren(head, body);
  }

  function apply(out) {
    alerts = out.alerts ?? [];
    unseen = out.unseen ?? 0;
    paintButton();
    if (open) paintPanel();
  }

  async function refresh() {
    try {
      apply(await api.alertas());
    } catch {
      /* sem rede ou sessão encerrada: o próprio painel trata o login; o sino só fica quieto */
    }
  }

  async function show() {
    await refresh();
    fresh = new Set(alerts.filter((a) => !a.seen).map((a) => a.key));
    open = true;
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    paintPanel();
    if (fresh.size) {
      // Abrir a lista é "ver": o sino volta ao normal, mas os itens novos ficam marcados enquanto a lista estiver aberta.
      try {
        const out = await api.alertasVistos();
        alerts = out.alerts ?? alerts;
        unseen = out.unseen ?? 0;
        paintButton();
      } catch {
        /* tenta de novo na próxima abertura */
      }
    }
  }

  function close() {
    if (!open) return;
    open = false;
    fresh = new Set();
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', () => (open ? close() : show()));
  document.addEventListener('click', (e) => {
    if (open && e.target instanceof Node && !root.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') {
      close();
      btn.focus();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && timer) refresh();
  });

  paintButton();
  return {
    el: root,
    refresh,
    start() {
      if (timer) return;
      refresh();
      timer = setInterval(() => !document.hidden && refresh(), POLL_MS);
    },
    stop() {
      clearInterval(timer);
      timer = null;
      close();
      alerts = [];
      unseen = 0;
      paintButton();
    },
  };
}
