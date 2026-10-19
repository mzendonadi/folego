// WhatsApp do Fôlego (número +55 11 91379-2370, pela Bird): caixa de entrada completa, modelos e conexão.
// Mesmo componente do portal do parceiro (wa-inbox.js); aqui o servidor é o do Fôlego e as regras da Meta/Bird valem igual.
import { api } from '../api.js';
import { waInbox } from '../../wa-inbox.js';
import { el, icon, toast, card, cardOpts, tabs, table, field, int, drawer, dl, badge, dt, kpi, kpis } from '../ui.js';
import { confirmDialog } from '../../confirm.js';

const TPL_STATUS = { rascunho: ['Rascunho', 'muted'], em_analise: ['Em análise', 'warn'], aprovado: ['Aprovado', 'ok'], rejeitado: ['Rejeitado', 'bad'] };

export async function whatsappScreen(ctx = {}) {
  // Vindo do Chatbot: abre "Nova conversa" já com o celular e o nome do contato (uma vez só).
  const prefill = ctx.state?.waStart ?? null;
  if (ctx.state) ctx.state.waStart = null;
  const host = el('div', { class: 'bo-stack' });
  const st = { tab: 'conversas' };
  let inbox = null;
  const stopInbox = () => { inbox?.stop(); inbox = null; };
  let acc = await api.wa.call('GET', '/account');
  if (!acc.configured) st.tab = 'conexao';
  let pending = acc.configured ? prefill : null;
  if (prefill && !acc.configured) toast('Conecte o número do WhatsApp para falar com o contato.');

  const bar = () => tabs([['conversas', 'Conversas'], ['oportunidades', 'Oportunidades'], ['modelos', 'Modelos'], ['conexao', 'Conexão']], st.tab, (t) => { st.tab = t; draw(); });

  async function draw() {
    stopInbox();
    host.replaceChildren(bar(), el('p', { class: 'muted bo-loading', role: 'status' }, 'Carregando…'));
    try {
      acc = await api.wa.call('GET', '/account');
      if (!acc.configured && st.tab !== 'conexao') st.tab = 'conexao';
      const body = st.tab === 'conversas' ? conversas() : st.tab === 'oportunidades' ? await oportunidades() : st.tab === 'modelos' ? await modelos() : conexao();
      host.replaceChildren(bar(), body);
    } catch (e) {
      host.replaceChildren(bar(), el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, e.message)));
    }
  }

  // ------------------------------------------------------------------------------------------ Conversas
  function conversas() {
    const start = pending ? { prefill: { phone: pending.phone, name: pending.name, templateHint: pending.templateHint ?? 'chatbot', onOpened: pending.onOpened } } : {};
    pending = null;
    inbox = waInbox({ host: api.wa, start, features: { agent: false } });
    return el('div', { class: 'bo-wa' }, inbox.node);
  }

  // ------------------------------------------------------------------------------------------ Oportunidades
  // O que foi enviado aos parceiros: o envio é automático (webhook assinado, feito pelo worker); aqui só se acompanha o andamento de cada um.
  const STATE = { pendente: ['Pendente', 'warn'], tentando: ['Tentando de novo', 'warn'], enviado: ['Enviado', 'ok'], falhou: ['Falhou', 'bad'], contatado: ['Parceiro já falou', 'ok'], contratado: ['Contratado', 'ok'], recusado: ['Recusado', 'muted'], sem_parceiro: ['Sem parceiro compatível', 'muted'] };
  const EMP = { clt: 'CLT', inss_retiree: 'Aposentado/pensionista', public_servant: 'Servidor público', self_employed: 'Autônomo/MEI', other: 'Outra situação' };
  let stateFilter = '';

  async function oportunidades() {
    const d = await api.wa.call('GET', '/oportunidades');
    const c = d.counts;
    const box = el('div', { class: 'bo-stack' });
    const sel = el('select', { class: 'input input-sm', 'aria-label': 'Filtrar por situação do envio' }, el('option', { value: '' }, 'Todos'), ...Object.entries(STATE).map(([k, [l]]) => el('option', { value: k }, `${l} (${int(c[k] ?? 0)})`)));
    sel.value = stateFilter;
    const paint = () => {
      const items = d.items.filter((x) => !stateFilter || x.state === stateFilter);
      box.replaceChildren(table(
        [
          { label: 'Contato', render: (x) => el('span', { class: 'bo-stack-sm' }, el('strong', {}, x.name ?? 'Sem nome'), el('span', { class: 'fine muted' }, x.phone ?? '—')) },
          { label: 'Parceiro', render: (x) => (x.partner ? el('span', { class: 'bo-stack-sm' }, el('span', {}, x.partner), el('span', { class: 'fine muted' }, x.campaign ?? '')) : el('span', { class: 'muted' }, '—')) },
          { label: 'Situação', render: (x) => el('span', { class: 'bo-stack-sm' }, badge(...STATE[x.state]), el('span', { class: 'fine muted' }, x.state === 'enviado' && x.deliveredAt ? dt(x.deliveredAt) : x.attempts ? `${x.attempts} ${x.attempts === 1 ? 'tentativa' : 'tentativas'}${x.httpCode ? ` · resposta ${x.httpCode}` : ''}` : '')) },
          { label: 'Perfil', render: (x) => el('span', { class: 'bo-stack-sm' }, el('span', {}, `${EMP[x.employment] ?? '—'} · ${x.ageBand ?? '—'} · ${x.uf ?? '—'}`), el('span', { class: 'fine muted' }, `renda ${x.incomeBand ?? '—'} · dívidas ${x.debtBand ?? '—'}`)) },
          { label: 'Autorizou em', render: (x) => dt(x.createdAt) },
        ],
        items,
        { emptyText: 'Nada por aqui ainda. Quem pedir para falar com um parceiro aparece nesta lista.' },
      ));
    };
    sel.addEventListener('change', () => { stateFilter = sel.value; paint(); });
    paint();
    return el('div', { class: 'bo-stack' },
      kpis(
        kpi('Autorizaram', int(c.total), 'pediram para falar com um parceiro'),
        kpi('Enviados', int(c.enviado + c.contatado + c.contratado), 'chegaram ao parceiro', c.enviado + c.contatado + c.contratado ? 'good' : ''),
        kpi('Pendentes', int(c.pendente + c.tentando), 'o envio tenta sozinho', c.pendente + c.tentando ? 'warn' : ''),
        kpi('Falharam', int(c.falhou), 'esgotaram as tentativas', c.falhou ? 'bad' : ''),
        kpi('Sem parceiro', int(c.sem_parceiro), 'nenhuma campanha serviu'),
      ),
      card(
        'Envio aos parceiros',
        el('div', { class: 'bo-filters' }, sel),
        box,
        cardOpts({ sub: 'Automático: ao autorizar, o contato vai ao parceiro pelo webhook (ou fica no portal dele) e o retorno do parceiro (já falou, contratou) volta para esta lista. Telefones aparecem mascarados.' }),
      ),
      d.truncated ? el('p', { class: 'fine muted' }, 'A lista mostra os 500 envios mais recentes.') : null,
    );
  }
  // ------------------------------------------------------------------------------------------ Modelos
  // Lista dos modelos salvos (o que já foi aprovado na Bird) com ver, editar, excluir, situação, busca e filtro.
  const tplFilter = { q: '', status: '' };
  const preview = (t, filled = null) => t.body.replace(/\{\{(\d+)\}\}/g, (_, n) => (filled ? filled[Number(n) - 1] || `[${t.paramNames?.[Number(n) - 1] ?? `variável ${n}`}]` : `[${t.paramNames?.[Number(n) - 1] ?? `variável ${n}`}]`));

  function templateEditor(t, done) {
    const d = drawer(t ? `Editar modelo: ${t.name}` : 'Novo modelo');
    const name = el('input', { class: 'input', id: 'wt-name', type: 'text', maxlength: '60', placeholder: 'ex.: folego-boas-vindas', value: t?.name ?? '' });
    const cat = el('select', { class: 'input', id: 'wt-cat' }, el('option', { value: 'MARKETING' }, 'Marketing (cobrado pela Meta)'), el('option', { value: 'UTILITY' }, 'Utilidade (aviso sobre algo que o cliente pediu)'));
    cat.value = t?.category ?? 'MARKETING';
    const lang = el('input', { class: 'input', id: 'wt-lang', type: 'text', value: t?.language ?? 'pt_BR', maxlength: '5' });
    const body = el('textarea', { class: 'input', id: 'wt-body', rows: '9', maxlength: '1024', placeholder: 'Olá {{1}}, aqui é a equipe do Fôlego…' }, t?.body ?? '');
    const names = el('input', { class: 'input', id: 'wt-names', type: 'text', placeholder: 'nome_do_cliente, codigo', value: t?.paramNames?.join(', ') ?? '' });
    const projectId = el('input', { class: 'input', id: 'wt-pid', type: 'text', placeholder: 'ex.: c6227d49-0400-4925-ba7d-07aa302ea3ad', value: t?.birdProjectId ?? '', autocomplete: 'off', spellcheck: 'false' });
    const versionId = el('input', { class: 'input', id: 'wt-ver', type: 'text', placeholder: 'ex.: c3ffd3fe-2b02-4fd5-91cb-d7650f599e8b', value: t?.birdVersion ?? '', autocomplete: 'off', spellcheck: 'false' });
    const save = el('button', { class: 'btn btn-primary', type: 'submit' }, t ? 'Salvar alterações' : 'Salvar modelo');
    const form = el('form', { class: 'tool-form' },
      field('Identificador do modelo na Bird (slug)', name, 'Pode digitar como na Bird (ex.: Fôlego Indicação Prumo): vira folego-indicacao-prumo ao salvar.'),
      field('Categoria', cat), field('Idioma', lang),
      field('Texto', body, 'Use {{1}}, {{2}} para as partes que mudam. Copie o texto exatamente como foi aprovado.'),
      field('Nome das variáveis (só se o modelo da Bird usa variáveis nomeadas)', names, 'Separe por vírgula, na ordem de {{1}}, {{2}}…'),
      field('ID do projeto na Bird', projectId, 'Na Bird: Marketing > Modelos de mensagem > abra o modelo > "ID do Projeto". Necessário para enviar.'),
      field('ID da versão publicada na Bird', versionId, 'Na mesma tela: "ID da versão publicada". Se você publicar uma nova versão, atualize aqui.'),
      t ? el('p', { class: 'note note-amber' }, icon('info'), el('span', {}, 'Ao editar, a situação (Aprovado etc.) continua a mesma. Só mude o texto se ele também foi alterado na Bird.')) : null,
      save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        const paramNames = names.value.split(',').map((s) => s.trim()).filter(Boolean);
        const slug = name.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
        name.value = slug;
        const payload = { name: slug, category: cat.value, language: lang.value.trim() || 'pt_BR', body: body.value.trim(), paramNames, birdProjectId: projectId.value.trim(), birdVersion: versionId.value.trim() };
        if (t) await api.wa.call('PUT', `/templates/${t.id}`, payload);
        else await api.wa.call('POST', '/templates', paramNames.length ? payload : { ...payload, paramNames: undefined });
        toast(t ? 'Modelo atualizado.' : 'Modelo salvo. Marque como aprovado quando a Bird confirmar.');
        d.close();
        done();
      } catch (err) { save.disabled = false; toast(err.message); }
    });
    d.body.append(form);
  }

  function templateView(t) {
    const d = drawer(t.name);
    const bubble = el('div', { class: 'bo-tpl-bubble' }, preview(t));
    const copy = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('copy'), 'Copiar texto');
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(t.body); toast('Texto copiado.'); } catch { toast('Não consegui copiar. Selecione e copie.'); } });
    const [label, tone] = TPL_STATUS[t.status] ?? [t.status, 'muted'];
    d.body.append(
      dl([['Situação', badge(label, tone)], ['Categoria', t.category === 'MARKETING' ? 'Marketing' : 'Utilidade'], ['Idioma', t.language], ['Variáveis', t.slots ? (t.paramNames?.length ? t.paramNames.map((n, i) => `{{${i + 1}}} = ${n}`).join(' · ') : `${t.slots} (posicionais)`) : 'nenhuma'], ['Criado em', dt(t.createdAt)]]),
      el('h3', { class: 'bo-sub' }, 'Como a pessoa vê (variáveis entre colchetes)'), bubble,
      el('h3', { class: 'bo-sub' }, 'Texto cadastrado'), el('pre', { class: 'bo-pre' }, t.body),
      el('div', { class: 'bo-actions' }, copy));
  }

  async function modelos() {
    const { templates } = await api.wa.call('GET', '/templates');
    const count = (s) => templates.filter((t) => t.status === s).length;
    const q = el('input', { class: 'input input-sm', type: 'search', placeholder: 'Buscar por nome ou texto', 'aria-label': 'Buscar modelo', value: tplFilter.q });
    q.addEventListener('input', () => { tplFilter.q = q.value; paint(); });
    const st = el('select', { class: 'input input-sm', 'aria-label': 'Filtrar por situação' }, el('option', { value: '' }, 'Todas as situações'), ...Object.entries(TPL_STATUS).map(([v, [l]]) => el('option', { value: v }, l)));
    st.value = tplFilter.status;
    st.addEventListener('change', () => { tplFilter.status = st.value; paint(); });
    const add = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('plus'), 'Novo modelo');
    add.addEventListener('click', () => templateEditor(null, draw));
    const holder = el('div', {});
    const paint = () => {
      const f = templates.filter((t) => (!tplFilter.status || t.status === tplFilter.status) && (!tplFilter.q || `${t.name} ${t.body}`.toLowerCase().includes(tplFilter.q.toLowerCase())));
      holder.replaceChildren(table([
        { label: 'Modelo', render: (t) => el('span', {}, el('strong', {}, t.name), el('br'), el('small', { class: 'muted' }, t.body.length > 110 ? `${t.body.slice(0, 110)}…` : t.body)) },
        { label: 'Categoria', render: (t) => (t.category === 'MARKETING' ? 'Marketing' : 'Utilidade') },
        { label: 'Variáveis', render: (t) => (t.slots ? (t.paramNames?.length ? t.paramNames.join(', ') : `${t.slots}`) : '—') },
        { label: 'Situação', render: (t) => {
          const sel = el('select', { class: 'input input-sm', 'aria-label': `Situação de ${t.name}` }, ...Object.entries(TPL_STATUS).map(([v, [l]]) => el('option', { value: v }, l)));
          sel.value = t.status;
          sel.addEventListener('change', async () => { try { await api.wa.call('PATCH', `/templates/${t.id}`, { status: sel.value }); t.status = sel.value; toast('Situação atualizada.'); draw(); } catch (err) { toast(err.message); } });
          return sel;
        } },
        { label: 'Ações', render: (t) => {
          const view = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Ver ${t.name}` }, 'Ver');
          view.addEventListener('click', () => templateView(t));
          const edit = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Editar ${t.name}` }, 'Editar');
          edit.addEventListener('click', () => templateEditor(t, draw));
          const del = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Excluir ${t.name}` }, icon('trash'));
          del.addEventListener('click', async () => {
            if (!(await confirmDialog({ title: `Excluir o modelo ${t.name}?`, text: 'Só dá para excluir modelos que ainda não foram usados em mensagens. Se já foi usado, marque como Rejeitado.', confirmLabel: 'Excluir', danger: true }))) return;
            try { await api.wa.call('DELETE', `/templates/${t.id}`); toast('Modelo excluído.'); draw(); } catch (err) { toast(err.message); }
          });
          return el('span', { class: 'bo-actions' }, view, edit, del);
        } },
      ], f, { emptyText: templates.length ? 'Nenhum modelo com esse filtro.' : 'Nenhum modelo ainda. Clique em "Novo modelo" e cadastre os que você aprovou na Bird.' }));
    };
    paint();
    return el('div', { class: 'bo-stack' },
      card(`Modelos salvos (${templates.length})`,
        el('p', { class: 'muted' }, `${count('aprovado')} aprovado(s) · ${count('em_analise')} em análise · ${count('rascunho')} rascunho(s) · ${count('rejeitado')} rejeitado(s)`),
        el('div', { class: 'bo-toolbar' }, q, st, add), holder,
        cardOpts({ sub: 'Para começar uma conversa (ou falar depois de 24 h sem resposta) o WhatsApp exige um modelo aprovado. Crie e aprove na Bird; depois cadastre aqui com o mesmo identificador e marque "Aprovado".' })));
  }

  // ------------------------------------------------------------------------------------------ Conexão
  function conexao() {
    if (!acc.configured) {
      return card('WhatsApp do Fôlego ainda não está ligado', el('p', {}, acc.note ?? 'Falta a chave da Bird no servidor.'), el('ol', { class: 'bo-steps' },
        el('li', {}, 'Na Bird, crie uma chave de API e cadastre no GitHub o segredo ', el('code', {}, 'BIRD_API_KEY'), '.'),
        el('li', {}, 'Cadastre também ', el('code', {}, 'BIRD_WEBHOOK_SECRET'), ' (segredo de assinatura do webhook) e, se precisar, ', el('code', {}, 'BIRD_WHATSAPP_FROM'), ' (padrão +5511913792370).'),
        el('li', {}, 'Publique de novo. Esta tela passa a mostrar as conversas do número.')));
    }
    const copy = (value) => {
      const b = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Copiar');
      b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(value); toast('Copiado.'); } catch { toast('Não consegui copiar. Selecione e copie.'); } });
      return b;
    };
    const test = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Testar conexão');
    test.addEventListener('click', async () => {
      test.disabled = true;
      try { const r = await api.wa.call('POST', '/account/test'); toast(`Número configurado: ${r.displayPhone ?? 'ok'}.`); } catch (err) { toast(err.message); }
      test.disabled = false;
    });
    const pause = el('button', { class: 'btn btn-quiet', type: 'button' }, acc.status === 'ativa' ? 'Pausar envios' : 'Reativar envios');
    pause.addEventListener('click', async () => { try { await api.wa.call('PUT', '/account', { status: acc.status === 'ativa' ? 'pausada' : 'ativa' }); draw(); } catch (err) { toast(err.message); } });
    const cap = el('input', { class: 'input', id: 'wc-cap', type: 'text', inputmode: 'numeric', value: String(acc.dailyCap ?? 200) });
    const hours = Array.from({ length: 24 }, (_, h) => h);
    const mk = (id, v) => { const s = el('select', { class: 'input', id }, ...hours.map((h) => el('option', { value: String(h) }, `${String(h).padStart(2, '0')}h`))); s.value = String(v); return s; };
    const qs = mk('wc-qs', acc.quietStart ?? 20);
    const qe = mk('wc-qe', acc.quietEnd ?? 8);
    const save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar limites');
    const form = el('form', { class: 'tool-form' }, field('Modelos por dia (teto)', cap, 'Protege a qualidade do número. Respostas de atendimento não contam.'), field('Sem modelos a partir de', qs), field('Até', qe), save);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try { await api.wa.call('PUT', '/account', { dailyCap: Number(cap.value) || 200, quietStart: Number(qs.value), quietEnd: Number(qe.value) }); toast('Limites salvos.'); draw(); } catch (err) { save.disabled = false; toast(err.message); }
    });
    return el('div', { class: 'bo-stack' },
      card(`Conectado: ${acc.displayPhone ?? ''}`,
        el('p', { class: 'muted' }, `Hoje: ${int(acc.usedToday ?? 0)} de ${int(acc.dailyCap)} modelos. ${acc.status === 'ativa' ? 'Envios ativos.' : 'Envios pausados.'} Envio pela Bird (WhatsApp Business API).`),
        el('div', { class: 'bo-actions' }, test, pause)),
      card('Avisos da Bird (webhook)',
        el('p', { class: 'muted' }, 'Na Bird, aponte o webhook para este endereço com os eventos whatsapp.* (aceita, enviada, entregue, lida, falhou, recebida). É por ele que as mensagens dos clientes chegam aqui.'),
        el('p', {}, el('code', {}, acc.webhookUrl), ' ', copy(acc.webhookUrl))),
      card('Limites e horário de silêncio', form),
      card('Perfil do número', el('p', { class: 'muted' }, 'Foto, recado, descrição, e-mail e site do número são editados no painel da Bird (WhatsApp > Perfil). A foto e as observações de cada contato são editadas na própria conversa.')));
  }

  draw();
  return host;
}
