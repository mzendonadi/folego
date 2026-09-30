// Backoffice do Fôlego (folego.online/gestao): entrada por código no e-mail, menu por permissão e uma tela por assunto.
import { el, icon, toast } from '../dom.js';
import { api, ApiError } from './api.js';
import { loading, errorBox } from './ui.js';

const MENU = [
  { id: 'painel', label: 'Painel', icon: 'chart', perm: ['dashboard'], load: () => import('./screens/dashboard.js').then((m) => m.dashboardScreen) },
  { id: 'clientes', label: 'Clientes', icon: 'users', perm: ['clientes'], load: () => import('./screens/clientes.js').then((m) => m.clientesScreen) },
  { id: 'assinaturas', label: 'Assinaturas', icon: 'wallet', perm: ['assinaturas'], load: () => import('./screens/assinaturas.js').then((m) => m.assinaturasScreen) },
  { id: 'jornada', label: 'Jornada e funil', icon: 'route', perm: ['jornada', 'dashboard'], load: () => import('./screens/jornada.js').then((m) => m.jornadaScreen) },
  { id: 'parcerias', label: 'Parcerias', icon: 'link', perm: ['parcerias'], load: () => import('./screens/parcerias.js').then((m) => m.parceriasScreen) },
  { id: 'produtos', label: 'Produtos e preços', icon: 'tag', perm: ['precos'], load: () => import('./screens/produtos.js').then((m) => m.produtosScreen) },
  { id: 'marketing', label: 'Marketing', icon: 'megaphone', perm: ['marketing'], load: () => import('./screens/marketing.js').then((m) => m.marketingScreen) },
  { id: 'config', label: 'Configurações', icon: 'gear', perm: ['config_site', 'config_usuarios', 'auditoria'], load: () => import('./screens/config.js').then((m) => m.configScreen) },
];

const root = document.getElementById('bo-root');
const state = { days: 30 };
let me = null;

// ---------- entrada ----------
function drawLogin(message = '') {
  const email = el('input', { class: 'input', id: 'bo-email', type: 'email', autocomplete: 'email', required: true });
  const send = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Enviar código');
  const box = el('div', {});
  const form = el('form', { class: 'tool-form' }, el('div', { class: 'field' }, el('label', { class: 'label', for: 'bo-email' }, 'E-mail de acesso'), email), send);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    send.disabled = true;
    try {
      const out = await api.requestCode(email.value.trim().toLowerCase());
      drawCode(email.value.trim().toLowerCase(), out.devCode);
      send.disabled = false;
    } catch (err) {
      send.disabled = false;
      toast(err.message);
    }
  });
  function drawCode(addr, devCode) {
    const code = el('input', { class: 'input', id: 'bo-code', type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code' });
    const btn = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Entrar');
    const f2 = el('form', { class: 'tool-form' }, el('p', { class: 'muted' }, `Se ${addr} tem acesso, o código chegou por e-mail. Vale por 10 minutos.`), devCode ? el('p', { class: 'fine' }, `Ambiente de desenvolvimento: código ${devCode}`) : null, el('div', { class: 'field' }, el('label', { class: 'label', for: 'bo-code' }, 'Código de 6 dígitos'), code), btn);
    f2.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        await api.login(addr, code.value.trim());
        boot();
      } catch (err) {
        btn.disabled = false;
        toast(err.message);
      }
    });
    box.replaceChildren(f2);
    code.focus();
  }
  root.replaceChildren(
    el('main', { class: 'bo-login' },
      el('div', { class: 'bo-login-card' },
        el('div', { class: 'bo-brand' }, el('img', { src: '/assets/favicon.svg', alt: '', width: '32', height: '32' }), el('span', {}, 'fôlego'), el('small', {}, 'backoffice')),
        el('h1', {}, 'Entrar'),
        el('p', { class: 'muted' }, 'Área restrita. Mandamos um código de 6 dígitos para o seu e-mail: não há senha.'),
        message ? el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, message)) : null,
        form, box)),
  );
  email.focus();
}

// ---------- casca ----------
const can = (section) => Boolean(me?.sections.find((s) => s.id === section)?.allowed);
const allowedMenu = () => MENU.filter((m) => m.perm.some(can));

function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '').split('/')[0] || allowedMenu()[0]?.id;
  return allowedMenu().find((m) => m.id === id) ?? allowedMenu()[0];
}

let navOpen = false;
function drawShell() {
  const route = currentRoute();
  if (!route) {
    root.replaceChildren(el('main', { class: 'bo-login' }, el('div', { class: 'bo-login-card' }, el('h1', {}, 'Sem áreas liberadas'), el('p', { class: 'muted' }, 'Seu acesso existe, mas nenhuma área foi liberada. Peça ao dono para ajustar as permissões.'), logoutButton())));
    return;
  }
  const links = allowedMenu().map((m) => el('a', { class: 'bo-nav-link', href: `#/${m.id}`, 'aria-current': m.id === route.id ? 'page' : null }, icon(m.icon), el('span', {}, m.label)));
  const toggle = el('button', { class: 'btn btn-quiet btn-sm bo-burger', type: 'button', 'aria-label': 'Abrir menu', 'aria-expanded': String(navOpen) }, icon('menu'));
  const sidebar = el('aside', { class: `bo-side${navOpen ? ' is-open' : ''}`, 'aria-label': 'Menu do backoffice' },
    el('div', { class: 'bo-brand' }, el('img', { src: '/assets/favicon.svg', alt: '', width: '28', height: '28' }), el('span', {}, 'fôlego'), el('small', {}, 'backoffice')),
    el('nav', { class: 'bo-nav' }, ...links),
    el('div', { class: 'bo-me' }, el('strong', {}, me.user.name || me.user.email), el('span', { class: 'fine' }, `${me.roles.find((r) => r.id === me.user.role)?.label ?? me.user.role}${me.user.name ? ` · ${me.user.email}` : ''}`), logoutButton()));
  toggle.addEventListener('click', () => {
    navOpen = !navOpen;
    sidebar.classList.toggle('is-open', navOpen);
    toggle.setAttribute('aria-expanded', String(navOpen));
  });
  const content = el('div', { class: 'bo-content', id: 'bo-content', tabindex: '-1' });
  root.replaceChildren(el('div', { class: 'bo-shell' }, sidebar, el('div', { class: 'bo-main' }, el('header', { class: 'bo-top' }, toggle, el('h1', { id: 'bo-title' }, route.label)), content)));
  document.title = `${route.label} — Backoffice Fôlego`;
  renderScreen(route, content);
}

function logoutButton() {
  const b = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('logout'), 'Sair');
  b.addEventListener('click', async () => {
    await api.logout().catch(() => {});
    me = null;
    drawLogin();
  });
  return b;
}

let renderToken = 0;
async function renderScreen(route, content) {
  const mine = ++renderToken;
  content.replaceChildren(loading());
  const ctx = {
    state,
    can,
    setDays: (d) => {
      state.days = d;
      renderScreen(route, content);
    },
    reload: () => renderScreen(route, content),
  };
  try {
    const screen = await route.load();
    const node = await screen(ctx);
    if (mine === renderToken) content.replaceChildren(node);
  } catch (err) {
    if (mine !== renderToken) return;
    if (err instanceof ApiError && err.status === 401) return drawLogin('Sua sessão terminou. Entre de novo.');
    console.error(err);
    content.replaceChildren(errorBox(err, () => renderScreen(route, content)));
  }
}

async function boot() {
  try {
    me = await api.me();
  } catch {
    return drawLogin();
  }
  drawShell();
}

window.addEventListener('hashchange', () => {
  if (!me) return;
  navOpen = false;
  drawShell();
  document.getElementById('bo-content')?.focus({ preventScroll: true });
});

boot();
