// WhatsApp do Fôlego (número +55 11 91379-2370, pela Bird): caixa de entrada completa, modelos e conexão.
// Mesmo componente do portal do parceiro (wa-inbox.js); aqui o servidor é o do Fôlego e as regras da Meta/Bird valem igual.
import { api } from '../api.js';
import { waInbox } from '../../wa-inbox.js';
import { el, icon, toast, card, cardOpts, tabs, table, field, int } from '../ui.js';
import { confirmDialog } from '../../confirm.js';

const TPL_STATUS = { rascunho: 'Rascunho', em_analise: 'Em análise', aprovado: 'Aprovado', rejeitado: 'Rejeitado' };

export async function whatsappScreen() {
  const host = el('div', { class: 'bo-stack' });
  const st = { tab: 'conversas' };
  let inbox = null;
  const stopInbox = () => { inbox?.stop(); inbox = null; };
  let acc = await api.wa.call('GET', '/account');
  if (!acc.configured) st.tab = 'conexao';

  const bar = () => tabs([['conversas', 'Conversas'], ['modelos', 'Modelos'], ['conexao', 'Conexão']], st.tab, (t) => { st.tab = t; draw(); });

  async function draw() {
    stopInbox();
    host.replaceChildren(bar(), el('p', { class: 'muted bo-loading', role: 'status' }, 'Carregando…'));
    try {
      acc = await api.wa.call('GET', '/account');
      if (!acc.configured && st.tab !== 'conexao') st.tab = 'conexao';
      const body = st.tab === 'conversas' ? conversas() : st.tab === 'modelos' ? await modelos() : conexao();
      host.replaceChildren(bar(), body);
    } catch (e) {
      host.replaceChildren(bar(), el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, e.message)));
    }
  }

  // ------------------------------------------------------------------------------------------ Conversas
  function conversas() {
    inbox = waInbox({ host: api.wa, features: { agent: false } });
    return el('div', { class: 'bo-wa' }, inbox.node);
  }

  // ------------------------------------------------------------------------------------------ Modelos
  async function modelos() {
    const { templates } = await api.wa.call('GET', '/templates');
    const name = el('input', { class: 'input', id: 'wt-name', type: 'text', maxlength: '60', placeholder: 'ex.: folego-boas-vindas' });
    const cat = el('select', { class: 'input', id: 'wt-cat' }, el('option', { value: 'MARKETING' }, 'Marketing (cobrado pela Meta)'), el('option', { value: 'UTILITY' }, 'Utilidade (aviso sobre algo que o cliente pediu)'));
    const lang = el('input', { class: 'input', id: 'wt-lang', type: 'text', value: 'pt_BR', maxlength: '5' });
    const body = el('textarea', { class: 'input', id: 'wt-body', rows: '4', maxlength: '1024', placeholder: 'Olá {{1}}, aqui é a equipe do Fôlego…' });
    const names = el('input', { class: 'input', id: 'wt-names', type: 'text', placeholder: 'nome_do_cliente, codigo' });
    const add = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar modelo');
    const form = el('form', { class: 'tool-form' },
      field('Identificador do modelo na Bird (slug)', name, 'Igual ao que aparece na Bird: minúsculas, números, _ e -.'),
      field('Categoria', cat), field('Idioma', lang),
      field('Texto', body, 'Use {{1}}, {{2}} para as partes que mudam. Copie o texto exatamente como foi aprovado.'),
      field('Nome das variáveis (só se o modelo da Bird usa variáveis nomeadas)', names, 'Separe por vírgula, na ordem de {{1}}, {{2}}…'),
      add);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      add.disabled = true;
      try {
        const paramNames = names.value.split(',').map((s) => s.trim()).filter(Boolean);
        await api.wa.call('POST', '/templates', { name: name.value.trim(), category: cat.value, language: lang.value.trim() || 'pt_BR', body: body.value.trim(), ...(paramNames.length ? { paramNames } : {}) });
        toast('Modelo salvo. Marque como aprovado quando a Bird confirmar.');
        draw();
      } catch (err) { add.disabled = false; toast(err.message); }
    });
    const list = table([
      { label: 'Modelo', render: (t) => el('span', {}, el('strong', {}, t.name), el('span', { class: 'muted' }, ` · ${t.language}${t.paramNames ? ` · variáveis: ${t.paramNames.join(', ')}` : ''}`), el('br'), el('small', { class: 'muted' }, t.body)) },
      { label: 'Situação', render: (t) => {
        const sel = el('select', { class: 'input input-sm', 'aria-label': `Situação de ${t.name}` }, ...Object.entries(TPL_STATUS).map(([v, l]) => el('option', { value: v }, l)));
        sel.value = t.status;
        sel.addEventListener('change', async () => { try { await api.wa.call('PATCH', `/templates/${t.id}`, { status: sel.value }); toast('Situação atualizada.'); } catch (err) { toast(err.message); } });
        return sel;
      } },
      { label: '', render: (t) => {
        const del = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Apagar ${t.name}` }, icon('trash'));
        del.addEventListener('click', async () => {
          if (!(await confirmDialog({ title: `Apagar o modelo ${t.name}?`, text: 'Só dá para apagar modelos que ainda não foram usados.', confirmLabel: 'Apagar', danger: true }))) return;
          try { await api.wa.call('DELETE', `/templates/${t.id}`); draw(); } catch (err) { toast(err.message); }
        });
        return del;
      } },
    ], templates, { emptyText: 'Nenhum modelo ainda. Cadastre abaixo os que você aprovou na Bird.' });
    return el('div', { class: 'bo-stack' },
      card('Modelos aprovados', list, cardOpts({ sub: 'Para começar uma conversa (ou falar depois de 24 h sem resposta) o WhatsApp exige um modelo aprovado. Crie e aprove na Bird; depois cadastre aqui com o mesmo identificador e marque "Aprovado".' })),
      card('Novo modelo', form));
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
