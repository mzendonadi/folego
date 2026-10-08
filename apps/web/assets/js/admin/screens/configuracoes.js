// Configurações: recursos do site e das assinaturas (valem na hora), usuários e permissões do backoffice, e auditoria.
import { api } from '../api.js';
import { el, icon, toast, dt, card, table, tabs, badge, field, dl, drawer, loading, errorBox } from '../ui.js';
import { confirmDialog } from '../../confirm.js';
import { runbookCard } from './runbook.js';

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
  const mk = await api.mercado().catch(() => null);
  const subs = toggle('cf-subs', 'Prumo: assinaturas (conta por e-mail, cobrança mensal no cartão)', env.emailConfigured ? 'Desligar esconde a área de conta para novos acessos; os dados e as assinaturas continuam guardados.' : 'Precisa do envio de e-mail configurado no servidor.', s.subscriptionsEnabled, !env.emailConfigured && !s.subscriptionsEnabled);
  const leads = toggle('cf-leads', 'Propostas de parceiros (leads)', 'Deixe desligado até a revisão jurídica (LGPD e superendividamento).', s.leadsEnabled);
  const ai = toggle('cf-ai', 'IA nas entregas (roteiros e plano de renda extra)', env.aiKeyConfigured ? 'Desligada, as entregas saem pelos modelos fixos, sem custo de IA.' : 'Não há chave da Anthropic configurada no servidor: mesmo ligada, sai o modelo fixo.', s.aiEnabled);
  const paused = toggle('cf-paused', 'Pausar as vendas', 'Ninguém consegue assinar nem gerar Pix novo (visitantes veem um aviso). Quem já assina continua usando e sendo cobrado normalmente. O resultado grátis continua funcionando.', s.salesPaused);
  const cap = el('input', { class: 'input input-sm', type: 'number', min: '0', max: '100000', value: String(s.aiMaxCallsPerDay), 'aria-label': 'Teto diário de chamadas à IA' });
  const aiMonth = el('input', { class: 'input input-sm', type: 'number', min: '0', max: '1000000', value: String(s.aiMonthlyCallsLimit ?? 4000), 'aria-label': 'Teto mensal de chamadas à IA' });
  const mailDay = el('input', { class: 'input input-sm', type: 'number', min: '0', max: '1000000', value: String(s.emailDailyLimit ?? 100), 'aria-label': 'Limite diário de e-mails' });
  const mailMonth = el('input', { class: 'input input-sm', type: 'number', min: '0', max: '10000000', value: String(s.emailMonthlyLimit ?? 3000), 'aria-label': 'Limite mensal de e-mails' });
  const campCap = el('input', { class: 'input input-sm', type: 'number', min: '0', max: '5000', value: String(s.campaignDailyCap), 'aria-label': 'Teto diário de e-mails de campanha' });
  const referralOn = toggle('cf-ref', 'Programa de indicações', 'Liga os convites por e-mail (compradores no Pix e assinantes) e o desconto de quem indica assinantes.', s.referralEnabled ?? true);
  const referralPct = el('input', { class: 'input input-sm', type: 'number', min: '0', max: '50', value: String(s.referralDiscountPct ?? 10), 'aria-label': 'Desconto por indicação (%)' });
  const purge = el('input', { class: 'input input-sm', type: 'number', min: '1', max: '180', value: String(s.canceledPurgeDays ?? 15), 'aria-label': 'Dias de retenção dos dados de quem cancelou' });
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
        aiMaxCallsPerDay: Number(cap.value) || 0, aiMonthlyCallsLimit: Number(aiMonth.value) || 0, emailDailyLimit: Number(mailDay.value) || 0, emailMonthlyLimit: Number(mailMonth.value) || 0, campaignDailyCap: Number(campCap.value) || 0, canceledPurgeDays: Math.min(180, Math.max(1, Number(purge.value) || 15)), referralEnabled: referralOn.input.checked, referralDiscountPct: Math.min(50, Math.max(0, Math.round(Number(referralPct.value) || 0))), reminderDaysBefore: Number(remind.value) || 3,
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
    card('Recursos do site', subs.node, leads.node, ai.node, paused.node, referralOn.node),
    card('Aviso no site', bannerOn.node, el('div', { class: 'bo-actions' }, field('Texto', bannerText), field('Tipo', bannerTone))),
    card('Assinaturas e IA', el('div', { class: 'bo-actions' }, field('Lembrete de vencimento (dias antes)', remind, 'O e-mail é enviado uma vez, nesta antecedência.'), field('Teto diário de chamadas à IA', cap, 'Acima disso, as entregas usam o modelo fixo (controle de custo).'), field('Teto diário de e-mails de campanha', campCap, 'Protege a reputação do e-mail do Fôlego. 0 = nenhuma campanha sai.'), field('Desconto por indicação que assina (%)', referralPct, 'Vale um mês, na próxima fatura de quem indicou. Os meses se acumulam. Ao mudar, só as próximas indicações usam o valor novo.'), field('Guarda dos dados de quem cancelou (dias)', purge, 'Depois do fim do acesso, você tem este prazo para baixar o pacote em Assinaturas > Cancelados. Passado o prazo, os dados são apagados sozinhos.')), el('p', { class: 'fine' }, 'Preços dos planos e o Kit Completo ficam em Produtos e preços.')),
    card('Custos e limites', el('p', { class: 'muted' }, 'Quando o uso passa de 80% de qualquer limite, o card "Sistema saudável" do Painel acende e o Monitor avisa por e-mail. A IA para sozinha no teto diário (acima); o e-mail só avisa: use o limite do seu plano no Resend.'), el('div', { class: 'bo-actions' }, field('IA: chamadas por mês', aiMonth), field('E-mails por dia', mailDay), field('E-mails por mês', mailMonth))),
    el('div', { class: 'bo-actions' }, save),
    card(
      'Indicadores econômicos (Banco Central)',
      el('p', { class: 'muted' }, 'Selic, inflação (IPCA), CDI e dólar alimentam o Cenário econômico do Prumo. O sistema busca sozinho; use o botão para atualizar agora e ver o motivo se alguma série falhar.'),
      dl([
        ['Última atualização', mk?.updatedAt ? new Date(mk.updatedAt).toLocaleString('pt-BR') : 'ainda sem dados'],
        ['Selic / IPCA 12m / CDI / dólar', mk ? [mk.indicators.selicPct, mk.indicators.ipca12Pct, mk.indicators.cdiPct, mk.indicators.usdBrl].map((v) => (v === null ? '—' : String(v).replace('.', ','))).join(' · ') : '—'],
        ['Última tentativa', mk?.lastRun ? `${new Date(mk.lastRun.at).toLocaleString('pt-BR')} · ${mk.lastRun.saved} valores${Object.keys(mk.lastRun.errors).length ? ` · falhou: ${Object.entries(mk.lastRun.errors).map(([k, v]) => `${k} (${v})`).join(', ')}` : ' · tudo certo'}` : 'nenhuma ainda'],
      ]),
      (() => {
        const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Atualizar agora');
        b.addEventListener('click', async () => {
          b.disabled = true;
          try {
            const r = await api.atualizarMercado();
            toast(Object.keys(r.lastRun?.errors ?? {}).length ? `Atualizado com falhas: ${Object.keys(r.lastRun.errors).join(', ')}` : `Atualizado (${r.saved} valores).`);
            location.reload();
          } catch (e) {
            toast(e.message);
            b.disabled = false;
          }
        });
        return el('div', { class: 'bo-actions' }, b);
      })(),
    ),
    card('Ambiente (somente leitura)', dl([
      ['Envio de e-mail', env.emailConfigured ? badge('Configurado', 'ok') : badge('Não configurado', 'bad')],
      ['Pagamento', env.gateway === 'fake' ? badge('Simulado (pré-lançamento): nenhuma cobrança é real', 'warn') : badge(env.gateway, 'ok')],
      ['IA (Anthropic)', env.aiKeyConfigured ? `Chave configurada · modelo ${env.aiModel}${env.aiWorkspaceConfigured ? ' · workspace definido' : ''}` : badge('Sem chave', 'warn')],
      ['Endereço público', env.publicUrl], ['Ambiente', env.env],
    ]), el('p', { class: 'fine' }, 'Chaves e segredos não aparecem nem são editados por aqui: ficam só no servidor.')),
    runbookCard(),
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
      const reset = u
        ? el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('lock'), u.hasPassword ? 'Redefinir senha (apaga a atual)' : 'Liberar novo cadastro de senha')
        : null;
      reset?.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Redefinir a senha?', text: 'Apaga a senha de ' + u.email + ', encerra as sessões dela e libera por 24 horas o cadastro de uma senha nova (com código por e-mail).', confirmLabel: 'Redefinir', danger: true }))) return;
        try {
          await api.salvarUsuario(u.id, { resetPassword: true });
          toast('Pronto. A pessoa já pode criar uma senha nova pela tela de login.');
          dw.close();
          draw();
        } catch (e) {
          toast(e.message);
        }
      });
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
      dw.body.append(el('div', { class: 'bo-form' }, field('E-mail', email), field('Nome', name), field('Papel', role), presetHint, el('h3', {}, 'O que esta pessoa pode acessar'), ...boxes.map((b) => b.node), isNew ? el('p', { class: 'fine' }, 'No primeiro acesso, a pessoa abre folego.online/gestao, clica em "Primeiro acesso" e cria a própria senha com um código enviado ao e-mail dela. Depois, todo login pede senha e código.') : active.node, reset ? el('div', {}, reset) : null, save));
    }
    const add = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('plus'), 'Novo usuário');
    add.addEventListener('click', () => editor(null));
    host.replaceChildren(
      card('Usuários do backoffice', el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, 'Quem entra, o que vê e o que pode alterar. Cada ação fica na auditoria.'), add), table(
        [
          { label: 'Usuário', render: (u) => el('span', {}, u.name || u.email, u.name ? el('span', { class: 'fine' }, ` ${u.email}`) : null) },
          { label: 'Papel', render: (u) => roleLabel(u.role) },
          { label: 'Acesso', render: (u) => el('span', {}, u.active ? badge('Ativo', 'ok') : badge('Desativado', 'muted'), ' ', u.locked ? badge('Bloqueado', 'bad') : null, ' ', !u.hasPassword ? badge('Sem senha', 'warn') : null) },
          { label: 'Áreas', render: (u) => (u.role === 'owner' ? 'Todas' : `${u.permissions.length} de ${d.sections.length}`) },
          { label: 'Último acesso', render: (u) => dt(u.lastLoginAt) },
        ],
        d.users,
        { onRow: (u) => editor(u) },
      )),
      card(
        'Papéis sugeridos',
        el('p', { class: 'muted' }, 'Ao criar uma pessoa, o papel já marca estas áreas. Você pode ajustar uma a uma na hora de salvar.'),
        el(
          'div', { class: 'bo-roles' },
          ...d.roles.map((r) => {
            const areas = r.permissions.map((p) => d.sections.find((s) => s.id === p)?.label ?? p);
            return el(
              'article', { class: 'bo-role' },
              el('header', { class: 'bo-head-line' }, el('h3', {}, r.label), badge(areas.length === d.sections.length ? 'Todas as áreas' : `${areas.length} ${areas.length === 1 ? 'área' : 'áreas'}`, 'muted')),
              el('div', { class: 'bo-chips' }, ...(areas.length ? areas.map((a) => badge(a, 'ok')) : [el('span', { class: 'fine muted' }, 'Nenhuma área por padrão')])),
            );
          }),
        ),
      ),
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

