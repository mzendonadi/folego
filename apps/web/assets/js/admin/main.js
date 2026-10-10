// Backoffice do Fôlego (folego.online/gestao): entrada por código no e-mail, menu por permissão e uma tela por assunto.
import { el, icon, toast } from '../dom.js';
import { api, ApiError } from './api.js';
import { loading, errorBox, drawer } from './ui.js';
import { createBell } from './bell.js';

const MENU = [
  { id: 'painel', label: 'Painel', icon: 'chart', perm: ['dashboard'], load: () => import('./screens/dashboard.js').then((m) => m.dashboardScreen) },
  { id: 'clientes', label: 'Clientes', icon: 'users', perm: ['clientes'], load: () => import('./screens/clientes.js').then((m) => m.clientesScreen) },
  { id: 'assinaturas', label: 'Assinaturas', icon: 'wallet', perm: ['assinaturas'], load: () => import('./screens/assinaturas.js').then((m) => m.assinaturasScreen) },
  { id: 'acessos', label: 'Acessos e prazos', icon: 'clock', perm: ['assinaturas'], load: () => import('./screens/acessos.js').then((m) => m.acessosScreen) },
  { id: 'contas-teste', label: 'Contas de teste', icon: 'users', perm: ['assinaturas'], load: () => import('./screens/contas-teste.js').then((m) => m.contasTesteScreen) },
  { id: 'jornada', label: 'Jornada e funil', icon: 'route', perm: ['jornada', 'dashboard'], load: () => import('./screens/jornada.js').then((m) => m.jornadaScreen) },
  { id: 'parcerias', label: 'Parcerias', icon: 'link', perm: ['parcerias'], load: () => import('./screens/parcerias.js').then((m) => m.parceriasScreen) },
  { id: 'chatbot', label: 'Chatbot', icon: 'chat', perm: ['chatbot'], load: () => import('./screens/chatbot.js').then((m) => m.chatbotScreen) },
  { id: 'produtos', label: 'Produtos e preços', icon: 'tag', perm: ['precos'], load: () => import('./screens/produtos.js').then((m) => m.produtosScreen) },
  { id: 'indicacoes', label: 'Indicações', icon: 'users', perm: ['marketing', 'assinaturas'], load: () => import('./screens/indicacoes.js').then((m) => m.indicacoesScreen) },
  { id: 'marketing', label: 'Marketing', icon: 'megaphone', perm: ['marketing'], load: () => import('./screens/marketing.js').then((m) => m.marketingScreen) },
  { id: 'config', label: 'Configurações', icon: 'gear', perm: ['config_site', 'config_usuarios', 'auditoria'], load: () => import('./screens/configuracoes.js').then((m) => m.configScreen) },
];

const root = document.getElementById('bo-root');
const state = { days: 30 };
let me = null;

// ---------- entrada: senha → código por e-mail (duas etapas) ----------
const PW_HINT = 'Mínimo de 12 caracteres, com letras e números. Evite o seu e-mail e senhas óbvias.';

function loginCard(title, lead, message, ...children) {
  return el('main', { class: 'bo-login' },
    el('div', { class: 'bo-login-card' },
      el('div', { class: 'bo-brand' }, el('img', { src: '/assets/favicon.svg', alt: '', width: '32', height: '32' }), el('span', {}, 'fôlego'), el('small', {}, 'backoffice')),
      el('h1', {}, title),
      lead ? el('p', { class: 'muted' }, lead) : null,
      message ? el('p', { class: 'note note-amber', role: 'alert' }, icon('alert'), el('span', {}, message)) : null,
      ...children));
}

function drawLogin(message = '') {
  bell.stop();
  const email = el('input', { class: 'input', id: 'bo-email', type: 'email', autocomplete: 'username', required: true });
  const password = el('input', { class: 'input', id: 'bo-password', type: 'password', autocomplete: 'current-password', required: true });
  const send = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Continuar');
  const first = el('button', { class: 'link', type: 'button' }, 'Primeiro acesso ou esqueci a senha');
  first.addEventListener('click', () => drawSetup(email.value.trim().toLowerCase()));
  const form = el('form', { class: 'tool-form' },
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'bo-email' }, 'E-mail'), email),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'bo-password' }, 'Senha'), password),
    send, el('p', { class: 'fine' }, first));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    send.disabled = true;
    try {
      await api.loginPassword(email.value.trim().toLowerCase(), password.value);
      boot();
    } catch (err) {
      send.disabled = false;
      password.value = '';
      password.focus();
      toast(err.message);
    }
  });
  root.replaceChildren(loginCard('Entrar', 'Área restrita. Entre com e-mail e senha. No primeiro acesso, ou se esqueceu a senha, use o link abaixo: confirmamos seu e-mail por um código.', message, form));
  email.focus();
}

function drawSetup(prefill = '') {
  const email = el('input', { class: 'input', id: 'bo-s-email', type: 'email', autocomplete: 'username', required: true, value: prefill });
  const ask = el('button', { class: 'btn btn-secondary btn-block', type: 'button' }, 'Enviar código para o meu e-mail');
  const code = el('input', { class: 'input', id: 'bo-s-code', type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code' });
  const p1 = el('input', { class: 'input', id: 'bo-s-p1', type: 'password', autocomplete: 'new-password', minlength: '12' });
  const p2 = el('input', { class: 'input', id: 'bo-s-p2', type: 'password', autocomplete: 'new-password', minlength: '12' });
  const save = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Definir senha');
  const back = el('button', { class: 'link', type: 'button' }, 'Voltar ao login');
  back.addEventListener('click', () => drawLogin());
  const hint = el('p', { class: 'fine', role: 'status' });
  ask.addEventListener('click', async () => {
    if (!email.value.includes('@')) return toast('Informe o e-mail.');
    ask.disabled = true;
    try {
      const out = await api.setupCode(email.value.trim().toLowerCase());
      hint.textContent = out.devCode ? `Ambiente de desenvolvimento: código ${out.devCode}` : 'Se este e-mail tem acesso e ainda não tem senha (ou o dono liberou a redefinição), o código chegou. Vale por 10 minutos.';
      code.focus();
    } catch (err) {
      toast(err.message);
    }
    ask.disabled = false;
  });
  const form = el('form', { class: 'tool-form' },
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'bo-s-email' }, 'E-mail'), email), ask, hint,
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'bo-s-code' }, 'Código recebido por e-mail'), code),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'bo-s-p1' }, 'Senha nova'), p1, el('span', { class: 'fine' }, PW_HINT)),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'bo-s-p2' }, 'Repita a senha'), p2),
    save, el('p', { class: 'fine' }, back));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (p1.value !== p2.value) return toast('As duas senhas não são iguais.');
    save.disabled = true;
    try {
      await api.setup(email.value.trim().toLowerCase(), code.value.trim(), p1.value);
      drawLogin('');
      toast('Senha definida. Agora entre com ela.');
    } catch (err) {
      save.disabled = false;
      toast(err.message);
    }
  });
  root.replaceChildren(loginCard('Definir a senha', 'Primeiro acesso, ou o dono liberou a redefinição da sua senha. O código do e-mail confirma que a caixa é sua.', '', form));
  email.focus();
}

// ---------- casca ----------
const can = (section) => Boolean(me?.sections.find((s) => s.id === section)?.allowed);
const allowedMenu = () => MENU.filter((m) => m.perm.some(can));

function currentRoute() {
  const id = (location.pathname.startsWith('/gestao/') ? location.pathname.slice('/gestao/'.length).split('/')[0] : '') || allowedMenu()[0]?.id;
  return allowedMenu().find((m) => m.id === id) ?? allowedMenu()[0];
}

let navOpen = false;
// Um sino só para a sessão toda: a casca é redesenhada a cada troca de tela, o sino é movido para o novo cabeçalho.
const bell = createBell({
  goto: (id) => {
    if (!allowedMenu().some((m) => m.id === id)) return;
    history.pushState(null, '', `/gestao/${id}`);
    onRouteChange();
  },
});
function drawShell() {
  const route = currentRoute();
  if (!route) {
    root.replaceChildren(el('main', { class: 'bo-login' }, el('div', { class: 'bo-login-card' }, el('h1', {}, 'Sem áreas liberadas'), el('p', { class: 'muted' }, 'Seu acesso existe, mas nenhuma área foi liberada. Peça ao dono para ajustar as permissões.'), logoutButton())));
    return;
  }
  const links = allowedMenu().map((m) => el('a', { class: 'bo-nav-link', href: `/gestao/${m.id}`, 'aria-current': m.id === route.id ? 'page' : null }, icon(m.icon), el('span', {}, m.label)));
  const toggle = el('button', { class: 'btn btn-quiet btn-sm bo-burger', type: 'button', 'aria-label': 'Abrir menu', 'aria-expanded': String(navOpen) }, icon('menu'));
  const sidebar = el('aside', { class: `bo-side${navOpen ? ' is-open' : ''}`, 'aria-label': 'Menu do backoffice' },
    el('div', { class: 'bo-brand' }, el('img', { src: '/assets/favicon.svg', alt: '', width: '28', height: '28' }), el('span', {}, 'fôlego'), el('small', {}, 'backoffice')),
    el('nav', { class: 'bo-nav' }, ...links),
    el('div', { class: 'bo-me' }, el('strong', {}, me.user.name || me.user.email), el('span', { class: 'fine' }, `${me.roles.find((r) => r.id === me.user.role)?.label ?? me.user.role}${me.user.name ? ` · ${me.user.email}` : ''}`), passwordButton(), logoutButton()));
  toggle.addEventListener('click', () => {
    navOpen = !navOpen;
    sidebar.classList.toggle('is-open', navOpen);
    toggle.setAttribute('aria-expanded', String(navOpen));
  });
  const content = el('main', { class: 'bo-content', id: 'bo-content', tabindex: '-1' });
  root.replaceChildren(el('div', { class: 'bo-shell' }, sidebar, el('div', { class: 'bo-main' }, el('header', { class: 'bo-top' }, toggle, el('h1', { id: 'bo-title' }, route.label), bell.el), content)));
  bell.start();
  document.title = `${route.label} — Backoffice Fôlego`;
  renderScreen(route, content);
}

function passwordButton() {
  const b = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('lock'), 'Alterar senha');
  b.addEventListener('click', () => {
    const cur = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', 'aria-label': 'Senha atual' });
    const n1 = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '12', 'aria-label': 'Senha nova' });
    const n2 = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '12', 'aria-label': 'Repita a senha nova' });
    const save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Alterar senha');
    const form = el('form', { class: 'bo-form' }, el('p', { class: 'muted' }, 'As outras sessões abertas com a sua conta serão encerradas.'), el('div', { class: 'field' }, el('label', { class: 'label' }, 'Senha atual'), cur), el('div', { class: 'field' }, el('label', { class: 'label' }, 'Senha nova'), n1, el('span', { class: 'fine' }, PW_HINT)), el('div', { class: 'field' }, el('label', { class: 'label' }, 'Repita a senha nova'), n2), save);
    const dw = drawer('Alterar senha');
    dw.body.append(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (n1.value !== n2.value) return toast('As duas senhas novas não são iguais.');
      save.disabled = true;
      try {
        await api.changePassword(cur.value, n1.value);
        toast('Senha alterada.');
        dw.close();
      } catch (err) {
        save.disabled = false;
        toast(err.message);
      }
    });
  });
  return b;
}

function logoutButton() {
  const b = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('logout'), 'Sair');
  b.addEventListener('click', async () => {
    await api.logout().catch(() => {});
    bell.stop();
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

function onRouteChange() {
  if (!me) return;
  navOpen = false;
  drawShell();
  document.getElementById('bo-content')?.focus({ preventScroll: true });
}
// Endereço antigo (/gestao/#/clientes) vira /gestao/clientes.
const legacyBo = /^#\/([^/]+)/.exec(location.hash);
if (legacyBo) history.replaceState(null, '', `/gestao/${legacyBo[1]}`);
window.addEventListener('popstate', onRouteChange);
window.addEventListener('hashchange', onRouteChange);
document.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a.bo-nav-link') : null;
  if (!a || !me || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  history.pushState(null, '', a.getAttribute('href'));
  onRouteChange();
});

boot();
