// Portal do parceiro (#/parceiros): login e lista dos leads entregues a ele. Sem link público na página.
import { el, toast } from './dom.js';
import { brl } from './format.js';

const STATUS = { queued: 'na fila', delivered: 'novo', failed: 'falha no envio', contacted: 'contatado', converted: 'convertido', rejected: 'descartado' };

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

  const card = (...c) => el('section', { class: 'card d-section' }, ...c);
  const call = async (method, path, body) => {
    const res = await fetch(`/api${path}`, {
      method,
      headers: { 'x-folego': '1', ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(json?.message ?? 'erro'), { status: res.status });
    return json;
  };

  function drawLogin() {
    const email = el('input', { class: 'input', id: 'pt-email', type: 'email', autocomplete: 'username', required: true });
    const pass = el('input', { class: 'input', id: 'pt-pass', type: 'password', autocomplete: 'current-password', required: true });
    const form = el(
      'form', { class: 'tool-form' },
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-email' }, 'E-mail'), email),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'pt-pass' }, 'Senha'), pass),
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Entrar'),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const out = await call('POST', '/partner/login', { email: email.value, password: pass.value });
        keep(out.token);
        await drawLeads(out.partnerName);
      } catch {
        toast('E-mail ou senha incorretos.');
      }
    });
    root.replaceChildren(card(el('h2', {}, 'Entrar'), form));
  }

  async function drawLeads(name = '') {
    let leads;
    try {
      leads = (await call('GET', '/partner/leads')).leads;
    } catch {
      keep('');
      return drawLogin();
    }
    const rows = leads.map((l) => {
      const actions = ['contacted', 'converted', 'rejected']
        .filter((s) => s !== l.status && ['delivered', 'contacted'].includes(l.status))
        .map((s) => {
          const b = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, { contacted: 'Contatei', converted: 'Converteu', rejected: 'Descartar' }[s]);
          b.addEventListener('click', async () => {
            await call('POST', `/partner/leads/${l.id}/status`, { status: s }).catch(() => toast('Não consegui atualizar.'));
            drawLeads(name);
          });
          return b;
        });
      return el(
        'article', { class: 'script' },
        el('h3', {}, l.revoked ? 'Titular revogou a autorização' : (l.name ?? 'Aguardando entrega')),
        el('p', { class: 'muted' }, `${STATUS[l.status] ?? l.status} · ${l.category} · ${new Date(l.createdAt).toLocaleDateString('pt-BR')} · ${brl(l.priceCents)}`),
        l.revoked
          ? el('p', { class: 'note note-amber' }, 'Apague os dados deste titular dos seus sistemas.')
          : el('p', {}, [l.phone, l.email, l.uf && `UF ${l.uf}`, l.incomeBand && `renda ${l.incomeBand}`, l.debtBand && `dívidas ${l.debtBand}`].filter(Boolean).join(' · ')),
        el('div', { class: 'button-row' }, ...actions),
      );
    });
    const out = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Sair');
    out.addEventListener('click', () => {
      keep('');
      drawLogin();
    });
    root.replaceChildren(card(el('h2', {}, name ? `Leads de ${name}` : 'Seus leads'), leads.length === 0 ? el('p', {}, 'Nenhum lead entregue ainda.') : el('div', { class: 'ideas' }, ...rows), out));
  }

  return token ? drawLeads() : drawLogin();
}
