// Configurações: recursos do site e das assinaturas (valem na hora), usuários e permissões do backoffice, e auditoria.
import { api } from '../api.js';
import { el, icon, toast, dt, card, table, tabs, badge, field, dl, drawer, loading, errorBox } from '../ui.js';

const ROLE_LABEL = { owner: 'Dono', gestor: 'Gestor', financeiro: 'Financeiro', marketing: 'Marketing', suporte: 'Suporte' };
const ACTION = {
  admin_login: 'Entrou no backoffice', admin_product_update: 'Alterou um produto/preço', admin_config_update: 'Alterou configurações', admin_user_create: 'Criou usuário', admin_user_update: 'Alterou usuário',
  admin_subscription_extend: 'Estendeu assinatura', admin_subscription_set_plan: 'Definiu plano', admin_subscription_cancel: 'Alterou renovação', admin_reveal_contact: 'Viu contato de um cliente',
  admin_plan_create: 'Criou item de marketing', admin_plan_update: 'Editou item de marketing', admin_plan_delete: 'Apagou item de marketing',
};

function toggle(id, label, hint, checked, disabled = false) {
  const input = el('input', { type: 'checkbox', id, disabled });
  input.checked = checked;
  return { input, node: el('div', { class: 'bo-toggle' }, el('div', { class: 'check' }, input, el('label', { for: id }, label)), hint ? el('p', { class: 'fine' }, hint) : null) };
}

async function siteTab(ctx) {
  const { settings: s, environment: env } = await api.config();
  const subs = toggle('cf-subs', 'Assinaturas (conta por e-mail, Pix mensal)', env.emailConfigured ? 'Desligar esconde a área de conta para novos acessos; os dados e as assinaturas continuam guardados.' : 'Precisa do envio de e-mail configurado no servidor.', s.subscriptionsEnabled, !env.emailConfigured && !s.subscriptionsEnabled);
  const leads = toggle('cf-leads', 'Propostas de parceiros (leads)', 'Deixe desligado até a revisão jurídica (LGPD e superendividamento).', s.leadsEnabled);
  const ai = toggle('cf-ai', 'IA nas entregas (roteiros e plano de renda extra)', env.aiKeyConfigured ? 'Desligada, as entregas saem pelos modelos fixos, sem custo de IA.' : 'Não há chave da Anthropic configurada no servidor: mesmo ligada, sai o modelo fixo.', s.aiEnabled);
  const paused = toggle('cf-paused', 'Pausar as vendas', 'Ninguém consegue gerar Pix novo (assinantes e compradores veem um aviso). O resultado grátis continua funcionando.', s.salesPaused);
  const cap = el('input', { class: 'input input-sm', type: 'number', min: '0', max: '100000', value: String(s.aiMaxCallsPerDay), 'aria-label': 'Teto diário de chamadas à IA' });
  const remind = el('input', { class: 'input input-sm', type: 'number', min: '1', max: '15', value: String(s.reminderDaysBefore), 'aria-label': 'Dias de antecedência do lembrete' });
  const bannerOn = toggle('cf-banner', 'Mostrar um aviso no topo do site', 'Use para avisar de manutenção, promoção ou novidade.', Boolean(s.announcement));
  const bannerText = el('input', { class: 'input', type: 'text', maxlength: '240', value: s.announcement?.text ?? '', placeholder: 'Ex.: Estamos em manutenção rápida; volte em alguns minutos.', 'aria-label': 'Texto do aviso' });
  const bannerTone = el('select', { class: 'input input-sm', 'aria-label': 'Tipo do aviso' }, el('option', { value: 'info', selected: (s.announcement?.tone ?? 'info') === 'info' }, 'Informativo'), el('option', { value: 'warn', selected: s.announcement?.tone === 'warn' }, 'Atenção'));
  const save = el('button', { class: 'btn btn-primary', type: 'button' }, 'Salvar configurações');
  save.addEventListener('click', async () => {
    if (bannerOn.input.checked && !bannerText.value.trim()) return toast('Escreva o texto do aviso ou desligue-o.');
    save.disabled = true;
    try {
      await api.salvarConfig({
        subscriptionsEnabled: subs.input.checked, leadsEnabled: leads.input.checked, aiEnabled: ai.input.checked, salesPaused: paused.input.checked,
        aiMaxCallsPerDay: Number(cap.value) || 0, reminderDaysBefore: Number(remind.value) || 3,
        announcement: bannerOn.input.checked ? { text: bannerText.value.trim(), tone: bannerTone.value } : null,
      });
      toast('Configurações salvas. Valem agora.');
    } catch (e) {
      toast(e.message);
    }
    save.disabled = false;
  });
  return el(
    'div', { class: 'bo-stack' },
    card('Recursos do site', subs.node, leads.node, ai.node, paused.node),
    card('Aviso no site', bannerOn.node, el('div', { class: 'bo-actions' }, field('Texto', bannerText), field('Tipo', bannerTone))),
    card('Assinaturas e IA', el('div', { class: 'bo-actions' }, field('Lembrete de vencimento (dias antes)', remind, 'O e-mail é enviado uma vez, nesta antecedência.'), field('Teto diário de chamadas à IA', cap, 'Acima disso, as entregas usam o modelo fixo (controle de custo).')), el('p', { class: 'fine' }, 'Preços, dias por pagamento e o Kit Completo ficam em Produtos e preços.')),
    el('div', { class: 'bo-actions' }, save),
    card('Ambiente (somente leitura)', dl([
      ['Envio de e-mail', env.emailConfigured ? badge('Configurado', 'ok') : badge('Não configurado', 'bad')],
      ['Pagamento', env.gateway === 'fake' ? badge('Simulado (pré-lançamento): nenhum Pix é real', 'warn') : badge(env.gateway, 'ok')],
      ['IA (Anthropic)', env.aiKeyConfigured ? `Chave configurada · modelo ${env.aiModel}${env.aiWorkspaceConfigured ? ' · workspace definido' : ''}` : badge('Sem chave', 'warn')],
      ['Endereço público', env.publicUrl], ['Ambiente', env.env],
    ]), el('p', { class: 'fine' }, 'Chaves e segredos não aparecem nem são editados por aqui: ficam só no servidor.')),
  );
}

async function usersTab(ctx) {
  const host = el('div', { class: 'bo-stack' });
  async function draw() {
    const d = await api.usuarios();
    const roleLabel = (r) => ROLE_LABEL[r] ?? r;
    function editor(u) {
      const isNew = !u;
      const dw = drawer(isNew ? 'Novo usuário' : u.email);
      const email = el('input', { class: 'input', type: 'email', value: u?.email ?? '', disabled: !isNew, placeholder: 'e-mail que vai receber o código', 'aria-label': 'E-mail' });
      const name = el('input', { class: 'input', type: 'text', maxlength: '80', value: u?.name ?? '', 'aria-label': 'Nome' });
      const role = el('select', { class: 'input', 'aria-label': 'Papel' }, ...d.roles.map((r) => el('option', { value: r.id, selected: r.id === (u?.role ?? 'suporte') }, r.label)));
      const boxes = d.sections.map((s) => {
        const c = toggle(`perm-${s.id}`, s.label, null, (u?.permissions ?? d.roles.find((r) => r.id === 'suporte').permissions).includes(s.id));
        return { id: s.id, ...c };
      });
      const presetHint = el('p', { class: 'fine' });
      const applyPreset = () => {
        const preset = d.roles.find((r) => r.id === role.value).permissions;
        boxes.forEach((b) => { b.input.checked = preset.includes(b.id); b.input.disabled = role.value === 'owner'; });
        presetHint.textContent = role.value === 'owner' ? 'O dono sempre tem acesso a tudo.' : 'Trocar o papel aplica o conjunto sugerido; ajuste as caixas se quiser algo diferente.';
      };
      role.addEventListener('change', applyPreset);
      applyPreset();
      if (u) boxes.forEach((b) => { b.input.checked = u.permissions.includes(b.id); });
      const active = toggle('u-active', 'Acesso ativo', 'Desativar encerra as sessões desta pessoa na hora.', u?.active ?? true);
      const save = el('button', { class: 'btn btn-primary', type: 'button' }, isNew ? 'Criar e liberar acesso' : 'Salvar');
      save.addEventListener('click', async () => {
        const permissions = boxes.filter((b) => b.input.checked).map((b) => b.id);
        try {
          if (isNew) {
            if (!email.value.includes('@')) return toast('Informe o e-mail.');
            await api.criarUsuario({ email: email.value.trim(), name: name.value.trim(), role: role.value, permissions });
          } else {
            await api.salvarUsuario(u.id, { name: name.value.trim(), role: role.value, permissions, active: active.input.checked });
          }
          toast('Salvo.');
          dw.close();
          draw();
        } catch (e) {
          toast(e.message);
        }
      });
      dw.body.append(el('div', { class: 'bo-form' }, field('E-mail', email), field('Nome', name), field('Papel', role), presetHint, el('h3', {}, 'O que esta pessoa pode acessar'), ...boxes.map((b) => b.node), isNew ? el('p', { class: 'fine' }, 'A pessoa entra em folego.online/gestao com este e-mail: o código de 6 dígitos chega na caixa dela. Não há senha.') : active.node, save));
    }
    const add = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('plus'), 'Novo usuário');
    add.addEventListener('click', () => editor(null));
    host.replaceChildren(
      card('Usuários do backoffice', el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, 'Quem entra, o que vê e o que pode alterar. Cada ação fica na auditoria.'), add), table(
        [
          { label: 'Usuário', render: (u) => el('span', {}, u.name || u.email, u.name ? el('span', { class: 'fine' }, ` ${u.email}`) : null) },
          { label: 'Papel', render: (u) => roleLabel(u.role) },
          { label: 'Acesso', render: (u) => (u.active ? badge('Ativo', 'ok') : badge('Desativado', 'muted')) },
          { label: 'Áreas', render: (u) => (u.role === 'owner' ? 'Todas' : `${u.permissions.length} de ${d.sections.length}`) },
          { label: 'Último acesso', render: (u) => dt(u.lastLoginAt) },
        ],
        d.users,
        { onRow: (u) => editor(u) },
      )),
      card('Papéis sugeridos', table([{ label: 'Papel', render: (r) => r.label }, { label: 'Áreas liberadas por padrão', render: (r) => r.permissions.map((p) => d.sections.find((s) => s.id === p)?.label ?? p).join(' · ') }], d.roles)),
    );
  }
  await draw();
  return host;
}

async function auditTab() {
  const host = el('div', {});
  let scope = 'admin';
  let page = 0;
  async function draw() {
    host.replaceChildren(loading());
    try {
      const { items } = await api.auditoria({ escopo: scope, pagina: page });
      const all = el('button', { class: 'bo-chip', type: 'button', 'aria-pressed': String(scope === 'todos') }, 'Incluir eventos do sistema');
      all.addEventListener('click', () => { scope = scope === 'todos' ? 'admin' : 'todos'; page = 0; draw(); });
      const prev = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', disabled: page === 0 }, 'Anterior');
      const next = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', disabled: items.length < 60 }, 'Próxima');
      prev.addEventListener('click', () => { page -= 1; draw(); });
      next.addEventListener('click', () => { page += 1; draw(); });
      host.replaceChildren(card('Registro de auditoria', el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, 'Tudo o que foi feito no backoffice, com quem e quando. O registro é imutável.'), all), table(
        [{ label: 'Quando', render: (a) => dt(a.at) }, { label: 'Quem', render: (a) => a.actor }, { label: 'O quê', render: (a) => ACTION[a.action] ?? a.action }, { label: 'Sobre', render: (a) => `${a.entity} ${a.entityId ? String(a.entityId).slice(0, 12) : ''}` }, { label: 'Detalhe', render: (a) => detail(a.data) }],
        items,
        { emptyText: 'Nada registrado ainda.' },
      ), el('div', { class: 'bo-pager' }, prev, el('span', { class: 'muted' }, `Página ${page + 1}`), next)));
    } catch (e) {
      host.replaceChildren(errorBox(e, draw));
    }
  }
  const detail = (data) => {
    if (!data) return '—';
    const { by, ...rest } = data;
    const txt = Object.entries(rest).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
    return txt.length > 140 ? `${txt.slice(0, 140)}…` : txt || '—';
  };
  await draw();
  return host;
}

export async function configScreen(ctx) {
  const st = ctx.state.config ?? (ctx.state.config = { tab: ctx.can('config_site') ? 'site' : ctx.can('config_usuarios') ? 'usuarios' : 'auditoria' });
  const host = el('div', { class: 'bo-stack' });
  const items = [ctx.can('config_site') ? ['site', 'Site e recursos'] : null, ctx.can('config_usuarios') ? ['usuarios', 'Usuários e permissões'] : null, ctx.can('auditoria') ? ['auditoria', 'Auditoria'] : null].filter(Boolean);
  async function draw() {
    const body = el('div', {}, loading());
    host.replaceChildren(tabs(items, st.tab, (t) => { st.tab = t; draw(); }), body);
    try {
      body.replaceChildren(st.tab === 'site' ? await siteTab(ctx) : st.tab === 'usuarios' ? await usersTab(ctx) : await auditTab());
    } catch (e) {
      body.replaceChildren(errorBox(e, draw));
    }
  }
  await draw();
  return host;
}

