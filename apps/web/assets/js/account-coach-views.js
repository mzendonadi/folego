// Assinatura: abas "Coach" (nota de saúde, foco do dia, jornadas e métodos) e "Mercado" (cenário econômico).
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const PLAN_NAME = { controle: 'Controle', ousado: 'Ousado', desbravador: 'Desbravador' };
const LEVEL_CLASS = { critico: 'tone-bad', atencao: 'tone-warn', bom: 'tone-ok', otimo: 'tone-ok' };

function svgLine(points, { label }) {
  const NS = 'http://www.w3.org/2000/svg';
  const w = 280;
  const h = 64;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  if (points.length < 2) return svg;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * (w - 8) + 4).toFixed(1)},${(h - 6 - ((p.value - lo) / span) * (h - 14)).toFixed(1)}`).join(' ');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  svg.append(path);
  return svg;
}

export function viewCoach(ctx) {
  const o = ctx.overview;
  const h = o.health;
  const gauge = el(
    'div', { class: 'health' },
    el('div', { class: `health-score ${LEVEL_CLASS[h.level]}`, role: 'img', 'aria-label': `Nota de saúde financeira: ${h.score} de 100` }, el('strong', {}, String(h.score)), el('span', {}, '/100')),
    el('div', {}, el('h2', {}, 'Sua saúde financeira'), el('p', { class: 'muted' }, h.hasData ? h.label : 'Lance seus gastos e entradas para calcular a sua nota.')),
  );
  const parts = el(
    'ul', { class: 'health-parts' },
    ...h.parts.map((p) => el(
      'li', {},
      el('div', { class: 'health-part-top' }, el('strong', {}, p.label), el('span', { class: 'fine' }, `${p.score}/${p.max}`)),
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round((p.score / p.max) * 100)), 'aria-label': p.label }, el('i', { style: `width:${Math.round((p.score / p.max) * 100)}%` })),
      el('p', { class: 'fine muted' }, p.detail),
    )),
  );
  const f = o.focus;
  const doIt = f.tab ? el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Ir fazer agora', icon('arrow-right')) : null;
  doIt?.addEventListener('click', () => ctx.goTab(f.tab));
  const focus = card(
    el('h2', {}, 'Seu foco de hoje'),
    el('p', {}, el('strong', {}, f.text)),
    f.journey ? el('p', { class: 'fine muted' }, `Da jornada "${f.journey}".`) : el('p', { class: 'fine muted' }, 'Esta é a parte da sua nota que mais pode melhorar. Escolha uma jornada abaixo para ter um passo a passo.'),
    o.upcoming.length ? el('p', { class: 'fine' }, `Vence nos próximos dias: ${o.upcoming.map((u) => `${u.title} (${new Date(`${u.dueOn}T12:00:00`).toLocaleDateString('pt-BR')})`).join(', ')}.`) : null,
    doIt ? el('div', { class: 'button-row no-print' }, doIt) : null,
  );

  const journeys = o.journeys.map((j) => {
    const act = el('button', { class: `btn ${j.started ? 'btn-quiet' : 'btn-primary'} btn-sm`, type: 'button' }, j.locked ? `Plano ${PLAN_NAME[j.minPlan]}` : j.started ? 'Pausar jornada' : 'Começar jornada');
    act.addEventListener('click', async () => {
      if (j.locked) return ctx.goTab('plano');
      act.disabled = true;
      try {
        if (j.started) await ctx.api.stopJourney(j.id);
        else await ctx.api.startJourney(j.id);
        ctx.refresh();
      } catch {
        act.disabled = false;
        toast('Não consegui agora.');
      }
    });
    return el(
      'details', { class: `journey${j.locked ? ' is-locked' : ''}`, open: j.started && !j.complete },
      el('summary', {}, el('span', { class: 'journey-title' }, j.locked ? icon('lock', 'icon icon-lock') : null, j.title), el('span', { class: 'pill' }, j.locked ? `Plano ${PLAN_NAME[j.minPlan]}` : `${j.doneCount}/${j.missions.length}`)),
      el('p', { class: 'muted' }, j.promise),
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(j.progressPct), 'aria-label': `Progresso: ${j.title}` }, el('i', { style: `width:${j.progressPct}%` })),
      j.locked ? null : el('ol', { class: 'missions' }, ...j.missions.map((m) => el('li', { class: m.done ? 'is-done' : '' }, el('span', { class: 'mission-mark', 'aria-hidden': 'true' }, m.done ? '✓' : '○'), el('span', {}, el('strong', {}, m.text), el('span', { class: 'fine muted' }, ` ${m.why}`), el('span', { class: 'sr-only' }, m.done ? ' (feita)' : ' (pendente)'))))),
      el('div', { class: 'button-row no-print' }, act),
    );
  });

  const methods = o.methods.map((m) => el(
    'details', { class: `method${m.locked ? ' is-locked' : ''}` },
    el('summary', {}, m.locked ? icon('lock', 'icon icon-lock') : null, m.title, m.locked ? el('span', { class: 'pill' }, `Plano ${PLAN_NAME[m.minPlan]}`) : null),
    el('p', {}, m.summary),
    m.locked ? null : el('ol', {}, ...m.steps.map((s) => el('li', {}, s))),
    !m.locked && m.yours ? el('p', { class: 'note note-green' }, icon('check'), el('span', {}, m.yours)) : null,
  ));

  return el(
    'div', { class: 'acc-stack' },
    card(gauge, parts),
    focus,
    card(el('h2', {}, 'Jornadas de transformação'), el('p', { class: 'section-sub' }, 'Cada jornada tem missões que se confirmam sozinhas conforme você usa o Fôlego. Sem tarefa manual, sem enrolação.'), el('div', { class: 'journeys' }, ...journeys)),
    card(el('h2', {}, 'Métodos que funcionam'), el('p', { class: 'section-sub' }, 'Técnicas de planejamento financeiro, aplicadas aos seus números quando dá.'), el('div', { class: 'journeys' }, ...methods)),
  );
}

export function viewMercado(ctx) {
  const m = ctx.market;
  if (!m.hasData) return card(el('h2', {}, 'Cenário econômico'), el('p', { class: 'muted' }, 'Os indicadores do Banco Central ainda estão sendo carregados. Volte em alguns minutos.'));
  const i = m.indicators;
  const trendText = (v, unit) => (v === null || Math.abs(v) < 0.005 ? 'estável em 3 meses' : `${v > 0 ? 'subiu' : 'caiu'} ${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}${unit} em 3 meses`);
  const tile = (title, value, sub, history) => el('div', { class: 'indicator' }, el('span', { class: 'fine muted' }, title), el('strong', { class: 'indicator-value' }, value), el('span', { class: 'fine' }, sub), history ? svgLine(history, { label: `Evolução: ${title}` }) : null);
  const pct = (v) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
  const tiles = el(
    'div', { class: 'indicators' },
    tile('Selic (meta)', pct(i.selicPct), trendText(i.selicTrend, ' p.p.'), m.history?.selic),
    tile('Inflação (IPCA 12 meses)', pct(i.ipca12Pct), trendText(i.ipcaTrend, ' p.p.'), m.history?.ipca12),
    tile('CDI (ao ano)', pct(i.cdiPct), 'rendimento base da renda fixa', m.history?.cdi),
    i.usdBrl !== null ? tile('Dólar', `R$ ${i.usdBrl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, trendText(i.usdTrend, ' R$'), m.history?.usd) : el('div', { class: 'indicator is-locked' }, icon('lock', 'icon icon-lock'), el('span', { class: 'fine' }, 'Dólar e histórico de 12 meses no plano Desbravador')),
  );
  const insights = m.insights.map((x) => x.locked
    ? el('li', { class: 'insight is-locked' }, icon('lock', 'icon icon-lock'), el('strong', {}, x.title), el('span', { class: 'pill' }, `Plano ${PLAN_NAME[x.minPlan]}`))
    : el('li', { class: `insight tone-${x.tone}` }, el('strong', {}, x.title), el('p', {}, x.text)));
  return el(
    'div', { class: 'acc-stack' },
    card(el('h2', {}, 'Cenário econômico'), el('p', { class: 'section-sub' }, `Fonte: ${m.source}. Atualizado em ${new Date(m.updatedAt).toLocaleDateString('pt-BR')}.`), tiles),
    card(el('h2', {}, 'O que isso significa para você'), el('ul', { class: 'insights' }, ...insights), el('p', { class: 'fine muted' }, 'Informação educativa, não é recomendação de investimento. Os indicadores são oficiais; a leitura é feita com as regras do Fôlego e os seus dados.')),
  );
}

export { brl };
