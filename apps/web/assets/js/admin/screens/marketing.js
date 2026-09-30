// Marketing e relacionamento: insights calculados dos dados reais, públicos para campanhas, quadro de planejamento e calendário.
import { api } from '../api.js';
import { el, icon, toast, int, day, card, table, tabs, badge, field, periodSelect, loading, errorBox, empty, drawer } from '../ui.js';
import { copyText } from '../../dom.js';
import { confirmDialog } from '../../confirm.js';

const AREA = { aquisicao: 'Aquisição', conversao: 'Conversão', receita: 'Receita', retencao: 'Retenção', parcerias: 'Parcerias', produto: 'Produto', dados: 'Dados' };
const PRIORITY = { alta: ['Prioridade alta', 'bad'], media: ['Prioridade média', 'warn'], baixa: ['Prioridade baixa', 'muted'] };
const STATUS = [['ideia', 'Ideias'], ['planejado', 'Planejado'], ['em_andamento', 'Em andamento'], ['concluido', 'Concluído'], ['pausado', 'Pausado']];

/** Formulário de item do planejamento (novo ou edição), numa gaveta. */
function planForm(initial, onSaved) {
  const dw = drawer(initial.id ? 'Editar item' : 'Novo item de planejamento');
  const f = {
    title: el('input', { class: 'input', type: 'text', maxlength: '140', value: initial.title ?? '' }),
    goal: el('input', { class: 'input', type: 'text', maxlength: '400', value: initial.goal ?? '', placeholder: 'Ex.: renovar 60% dos que vencem' }),
    segment: el('input', { class: 'input', type: 'text', maxlength: '200', value: initial.segment ?? '', placeholder: 'Ex.: assinantes em débito' }),
    channel: el('input', { class: 'input', type: 'text', maxlength: '120', value: initial.channel ?? '', placeholder: 'Ex.: e-mail, Instagram, parceria' }),
    status: el('select', { class: 'input' }, ...STATUS.map(([v, l]) => el('option', { value: v, selected: v === (initial.status ?? 'planejado') }, l))),
    dueOn: el('input', { class: 'input', type: 'date', value: initial.dueOn ?? '' }),
    notes: el('textarea', { class: 'input', rows: '5', maxlength: '2000' }),
  };
  f.notes.value = initial.notes ?? '';
  const save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar');
  const form = el('form', { class: 'bo-form' }, field('Título', f.title), field('Objetivo', f.goal), field('Público', f.segment), field('Canal', f.channel), field('Situação', f.status), field('Prazo', f.dueOn), field('Notas', f.notes), save);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (f.title.value.trim().length < 3) return toast('Dê um título ao item.');
    const body = { title: f.title.value.trim(), goal: f.goal.value, segment: f.segment.value, channel: f.channel.value, status: f.status.value, dueOn: f.dueOn.value || null, notes: f.notes.value };
    save.disabled = true;
    try {
      if (initial.id) await api.salvarPlano(initial.id, body);
      else await api.criarPlano(body);
      toast('Salvo.');
      dw.close();
      onSaved();
    } catch (err) {
      save.disabled = false;
      toast(err.message);
    }
  });
  dw.body.append(form);
}

export async function marketingScreen(ctx) {
  const st = ctx.state.marketing ?? (ctx.state.marketing = { tab: 'insights' });
  const host = el('div', { class: 'bo-stack' });
  let data = null;

  async function draw() {
    host.replaceChildren(loading());
    try {
      if (st.tab === 'planejamento') {
        const { plans } = await api.planos();
        host.replaceChildren(...[header(), planning(plans)]);
        return;
      }
      data = data && data.days === ctx.state.days ? data : await api.insights(ctx.state.days);
      host.replaceChildren(...[header(), st.tab === 'insights' ? insights(data) : st.tab === 'publicos' ? audiences(data) : calendar(data)]);
    } catch (e) {
      host.replaceChildren(errorBox(e, draw));
    }
  }

  function header() {
    return el('div', { class: 'bo-toolbar' }, tabs([['insights', 'Insights'], ['publicos', 'Públicos e mensagens'], ['planejamento', 'Planejamento'], ['calendario', 'Calendário']], st.tab, (t) => {
      st.tab = t;
      draw();
    }), st.tab === 'insights' || st.tab === 'publicos' ? periodSelect(ctx.state.days, (v) => ctx.setDays(v)) : null);
  }

  function insights(d) {
    return el(
      'div', { class: 'bo-stack' },
      d.note ? el('p', { class: 'note note-amber' }, icon('info'), el('span', {}, d.note)) : null,
      el('p', { class: 'muted bo-lead' }, `Cada insight nasce de uma regra sobre os seus dados dos últimos ${d.days === 3650 ? 'registros' : `${d.days} dias`} e mostra o número que o sustenta. Use "Planejar" para levar a ideia ao quadro.`),
      ...d.insights.map((i) => {
        const plan = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('plus'), 'Planejar');
        plan.addEventListener('click', () => planForm({ ...i.plan, status: 'ideia', notes: i.actions.map((a) => `• ${a}`).join('\n') }, () => { st.tab = 'planejamento'; draw(); }));
        return el(
          'article', { class: `bo-insight bo-insight-${i.priority}` },
          el('header', { class: 'bo-head-line' }, badge(AREA[i.area] ?? i.area, 'muted'), badge(...PRIORITY[i.priority])),
          el('h3', {}, i.title),
          el('p', { class: 'bo-evidence' }, i.evidence),
          el('ul', { class: 'bullets' }, ...i.actions.map((a) => el('li', {}, a))),
          i.plan ? el('div', { class: 'no-print' }, plan) : null,
        );
      }),
      d.insights.length === 0 ? empty('Ainda não há dados suficientes para gerar insights.') : null,
    );
  }

  function audiences(d) {
    return el(
      'div', { class: 'bo-stack' },
      el('p', { class: 'muted bo-lead' }, 'Tamanho de cada público para relacionamento, com o canal possível e a base legal. Aqui aparecem só contagens: o backoffice não exporta listas de contatos.'),
      ...d.audiences.map((a) => {
        const copy = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('copy'), 'Copiar mensagem');
        copy.addEventListener('click', async () => toast((await copyText(a.message)) ? 'Mensagem copiada.' : 'Não consegui copiar.'));
        const plan = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('plus'), 'Planejar campanha');
        plan.addEventListener('click', () => planForm({ title: `Campanha: ${a.name}`, goal: '', segment: a.name, channel: a.channel, status: 'ideia', notes: a.message }, () => { st.tab = 'planejamento'; draw(); }));
        return el('article', { class: 'bo-insight' }, el('header', { class: 'bo-head-line' }, el('h3', {}, a.name), badge(`${int(a.count)} pessoas`, a.count ? 'ok' : 'muted')), el('p', { class: 'muted' }, `Canal: ${a.channel}`), el('p', { class: 'fine' }, a.basis), el('blockquote', { class: 'quote' }, a.message), el('div', { class: 'bo-actions' }, copy, plan));
      }),
    );
  }

  function planning(plans) {
    const add = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, icon('plus'), 'Novo item');
    add.addEventListener('click', () => planForm({}, draw));
    const cols = STATUS.map(([id, label]) => {
      const items = plans.filter((p) => p.status === id);
      return el(
        'section', { class: 'bo-col', 'aria-label': label },
        el('h3', {}, label, el('span', { class: 'bo-tab-count' }, int(items.length))),
        ...items.map((p) => {
          const del = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-label': `Apagar ${p.title}` }, icon('trash'));
          del.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            if (!(await confirmDialog({ title: 'Apagar este item?', text: p.title, confirmLabel: 'Apagar', danger: true }))) return;
            await api.apagarPlano(p.id).catch((e) => toast(e.message));
            draw();
          });
          const open = el('button', { class: 'bo-plan', type: 'button' }, el('strong', {}, p.title), p.goal ? el('span', { class: 'muted' }, p.goal) : null, p.segment ? el('span', { class: 'fine' }, `Público: ${p.segment}`) : null, p.channel ? el('span', { class: 'fine' }, `Canal: ${p.channel}`) : null, p.dueOn ? el('span', { class: 'fine' }, `Prazo: ${day(p.dueOn)}`) : null);
          open.addEventListener('click', () => planForm(p, draw));
          return el('div', { class: 'bo-plan-wrap' }, open, del);
        }),
        items.length === 0 ? el('p', { class: 'fine' }, '—') : null,
      );
    });
    return el('div', { class: 'bo-stack' }, el('div', { class: 'bo-toolbar' }, el('p', { class: 'muted' }, 'Quadro de planejamento de marketing e relacionamento. Clique num cartão para editar e mude a situação conforme avança.'), add), el('div', { class: 'bo-board', tabindex: '0', role: 'region', 'aria-label': 'Quadro de planejamento (rola para o lado)' }, ...cols));
  }

  function calendar(d) {
    return card('Datas para planejar', el('p', { class: 'muted' }, 'Referências gerais de sazonalidade do endividamento no Brasil. Confirme as datas de cada ano antes de agendar.'), table([{ label: 'Quando', render: (c) => c.when }, { label: 'Tema', render: (c) => c.theme }, { label: 'Ideia', render: (c) => c.idea }], d.calendar));
  }

  await draw();
  return host;
}
