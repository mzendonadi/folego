// Portal do parceiro (#/parceiros): "Euro Multiplan & Fôlego". Login, navegação e as cinco áreas de trabalho.
// Sem link público na página: o parceiro recebe o endereço e a senha do Fôlego.
import { el, icon, toast } from './dom.js';
import { viewPainel, viewFolego, viewBase, viewContratos } from './partner-views.js';
import { viewImportar } from './partner-import.js';

const TABS = [
  ['painel', 'Painel', 'chart'],
  ['folego', 'Contatos do Fôlego', 'chat'],
  ['base', 'Minha base', 'list'],
  ['contratos', 'Contratos', 'card'],
  ['importar', 'Importar planilha', 'plus'],
];
const VIEWS = { painel: viewPainel, folego: viewFolego, base: viewBase, contratos: viewContratos, importar: viewImportar };

export function renderPartner(root) {
  let token = '';
  try {
    token = sessionStorage.getItem('folego:parceiro') || '';
  } catch {
    token = '';
  }
  const keep = (value) => {
    token = value;
    try {
      if (value) sessionStorage.setItem('folego:parceiro', value);
      else sessionStorage.removeItem('folego:parceiro');
    } catch {
      /* sem armazenamento: o login vale só nesta tela */
    }
  };
  const call = async (method, path, body) => {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { 'x-folego': '1', ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (res.status === 401 && token) {
      keep('');
      drawLogin('Sua sessão terminou. Entre de novo.');
      throw Object.assign(new Error('sessão'), { status: 401, silent: true });
    }
    // Sem JSON na resposta (ex.: 413 do nginx, 502 do servidor), mostra o código para dar para diagnosticar.
    if (!res.ok) throw Object.assign(new Error(json?.message ?? `Não consegui agora (erro ${res.status}).`), { status: res.status });
    return json;
  };

  const brandName = (profile) => (profile?.tradeName || profile?.legalName || 'Parceiro').toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\s+(Intermediacoes|Intermediações|Me|Ltda|Eireli)$/, '');
  const lockup = (profile) => el('div', { class: 'pt-lockup' }, el('span', { class: 'pt-lockup-name' }, brandName(profile)), el('span', { class: 'pt-lockup-amp', 'aria-hidden': 'true' }, '&'), el('span', { class: 'pt-lockup-folego' }, 'fôlego'));

  function drawLogin(message = '') {
    const email = el('input', { class: 'input', id: 'pt-email', type: 'email', autocomplete: 'username', required: true });
    const pass = el('input', { class: 'input', id: 'pt-pass', type: 'password', autocomplete: 'current-password', required: true });
    const go = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Entrar');
    const form = el(
      'form', { class: 'pt-login-form' },
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-email' }, 'E-mail'), email),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-pass' }, 'Senha'), pass),
      go,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      go.disabled = true;
      try {
        const out = await call('POST', '/partner/login', { email: email.value, password: pass.value });
        keep(out.token);
        await drawShell();
      } catch {
        go.disabled = false;
        toast('E-mail ou senha incorretos.');
      }
    });
    root.replaceChildren(el('section', { class: 'pt-login' },
      el('div', { class: 'pt-login-card' },
        el('p', { class: 'pt-kicker' }, 'Portal do parceiro'),
        el('h1', { class: 'pt-login-title' }, 'Seus contatos, contratos e comissões num só lugar.'),
        message ? el('p', { class: 'note note-amber' }, icon('info'), el('span', {}, message)) : null,
        form,
        el('p', { class: 'fine muted' }, 'Acesso só para parceiros do Fôlego. Esqueceu a senha? Peça uma nova ao Fôlego.')),
    ));
  }

  async function drawShell(tab = 'painel') {
    let profile;
    try {
      profile = await call('GET', '/partner/me');
    } catch {
      return;
    }
    const stage = el('div', { class: 'pt-stage', 'aria-live': 'polite' });
    const nav = el('nav', { class: 'pt-nav', 'aria-label': 'Áreas do portal' });
    const side = el('aside', { class: 'pt-side', id: 'pt-side' });
    const ctx = { call, profile, toast, go: (t, opts) => show(t, opts) };
    const show = async (id, opts = {}) => {
      side.classList.remove('is-open');
      nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === id ? 'page' : 'false'));
      stage.replaceChildren(el('p', { class: 'muted', role: 'status' }, 'Carregando…'));
      try {
        stage.replaceChildren(await VIEWS[id]({ ...ctx, opts }));
      } catch (error) {
        if (!error.silent) stage.replaceChildren(el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, error.message || 'Não consegui carregar.')));
      }
      window.scrollTo({ top: 0 });
    };
    for (const [id, label, ic] of TABS) {
      const b = el('button', { class: 'pt-tab', type: 'button', 'data-tab': id }, icon(ic), el('span', {}, label));
      b.addEventListener('click', () => show(id));
      nav.append(b);
    }
    const out = el('button', { class: 'btn btn-secondary btn-sm pt-exit', type: 'button' }, 'Sair');
    out.addEventListener('click', () => {
      keep('');
      drawLogin();
    });
    // Mesmo desenho do backoffice: barra lateral clara com a marca, menu à esquerda, conteúdo em cartões. No celular a barra vira gaveta.
    const burger = el('button', { class: 'btn btn-secondary btn-sm pt-burger', type: 'button', 'aria-label': 'Abrir o menu', 'aria-controls': 'pt-side', 'aria-expanded': 'false' }, icon('menu'));
    burger.addEventListener('click', () => {
      const open = side.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', String(open));
    });
    side.append(
      el('div', { class: 'pt-brand' }, lockup(profile), el('small', {}, 'Parceiro')),
      nav,
      el('div', { class: 'pt-me' }, el('strong', {}, profile.tradeName ? brandName(profile) : profile.legalName), el('span', { class: 'fine muted' }, 'Operações em parceria com o Fôlego'), out),
    );
    root.replaceChildren(el('div', { class: 'pt-shell' },
      side,
      el('div', { class: 'pt-main' },
        el('div', { class: 'pt-top' }, burger, lockup(profile)),
        el('div', { class: 'pt-content' }, stage)),
    ));
    // No celular, tocar no conteúdo fecha o menu aberto.
    root.querySelector('.pt-content').addEventListener('click', () => {
      side.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
    });
    await show(tab);
  }

  return token ? drawShell() : drawLogin();
}
