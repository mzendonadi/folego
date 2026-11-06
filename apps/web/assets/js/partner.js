// Portal do parceiro (#/parceiros): "Euro Multiplan & Fôlego". Login, navegação e as cinco áreas de trabalho.
// Sem link público na página: o parceiro recebe o endereço e a senha do Fôlego.
import { el, icon, toast } from './dom.js';
import { viewPainel, viewFolego, viewBase, viewContratos } from './partner-views.js';
import { viewImportar } from './partner-import.js';
import { viewWhatsapp } from './partner-wa.js';
import { withEye } from './pw-eye.js';

const TABS = [
  ['painel', 'Painel', 'chart'],
  ['base', 'Minha base', 'list'],
  ['folego', 'Contatos do Fôlego', 'check'],
  ['whatsapp', 'WhatsApp', 'chat'],
  ['contratos', 'Contratos', 'card'],
  ['importar', 'Importar planilha', 'plus'],
];
const VIEWS = { painel: viewPainel, folego: viewFolego, whatsapp: viewWhatsapp, base: viewBase, contratos: viewContratos, importar: viewImportar };

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
    const forgotLink = el('p', { class: 'fine' }, (() => { const b = el('button', { class: 'link', type: 'button' }, 'Esqueci minha senha'); b.addEventListener('click', () => drawForgot(email.value.trim())); return b; })());
    const form = el(
      'form', { class: 'pt-login-form' },
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-email' }, 'E-mail'), email),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-pass' }, 'Senha'), withEye(pass)),
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
        forgotLink,
        el('p', { class: 'fine muted' }, 'Acesso só para parceiros do Fôlego.')),
    ));
  }

  /** "Esqueci minha senha": código de 6 dígitos no e-mail e senha nova. Depois volta ao login. */
  function drawForgot(prefill = '') {
    const email = el('input', { class: 'input', id: 'pt-f-email', type: 'email', autocomplete: 'username', required: true, value: prefill });
    const ask = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Enviar código para o meu e-mail');
    const hint = el('p', { class: 'fine', role: 'status', 'aria-live': 'polite' });
    const code = el('input', { class: 'input', id: 'pt-f-code', type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code', required: true });
    const p1 = el('input', { class: 'input', id: 'pt-f-p1', type: 'password', autocomplete: 'new-password', minlength: '12', required: true });
    const p2 = el('input', { class: 'input', id: 'pt-f-p2', type: 'password', autocomplete: 'new-password', minlength: '12', required: true });
    const save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Definir senha nova');
    const back = el('button', { class: 'link', type: 'button' }, 'Voltar ao login');
    back.addEventListener('click', () => drawLogin());
    ask.addEventListener('click', async () => {
      if (!email.value.includes('@')) return toast('Informe o e-mail.');
      ask.disabled = true;
      try {
        const out = await call('POST', '/partner/forgot', { email: email.value.trim() });
        hint.textContent = out?.devCode ? `Ambiente de desenvolvimento: código ${out.devCode}` : 'Se este e-mail tem acesso ao portal, o código chegou. Ele vale por 10 minutos.';
        code.focus();
      } catch (err) {
        toast(err.message);
      }
      ask.disabled = false;
    });
    const form = el('form', { class: 'pt-login-form' },
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-f-email' }, 'E-mail de acesso'), email),
      ask, hint,
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-f-code' }, 'Código recebido por e-mail'), code),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-f-p1' }, 'Senha nova'), withEye(p1), el('span', { class: 'fine' }, 'Mínimo de 12 caracteres, com letras e números. Evite o seu e-mail e senhas óbvias.')),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-f-p2' }, 'Repita a senha'), withEye(p2)),
      save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (p1.value !== p2.value) return toast('As duas senhas não são iguais.');
      save.disabled = true;
      try {
        await call('POST', '/partner/reset', { email: email.value.trim(), code: code.value.trim(), password: p1.value });
        drawLogin('Senha redefinida. Entre com a senha nova.');
      } catch (err) {
        save.disabled = false;
        toast(err.message);
      }
    });
    root.replaceChildren(el('section', { class: 'pt-login' },
      el('div', { class: 'pt-login-card' },
        el('p', { class: 'pt-kicker' }, 'Portal do parceiro'),
        el('h1', { class: 'pt-login-title' }, 'Redefinir a senha'),
        el('p', { class: 'fine muted' }, 'Enviamos um código para o e-mail de acesso. Ele confirma que a caixa é sua.'),
        form,
        el('p', { class: 'fine' }, back))));
    email.focus();
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
    // `raw`: chamada sem JSON (envio de arquivo e download de mídia), com o mesmo login do portal. Devolve a Response.
    const raw = (method, path, headers = {}, body) => fetch(`/api${path}`, { method, headers: { 'x-folego': '1', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });
    const ctx = { call, raw, profile, toast, go: (t, opts) => show(t, opts) };
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
