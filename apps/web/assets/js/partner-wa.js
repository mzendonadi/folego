// Portal do parceiro: aba WhatsApp (API oficial da Meta). Conversas, disparos, modelos, conexão e agente de IA.
// As regras ficam no servidor (janela de 24 h, permissão do contato, teto diário, silêncio); aqui a tela só mostra e explica.
import { el, icon, toast } from './dom.js';
import { confirmDialog } from './confirm.js';
import { STAGE } from './partner-views.js';
import { waInbox } from './wa-inbox.js';

const TABS = [['conversas', 'Conversas'], ['disparos', 'Disparos'], ['modelos', 'Modelos'], ['conexao', 'Conexão'], ['agente', 'Agente de IA']];
const TPL_STATUS = { rascunho: 'Rascunho', em_analise: 'Em análise na Meta', aprovado: 'Aprovado', rejeitado: 'Rejeitado' };
const MSG_STATUS = { fila: 'na fila', enviada: 'enviada', entregue: 'entregue', lida: 'lida', falhou: 'não enviada', recebida: '' };
const OPTIN = { desconhecido: 'Sem permissão informada', sim: 'Tem permissão', nao: 'Pediu para não receber' };

const hm = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const pill = (t, cls = '') => el('span', { class: `pt-pill ${cls}` }, t);
const field = (label, input, hint) => el('div', { class: 'field' }, el('label', { class: 'label', for: input.id }, label), input, hint ? el('p', { class: 'fine muted' }, hint) : null);
const input = (id, attrs = {}) => el('input', { class: 'input', id, type: 'text', ...attrs });
const select = (id, options, value) => el('select', { class: 'input', id }, ...options.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
const copy = (value) => {
  const b = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Copiar');
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(value); toast('Copiado.'); } catch { toast('Não consegui copiar. Selecione e copie.'); }
  });
  return b;
};

export async function viewWhatsapp(ctx) {
  const root = el('div', { class: 'pt-stack pt-wa' });
  const body = el('div', { class: 'pt-stack' });
  let acc = await ctx.call('GET', '/partner/wa/account');
  let tab = acc.connected ? (ctx.opts?.startContact || ctx.opts?.startDelivery || ctx.opts?.thread ? 'conversas' : 'conversas') : 'conexao';
  let stopInbox = null;
  const stop = () => { stopInbox?.(); stopInbox = null; };

  const bar = el('div', { class: 'pt-filters', role: 'tablist' });
  const paintBar = () => bar.replaceChildren(...TABS.map(([k, l]) => {
    const b = el('button', { class: 'pt-chip', type: 'button', role: 'tab', 'aria-selected': String(tab === k) }, l);
    b.addEventListener('click', () => { tab = k; show(); });
    return b;
  }));

  async function show() {
    stop();
    paintBar();
    body.replaceChildren(el('p', { class: 'pt-sub', role: 'status' }, 'Carregando…'));
    try {
      acc = await ctx.call('GET', '/partner/wa/account');
      const views = { conversas, disparos, modelos, conexao, agente };
      if (!acc.connected && tab !== 'conexao') tab = 'conexao';
      paintBar();
      body.replaceChildren(await views[tab]());
    } catch (e) {
      if (!e.silent) body.replaceChildren(el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, e.message)));
    }
  }

  // ------------------------------------------------------------------------------------------------ Conexão
  async function conexao() {
    const phoneNumberId = input('wa-pid', { inputmode: 'numeric', placeholder: 'Ex.: 109988776655443', value: acc.phoneNumberId ?? '', autocomplete: 'off' });
    const waba = input('wa-waba', { inputmode: 'numeric', placeholder: 'opcional', value: acc.wabaId ?? '' });
    const token = input('wa-token', { type: 'password', autocomplete: 'off', placeholder: acc.connected ? 'guardado: preencha só para trocar' : 'Token permanente' });
    const secret = input('wa-secret', { type: 'password', autocomplete: 'off', placeholder: acc.connected ? 'guardado: preencha só para trocar' : 'Segredo do app' });
    const appId = input('wa-appid', { inputmode: 'numeric', placeholder: 'opcional', value: acc.appId ?? '' });
    const cap = input('wa-cap', { inputmode: 'numeric', value: String(acc.dailyCap ?? 200) });
    const qs = select('wa-qs', Array.from({ length: 24 }, (_, h) => [String(h), `${String(h).padStart(2, '0')}h`]), String(acc.quietStart ?? 20));
    const qe = select('wa-qe', Array.from({ length: 24 }, (_, h) => [String(h), `${String(h).padStart(2, '0')}h`]), String(acc.quietEnd ?? 8));
    const save = el('button', { class: 'btn btn-primary', type: 'submit' }, acc.connected ? 'Salvar' : 'Conectar');
    const form = el('form', { class: 'pt-form' },
      field('ID do número de telefone', phoneNumberId, 'Painel da Meta > WhatsApp > Configuração da API.'),
      field('ID da conta do WhatsApp Business (opcional)', waba),
      field('ID do app da Meta (opcional)', appId, 'Só serve para trocar a foto do perfil da empresa por aqui. Painel da Meta > Configurações do app > Básico.'),
      field('Token de acesso permanente', token, 'Guardado criptografado. Nunca volta para a tela.'),
      field('Segredo do app', secret, 'Configurações do app > Básico. Serve para conferir que o aviso veio mesmo da Meta.'),
      field('Disparos por dia (teto)', cap, 'Protege o seu número. Respostas de atendimento não contam.'),
      el('div', { class: 'field' }, el('span', { class: 'label' }, 'Sem disparos entre'), el('div', { class: 'pt-inline-pair' }, qs, el('span', {}, 'e'), qe)),
      save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = { dailyCap: Number(cap.value) || 200, quietStart: Number(qs.value), quietEnd: Number(qe.value) };
      if (phoneNumberId.value.trim()) b.phoneNumberId = phoneNumberId.value.trim();
      if (waba.value.trim()) b.wabaId = waba.value.trim();
      if (appId.value.trim()) b.appId = appId.value.trim();
      if (token.value.trim()) b.token = token.value.trim();
      if (secret.value.trim()) b.appSecret = secret.value.trim();
      save.disabled = true;
      try {
        acc = await ctx.call('PUT', '/partner/wa/account', b);
        toast(acc.connected ? 'WhatsApp conectado.' : 'Salvo.');
        show();
      } catch (err) { save.disabled = false; toast(err.message); }
    });
    const test = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Testar conexão');
    test.addEventListener('click', async () => {
      test.disabled = true;
      try { const r = await ctx.call('POST', '/partner/wa/account/test'); toast(`Conectado a ${r.verifiedName ?? r.displayPhone ?? 'a conta'}.`); } catch (err) { toast(err.message); }
      test.disabled = false;
    });
    const pause = acc.connected ? el('button', { class: 'btn btn-quiet', type: 'button' }, acc.status === 'ativa' ? 'Pausar envios' : 'Reativar envios') : null;
    pause?.addEventListener('click', async () => {
      try { await ctx.call('PUT', '/partner/wa/account', { status: acc.status === 'ativa' ? 'pausada' : 'ativa' }); show(); } catch (err) { toast(err.message); }
    });
    const steps = el('ol', { class: 'pt-steps' },
      el('li', {}, 'No ', el('strong', {}, 'developers.facebook.com'), ' crie um app do tipo "Empresa" e adicione o produto ', el('strong', {}, 'WhatsApp'), '. É grátis: sem mensalidade e sem intermediário.'),
      el('li', {}, 'Registre o número do seu negócio (ele deixa de funcionar no aplicativo comum do WhatsApp). Copie o ', el('strong', {}, 'ID do número'), '.'),
      el('li', {}, 'Em Usuários do sistema, gere um ', el('strong', {}, 'token permanente'), ' com a permissão whatsapp_business_messaging. Copie o ', el('strong', {}, 'Segredo do app'), ' em Configurações > Básico.'),
      el('li', {}, 'Cole os quatro dados aqui e clique em Conectar. Depois, em Webhooks da Meta, informe o endereço e o token de verificação abaixo e assine o campo ', el('strong', {}, 'messages'), '.'));
    return el('div', { class: 'pt-stack' },
      el('section', { class: 'pt-card' }, el('h2', { class: 'pt-h2' }, acc.connected ? `Conectado${acc.displayPhone ? `: ${acc.displayPhone}` : ''}` : 'Conectar o seu WhatsApp'),
        el('p', { class: 'pt-sub' }, acc.connected ? `Hoje: ${acc.usedToday} de ${acc.dailyCap} disparos. ${acc.status === 'ativa' ? 'Envios ativos.' : 'Envios pausados.'}` : 'Use a API oficial da Meta: segura para o seu número e sem custo de plataforma. A Meta só cobra os modelos de marketing enviados; a conversa que o cliente começa e as respostas em até 24 h não são cobradas.'),
        acc.connected ? null : steps, form,
        acc.connected ? el('div', { class: 'pt-actions' }, test, pause) : null),
      el('section', { class: 'pt-card' }, el('h2', { class: 'pt-h2' }, 'Webhook (receber mensagens)'),
        el('p', { class: 'pt-sub' }, 'Cole estes dois dados na tela de Webhooks do app da Meta. É por aqui que as mensagens dos clientes chegam ao portal.'),
        el('div', { class: 'pt-kv' }, el('div', {}, el('dt', {}, 'Endereço'), el('dd', {}, acc.webhookUrl, ' ', copy(acc.webhookUrl))),
          acc.connected ? el('div', {}, el('dt', {}, 'Token de verificação'), el('dd', {}, acc.verifyToken, ' ', copy(acc.verifyToken))) : null)),
      acc.connected ? await perfilEmpresa() : null,
      el('section', { class: 'pt-card' }, el('h2', { class: 'pt-h2' }, 'Regras que protegem o seu número'),
        el('ul', { class: 'pt-rules' },
          el('li', {}, 'Texto livre só em até 24 h depois da última mensagem do cliente. Fora disso, só modelo aprovado pela Meta.'),
          el('li', {}, 'Disparo só para quem deu permissão: contato do Fôlego, base marcada "tenho autorização" ou quem escreveu primeiro.'),
          el('li', {}, 'Se o cliente escrever SAIR ou PARAR, os envios param na hora e ele é avisado.'),
          el('li', {}, 'Teto diário e horário de silêncio. Quem já recebeu modelo nos últimos 3 dias não recebe de novo.'))));
  }

  // ------------------------------------------------------------------------------------------------ Perfil da empresa
  // O que o cliente vê do número: recado, descrição, e-mail, site, endereço e foto (editados direto na Meta).
  async function perfilEmpresa() {
    const card = (...kids) => el('section', { class: 'pt-card' }, el('h2', { class: 'pt-h2' }, 'Perfil da empresa no WhatsApp'), ...kids);
    let p;
    try { p = await ctx.call('GET', '/partner/wa/business-profile'); } catch (e) { return card(el('p', { class: 'pt-sub' }, e.message)); }
    if (!p.editable) return card(el('p', { class: 'pt-sub' }, p.note ?? 'Este perfil é editado no painel do provedor.'));
    const about = input('bp-about', { maxlength: '139', value: p.about ?? '' });
    const desc = el('textarea', { class: 'input', id: 'bp-desc', rows: '3', maxlength: '512' }, p.description ?? '');
    const email = input('bp-email', { type: 'email', value: p.email ?? '' });
    const site = input('bp-site', { type: 'url', placeholder: 'https://', value: p.websites?.[0] ?? '' });
    const addr = input('bp-addr', { maxlength: '256', value: p.address ?? '' });
    const save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar perfil');
    const form = el('form', { class: 'pt-form' },
      field('Recado (aparece abaixo do nome)', about, 'Até 139 caracteres.'),
      el('div', { class: 'field pt-wide' }, el('label', { class: 'label', for: 'bp-desc' }, 'Descrição da empresa'), desc),
      field('E-mail', email), field('Site', site), field('Endereço', addr), save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await ctx.call('PUT', '/partner/wa/business-profile', { about: about.value.trim(), description: desc.value.trim(), email: email.value.trim(), websites: site.value.trim() ? [site.value.trim()] : [], address: addr.value.trim() });
        toast('Perfil salvo na Meta.');
      } catch (err) { toast(err.message); }
      save.disabled = false;
    });
    const fileIn = el('input', { type: 'file', accept: 'image/jpeg,image/png', tabindex: '-1' });
    fileIn.hidden = true;
    const photo = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Trocar a foto do perfil');
    photo.addEventListener('click', () => (p.photoEditable ? fileIn.click() : toast('Informe o ID do app da Meta em Conexão e salve para poder trocar a foto por aqui.')));
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files?.[0];
      fileIn.value = '';
      if (!f) return;
      photo.disabled = true;
      try {
        const res = await ctx.raw('POST', '/partner/wa/media', { 'content-type': 'application/octet-stream', 'x-mime': f.type, 'x-filename': encodeURIComponent(f.name), 'x-purpose': 'avatar' }, f);
        const up = await res.json().catch(() => null);
        if (!res.ok) throw new Error(up?.message ?? 'Não consegui enviar a foto.');
        await ctx.call('PUT', '/partner/wa/business-profile/photo', { mediaId: up.id });
        toast('Foto do perfil atualizada.');
      } catch (err) { toast(err.message); }
      photo.disabled = false;
    });
    return card(el('p', { class: 'pt-sub' }, 'É assim que o cliente vê o seu número no WhatsApp. A foto precisa ser JPG ou PNG, quadrada, de pelo menos 640 px.'), form, el('div', { class: 'pt-actions' }, photo, fileIn));
  }

  // ------------------------------------------------------------------------------------------------ Modelos
  async function modelos() {
    const list = (await ctx.call('GET', '/partner/wa/templates')).templates;
    const name = input('tp-name', { placeholder: 'ex.: retorno_consignado', maxlength: '60' });
    const cat = select('tp-cat', [['MARKETING', 'Marketing (cobrado pela Meta)'], ['UTILITY', 'Utilidade (aviso sobre algo que o cliente pediu)']], 'MARKETING');
    const text = el('textarea', { class: 'input', id: 'tp-body', rows: '4', maxlength: '1024', placeholder: 'Olá {{1}}, aqui é da Euro Multiplan. Posso simular o seu consignado sem compromisso?' });
    const add = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar modelo');
    const form = el('form', { class: 'pt-form' }, field('Nome (minúsculas e _)', name), field('Categoria', cat), el('div', { class: 'field pt-wide' }, el('label', { class: 'label', for: 'tp-body' }, 'Texto'), text, el('p', { class: 'fine muted' }, 'Use {{1}}, {{2}} para as partes que mudam (nome, valor). Sem links encurtados e sem promessa de taxa.')), add);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await ctx.call('POST', '/partner/wa/templates', { name: name.value.trim(), category: cat.value, body: text.value.trim() }); toast('Modelo salvo.'); show(); } catch (err) { toast(err.message); }
    });
    return el('div', { class: 'pt-stack' },
      el('section', { class: 'pt-card' }, el('h2', { class: 'pt-h2' }, 'Modelos de mensagem'),
        el('p', { class: 'pt-sub' }, 'A Meta exige um modelo aprovado para começar uma conversa. Crie o mesmo texto e nome no Gerenciador do WhatsApp (Meta) e, quando for aprovado, marque "Aprovado" aqui.'),
        list.length === 0 ? el('div', { class: 'pt-empty' }, el('strong', {}, 'Nenhum modelo ainda'), el('p', {}, 'Crie o primeiro abaixo.')) : el('div', { class: 'pt-table-wrap' }, el('table', { class: 'pt-table' },
          el('thead', {}, el('tr', {}, ...['Modelo', 'Categoria', 'Situação', ''].map((h) => el('th', { scope: 'col' }, h)))),
          el('tbody', {}, ...list.map((t) => {
            const st = select(`st-${t.id}`, Object.entries(TPL_STATUS), t.status);
            st.setAttribute('aria-label', `Situação de ${t.name}`);
            st.addEventListener('change', async () => { try { await ctx.call('PATCH', `/partner/wa/templates/${t.id}`, { status: st.value }); toast('Situação atualizada.'); } catch (err) { toast(err.message); } });
            const del = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Apagar ${t.name}` }, icon('trash'));
            del.addEventListener('click', async () => {
              if (!(await confirmDialog({ title: `Apagar o modelo ${t.name}?`, text: 'Só dá para apagar modelos que ainda não foram usados.', confirmLabel: 'Apagar', danger: true }))) return;
              try { await ctx.call('DELETE', `/partner/wa/templates/${t.id}`); show(); } catch (err) { toast(err.message); }
            });
            return el('tr', {}, el('td', {}, el('strong', {}, t.name), el('span', { class: 'pt-cell-sub' }, t.body)), el('td', {}, t.category === 'MARKETING' ? 'Marketing' : 'Utilidade'), el('td', {}, st), el('td', {}, del));
          }))))),
      el('section', { class: 'pt-card' }, el('h2', { class: 'pt-h2' }, 'Novo modelo'), form));
  }

  // ------------------------------------------------------------------------------------------------ Disparos
  async function disparos() {
    const [{ templates }, { broadcasts }] = await Promise.all([ctx.call('GET', '/partner/wa/templates'), ctx.call('GET', '/partner/wa/broadcasts')]);
    const approved = templates.filter((t) => t.status === 'aprovado');
    const bname = input('bc-name', { placeholder: 'Ex.: Retorno de outubro', maxlength: '100' });
    const tpl = select('bc-tpl', approved.length ? approved.map((t) => [t.id, t.name]) : [['', 'Nenhum modelo aprovado']], approved[0]?.id ?? '');
    const vars = input('bc-vars', { placeholder: 'Variáveis separadas por | (use {nome} para o primeiro nome)', value: '{nome}' });
    const source = select('bc-src', [['base', 'Minha base (com permissão)'], ['folego', 'Contatos do Fôlego'], ['ambos', 'Os dois']], 'base');
    const stage = select('bc-stage', [['', 'Qualquer etapa'], ...Object.entries(STAGE)], '');
    const uf = input('bc-uf', { maxlength: '2', placeholder: 'UF do órgão' });
    const margin = input('bc-margin', { inputmode: 'numeric', placeholder: 'Margem mínima (R$)' });
    const out = el('p', { class: 'pt-commission-preview', 'aria-live': 'polite' }, 'Escolha o público e calcule antes de disparar.');
    const read = () => {
      const filter = {};
      if (stage.value) filter.stage = stage.value;
      if (uf.value.trim().length === 2) filter.orgUf = uf.value.trim().toUpperCase();
      const m = Number(margin.value.replace(/\./g, '').replace(',', '.'));
      if (m > 0) filter.minMarginCents = Math.round(m * 100);
      return { name: bname.value.trim() || 'Disparo', templateId: tpl.value, vars: vars.value.split('|').map((v) => v.trim()).filter(Boolean), source: source.value, filter };
    };
    const calc = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Calcular público');
    calc.addEventListener('click', async () => {
      if (!tpl.value) return toast('Aprove um modelo primeiro.');
      try {
        const r = await ctx.call('POST', '/partner/wa/broadcasts/preview', read());
        out.textContent = `${r.eligible} contato(s) podem receber${r.sample.length ? ` (ex.: ${r.sample.join(', ')})` : ''}. ${r.withoutPermission ? `${r.withoutPermission} ficam de fora por falta de permissão. ` : ''}${r.noPhone ? `${r.noPhone} sem telefone válido. ` : ''}Máximo de ${r.max} por disparo.`;
      } catch (err) { out.textContent = err.message; }
    });
    const go = el('button', { class: 'btn btn-primary', type: 'button' }, 'Disparar');
    go.addEventListener('click', async () => {
      if (!tpl.value) return toast('Aprove um modelo primeiro.');
      if (bname.value.trim().length < 3) return toast('Dê um nome ao disparo.');
      if (!(await confirmDialog({ title: 'Enviar este disparo?', text: 'Os contatos recebem o modelo escolhido, respeitando o teto diário e o horário de silêncio. Quem pedir SAIR deixa de receber.', confirmLabel: 'Disparar' }))) return;
      go.disabled = true;
      try {
        const r = await ctx.call('POST', '/partner/wa/broadcasts', read());
        toast(`${r.queued} mensagem(ns) na fila${r.skippedRecent ? `, ${r.skippedRecent} já receberam há pouco` : ''}.`);
        show();
      } catch (err) { go.disabled = false; toast(err.message); }
    });
    const form = el('div', { class: 'pt-form' }, field('Nome do disparo', bname), field('Modelo aprovado', tpl), field('Variáveis do modelo', vars), field('Público', source), field('Etapa', stage), field('UF do órgão', uf), field('Margem livre mínima', margin), out, el('div', { class: 'pt-actions pt-wide' }, calc, go));
    return el('div', { class: 'pt-stack' },
      el('section', { class: 'pt-card' }, el('h2', { class: 'pt-h2' }, 'Novo disparo'), el('p', { class: 'pt-sub' }, 'Ferramenta de conversão: o modelo abre a conversa e o atendimento (ou o agente) continua nela. Só chega a quem tem permissão.'), approved.length === 0 ? el('p', { class: 'note note-amber' }, icon('info'), el('span', {}, 'Você ainda não tem modelo aprovado. Crie e marque como aprovado em Modelos.')) : null, form),
      el('section', { class: 'pt-card' }, el('h2', { class: 'pt-h2' }, 'Disparos anteriores'),
        broadcasts.length === 0 ? el('p', { class: 'pt-sub' }, 'Nenhum disparo ainda.') : el('div', { class: 'pt-table-wrap' }, el('table', { class: 'pt-table' },
          el('thead', {}, el('tr', {}, ...['Disparo', 'Na fila', 'Enviadas', 'Entregues', 'Lidas', 'Falhas', ''].map((h) => el('th', { scope: 'col' }, h)))),
          el('tbody', {}, ...broadcasts.map((b) => {
            const cancel = b.queue ? el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Cancelar fila') : null;
            cancel?.addEventListener('click', async () => { try { const r = await ctx.call('POST', `/partner/wa/broadcasts/${b.id}/cancel`, {}); toast(`${r.canceled} cancelada(s).`); show(); } catch (err) { toast(err.message); } });
            return el('tr', {}, el('td', {}, el('strong', {}, b.name), el('span', { class: 'pt-cell-sub' }, `${b.template} · ${hm(b.createdAt)}`)), el('td', {}, String(b.queue)), el('td', {}, String(b.sent)), el('td', {}, String(b.delivered)), el('td', {}, String(b.read)), el('td', {}, String(b.failed)), el('td', {}, cancel));
          }))))));
  }

  // ------------------------------------------------------------------------------------------------ Agente de IA
  async function agente() {
    const a = acc.agent;
    const on = el('input', { type: 'checkbox', id: 'ag-on', checked: a.enabled });
    const persona = el('textarea', { class: 'input', id: 'ag-persona', rows: '4', maxlength: '2000' }, a.persona);
    const rules = el('textarea', { class: 'input', id: 'ag-rules', rows: '5', maxlength: '3000' }, a.rules);
    const kw = input('ag-kw', { value: a.handoffKeywords.join(', ') });
    const max = input('ag-max', { inputmode: 'numeric', value: String(a.maxRepliesPerHour) });
    const disc = input('ag-disc', { value: a.disclosure, maxlength: '300' });
    const save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar agente');
    const form = el('form', { class: 'pt-form' },
      el('label', { class: 'check pt-wide', for: 'ag-on' }, on, el('span', {}, 'Ligar o agente de IA nas conversas que eu colocar em modo IA')),
      el('div', { class: 'field pt-wide' }, el('label', { class: 'label', for: 'ag-persona' }, 'Quem é o agente'), persona),
      el('div', { class: 'field pt-wide' }, el('label', { class: 'label', for: 'ag-rules' }, 'Regras de negócio'), rules),
      field('Passar para uma pessoa se o cliente disser', kw, 'Separe por vírgula.'),
      field('Respostas da IA por hora, por conversa', max),
      el('div', { class: 'field pt-wide' }, el('label', { class: 'label', for: 'ag-disc' }, 'Aviso na primeira resposta da IA'), disc),
      save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await ctx.call('PUT', '/partner/wa/agent', { enabled: on.checked, persona: persona.value.trim(), rules: rules.value.trim(), handoffKeywords: kw.value.split(',').map((s) => s.trim()).filter(Boolean), maxRepliesPerHour: Number(max.value) || 6, disclosure: disc.value.trim() });
        toast('Agente salvo.');
        show();
      } catch (err) { save.disabled = false; toast(err.message); }
    });
    return el('div', { class: 'pt-stack' },
      el('section', { class: 'pt-card' }, el('h2', { class: 'pt-h2' }, 'Agente de IA para vendas e negociação'),
        el('p', { class: 'pt-sub' }, 'Atende sozinho dentro das regras abaixo e chama uma pessoa quando o cliente pede, quando passa do limite por hora ou quando a IA não sabe. Sempre avisa que é um assistente virtual.'),
        acc.agentAvailable ? el('p', { class: 'note' }, icon('check'), el('span', {}, 'Agente instalado neste servidor.')) : el('p', { class: 'note note-amber' }, icon('info'), el('span', {}, 'O agente de IA ainda não está instalado neste servidor. Você já pode deixar as regras prontas; ele só liga quando for instalado.')),
        form));
  }

  // ------------------------------------------------------------------------------------------------ Conversas
  // Caixa de entrada completa (mensagens, fotos, documentos, áudios, encaminhar, número novo e perfis): componente compartilhado com o backoffice.
  async function conversas() {
    const host = {
      call: (method, path, body) => ctx.call(method, `/partner/wa${path}`, body),
      async upload(blob, { mime, filename, purpose }) {
        const res = await ctx.raw('POST', '/partner/wa/media', { 'content-type': 'application/octet-stream', 'x-mime': mime, 'x-filename': encodeURIComponent(filename ?? ''), ...(purpose ? { 'x-purpose': purpose } : {}) }, blob);
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.message ?? (res.status === 413 ? 'O arquivo passa de 16 MB.' : `Não consegui enviar o arquivo (erro ${res.status}).`));
        return json;
      },
      async blob(path) {
        const res = await ctx.raw('GET', `/partner/wa${path}`);
        if (!res.ok) throw new Error('Não consegui abrir o arquivo.');
        return res.blob();
      },
    };
    const o = ctx.opts ?? {};
    const inbox = waInbox({ host, start: { contact: o.startContact, delivery: o.startDelivery, thread: o.thread }, features: { agent: Boolean(acc.agentAvailable && acc.agent?.enabled) } });
    stopInbox = inbox.stop;
    return inbox.node;
  }

  root.append(el('header', { class: 'pt-head' }, el('div', {}, el('h1', {}, 'WhatsApp'), el('p', {}, 'Converse, dispare e venda pelo WhatsApp oficial: tudo no mesmo lugar do cliente, do contrato e da comissão.'))), bar, body);
  await show();
  return root;
}
