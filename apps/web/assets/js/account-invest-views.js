// Prumo > Investimentos e Estratégias (Desbravador).
// Investimentos: a pessoa lança o que aplicou; o Prumo mostra total investido, rendimento e imposto estimado, em "Ativos" e "Processando".
// Estratégias: "jogadas" calculadas com as contas, cartões, dívidas e aplicações dela + a análise completa do Estrategista (IA).
import { el, icon, toast } from './dom.js';
import { brl, todayISO } from './format.js';
import { moneyInput } from './money.js';
import { confirmDialog } from './confirm.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const dayBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const fmtPct = (n) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const field = (label, input, hint) => el('div', { class: 'field' }, el('label', { class: 'label', for: input.id }, label), input, hint ? el('p', { class: 'fine' }, hint) : null);
const select = (id, options, value) => el('select', { class: 'input', id }, ...options.map(([v, l]) => el('option', { value: String(v), ...(String(v) === String(value) ? { selected: true } : {}) }, l)));

const KIND = [['renda_fixa', 'Renda fixa (CDB, LCI, LCA...)'], ['tesouro', 'Tesouro Direto'], ['fundo', 'Fundo'], ['acoes', 'Ações e FIIs'], ['cripto', 'Cripto'], ['previdencia', 'Previdência'], ['poupanca', 'Poupança'], ['outro', 'Outro']];
const INDEXER = [['cdi', '% do CDI (pós-fixado)'], ['selic', '% da Selic'], ['prefixado', 'Prefixado (% ao ano)'], ['ipca', 'IPCA + (% ao ano)'], ['poupanca', 'Poupança'], ['outro', 'Outro / não sei']];
const rateText = (x) => (x.indexer === 'cdi' ? `${fmtPct(x.ratePct)} do CDI` : x.indexer === 'selic' ? `${fmtPct(x.ratePct)} da Selic` : x.indexer === 'prefixado' ? `${fmtPct(x.ratePct)} ao ano` : x.indexer === 'ipca' ? `IPCA + ${fmtPct(x.ratePct)} ao ano` : x.indexer === 'poupanca' ? 'Poupança' : '—');
const tagText = (x) => (x.indexer === 'cdi' || x.indexer === 'selic' ? 'PÓS-FIXADO' : x.indexer === 'prefixado' ? 'PREFIXADO' : x.indexer === 'ipca' ? 'INFLAÇÃO + FIXA' : 'OUTRO');

// "Esconder valores" (o olho da tela do banco): preferência só deste aparelho.
const hidden = { on: (() => { try { return localStorage.getItem('prumo.invest.hide') === '1'; } catch { return false; } })() };
const money = (cents) => (hidden.on ? 'R$ ••••' : brl(cents));

// ---------------------------------------------------------------- Investimentos
export function viewInvestimentos(ctx) {
  const root = el('div', { class: 'acc-stack inv' });
  let tab = 'ativos';

  async function show() {
    root.replaceChildren(card(el('p', { class: 'muted', role: 'status' }, 'Carregando…')));
    let data;
    try {
      data = await ctx.api.getInvestments();
    } catch {
      return root.replaceChildren(card(el('h2', {}, 'Não consegui carregar'), el('p', { class: 'muted' }, 'Confira a conexão e tente de novo.')));
    }
    draw(data);
  }

  function draw(data) {
    const t = data.totals;
    const eye = el('button', { class: 'btn btn-quiet btn-sm', type: 'button', 'aria-pressed': String(hidden.on) }, hidden.on ? 'Mostrar valores' : 'Esconder valores');
    eye.addEventListener('click', () => {
      hidden.on = !hidden.on;
      try { localStorage.setItem('prumo.invest.hide', hidden.on ? '1' : '0'); } catch { /* sem armazenamento: vale só nesta tela */ }
      draw(data);
    });
    const hero = card(
      el('div', { class: 'inv-hero' },
        el('div', {}, el('span', { class: 'muted' }, 'Total investido'), el('strong', { class: 'inv-total' }, money(t.positionCents + t.processingCents)),
          el('p', { class: 'inv-yield' }, 'Rendimento atual ', el('strong', { class: t.yieldCents >= 0 ? 'pos' : 'neg' }, hidden.on ? '••••' : `${t.yieldCents >= 0 ? '+' : ''}${brl(t.yieldCents)} (${fmtPct(t.yieldPct)})`))),
        eye),
      t.count + t.processingCount === 0 ? null : el('p', { class: 'fine muted' }, 'Rendimento estimado até hoje pelo CDI e pela taxa que você informou, sem descontar o imposto. A posição que aparece no app da corretora vale mais: informe-a ao editar uma aplicação.'));

    const seg = el('div', { class: 'seg inv-seg', role: 'tablist', 'aria-label': 'Situação das aplicações' },
      ...[['ativos', 'Ativos'], ['processando', `Processando${t.processingCount ? ` (${t.processingCount})` : ''}`]].map(([id, label]) => {
        const b = el('button', { class: 'seg-btn', type: 'button', role: 'tab', 'aria-selected': String(tab === id), 'aria-checked': String(tab === id) }, label);
        b.addEventListener('click', () => { tab = id; draw(data); });
        return b;
      }));

    const add = el('button', { class: 'btn btn-primary', type: 'button' }, icon('plus'), 'Lançar aplicação');
    add.addEventListener('click', () => form(null));

    const list = tab === 'ativos' ? activeCards(data) : processingCards(data);
    root.replaceChildren(...[
      hero,
      card(el('div', { class: 'button-row' }, seg, add), list),
      data.investments.some((x) => x.status === 'resgatado') ? card(el('h3', {}, 'Resgatadas'), el('ul', { class: 'entries' }, ...data.investments.filter((x) => x.status === 'resgatado').map((x) => row(x)))) : null,
    ].filter(Boolean));
  }

  function activeCards(data) {
    const items = data.investments.filter((x) => x.status === 'ativo');
    if (items.length === 0) return el('p', { class: 'muted' }, 'Nenhuma aplicação ativa ainda. Use "Lançar aplicação" para começar.');
    const groups = new Map();
    for (const x of items) {
      const key = `${x.name}|${x.indexer}|${x.ratePct}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(x);
    }
    return el('div', { class: 'inv-cards' }, ...[...groups.values()].map((g) => {
      const applied = g.reduce((s, x) => s + x.appliedCents, 0);
      const position = g.reduce((s, x) => s + x.view.positionCents, 0);
      const gain = position - applied;
      const head = el('button', { class: 'inv-card-head', type: 'button', 'aria-expanded': 'false' },
        el('span', { class: 'inv-pill' }, `${g.length} ${g.length === 1 ? 'APLICAÇÃO' : 'APLICAÇÕES'}`),
        el('strong', { class: 'inv-name' }, g[0].name),
        el('dl', { class: 'inv-dl' },
          el('div', {}, el('dt', {}, 'Posição'), el('dd', {}, money(position))),
          el('div', {}, el('dt', {}, 'Valor aplicado'), el('dd', {}, money(applied))),
          el('div', {}, el('dt', {}, 'Rendimento'), el('dd', { class: gain >= 0 ? 'pos' : 'neg' }, hidden.on ? 'R$ ••••' : brl(gain))),
          el('div', {}, el('dt', {}, 'Rentabilidade'), el('dd', {}, rateText(g[0])))),
        icon('chevron', 'icon lg-chev'));
      const body = el('div', { class: 'inv-card-body', hidden: true }, el('ul', { class: 'entries' }, ...g.map((x) => row(x))));
      head.addEventListener('click', () => { const open = body.hidden; body.hidden = !open; head.setAttribute('aria-expanded', String(open)); });
      return el('section', { class: 'inv-card' }, head, body);
    }));
  }

  function processingCards(data) {
    const items = data.investments.filter((x) => x.status === 'processando');
    if (items.length === 0) return el('p', { class: 'muted' }, 'Nada processando. Aplicações que ainda não foram creditadas na corretora ficam aqui até você marcá-las como ativas.');
    return el('div', { class: 'inv-cards' }, ...items.map((x) => {
      const edit = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Editar');
      edit.addEventListener('click', () => form(x));
      const done = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Processado');
      done.addEventListener('click', () => processForm(x));
      return el('section', { class: 'inv-card' }, el('div', { class: 'inv-card-head static' },
        el('span', { class: 'inv-pill' }, tagText(x)), el('strong', { class: 'inv-name' }, x.name),
        el('dl', { class: 'inv-dl' },
          el('div', {}, el('dt', {}, 'Valor aplicado'), el('dd', {}, money(x.appliedCents))),
          el('div', {}, el('dt', {}, 'Rentabilidade'), el('dd', {}, rateText(x))),
          el('div', {}, el('dt', {}, 'Data da aplicação'), el('dd', {}, dayBr(x.appliedOn)))),
        edit, done));
    }));
  }

  /** Uma aplicação dentro do cartão: detalhe, IR de hoje, editar e apagar. */
  function row(x) {
    const v = x.view;
    const edit = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Editar ${x.name}` }, icon('pencil'));
    edit.addEventListener('click', () => form(x));
    const del = el('button', { class: 'btn btn-quiet btn-sm icon-btn', type: 'button', 'aria-label': `Apagar ${x.name}` }, icon('trash'));
    del.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: `Apagar "${x.name}"?`, text: 'Some do Prumo (não mexe na sua corretora). Se você só resgatou, prefira editar e marcar como resgatada.', confirmLabel: 'Apagar', danger: true }))) return;
      try { await ctx.api.deleteInvestment(x.id); toast('Aplicação apagada.'); show(); } catch { toast('Não consegui apagar agora.'); }
    });
    return el('li', { class: 'wallet-row inv-row' },
      el('div', {},
        el('strong', {}, `${money(x.appliedCents)} em ${dayBr(x.appliedOn)}`),
        el('p', { class: 'muted fine' }, v
          ? `Posição ${money(v.positionCents)}${v.estimated ? ' (estimada)' : ''} · rendimento ${hidden.on ? '••••' : brl(v.yieldCents)} · IR hoje ${fmtPct(v.irPct)}, líquido ${hidden.on ? '••••' : brl(v.netYieldCents)} · ${x.liquidity === 'diaria' ? 'liquidez diária' : `vence ${x.maturesOn ? dayBr(x.maturesOn) : 'no vencimento'}`}`
          : `Resgatada · ${money(x.appliedCents)} aplicados em ${dayBr(x.appliedOn)}`)),
      el('span', {}), el('span', { class: 'ledger-actions' }, ...(x.status === 'ativo' ? [redeemBtn(x)] : []), edit, del));
  }

  function redeemBtn(x) {
    const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Resgatado');
    b.addEventListener('click', () => redeemForm(x));
    return b;
  }

  /** Resgate: quanto saiu da aplicação, em que dia e em qual conta o dinheiro entrou. */
  async function redeemForm(x) {
    let wallets = [];
    try { wallets = (await ctx.api.getWallets()).wallets ?? []; } catch { /* sem carteiras: o servidor avisa */ }
    if (wallets.length === 0) return toast('Cadastre antes a conta em que o dinheiro entrou, em Carteiras.');
    const value = moneyInput({ id: 'rs-valor', ariaLabel: 'Valor resgatado', value: x.view.positionCents });
    const day = el('input', { class: 'input', id: 'rs-data', type: 'date', max: todayISO(), value: todayISO() });
    const wallet = select('rs-conta', wallets.map((w) => [w.id, w.name]), (wallets.find((w) => w.kind === 'conta') ?? wallets[0]).id);
    const ok = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Registrar resgate');
    const back = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Voltar');
    back.addEventListener('click', show);
    const f = el('form', { class: 'entry-form form-std' },
      field('Valor resgatado (R$)', value.input, `Posição atual: ${brl(x.view.positionCents)}${x.view.estimated ? ' (estimada)' : ''}. Se resgatar menos, a aplicação continua com o restante.`),
      field('Dia do resgate', day), field('Entrou na conta', wallet, 'O valor entra a crédito nessa conta, mas não conta como receita do mês.'),
      el('div', { class: 'button-row' }, ok, back));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cents = value.cents();
      if (!cents) return toast('Informe o valor resgatado.');
      if (!day.value) return toast('Informe o dia do resgate.');
      ok.disabled = true;
      try {
        const r = await ctx.api.redeemInvestment(x.id, { amountCents: cents, date: day.value, walletId: wallet.value });
        toast(r.closed ? 'Resgate registrado. A aplicação foi encerrada.' : `Resgate registrado. Ficam ${brl(r.remainingCents)} aplicados.`);
        show();
      } catch (err) {
        ok.disabled = false;
        toast(err?.message && err.status === 422 ? err.message : 'Não consegui registrar agora.');
      }
    });
    root.replaceChildren(card(el('h2', {}, `Resgatar ${x.name}`), f));
  }

  /** Aplicação que estava processando e foi creditada: passa a valer como ativa a partir do dia informado. */
  function processForm(x) {
    const day = el('input', { class: 'input', id: 'pr-data', type: 'date', max: todayISO(), value: todayISO() });
    const ok = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Confirmar');
    const back = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Voltar');
    back.addEventListener('click', show);
    const f = el('form', { class: 'entry-form form-std' },
      field('Dia em que foi processada', day, `Os ${brl(x.appliedCents)} passam para Ativos a partir desse dia e deixam de aparecer em Processando.`),
      el('div', { class: 'button-row' }, ok, back));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!day.value) return toast('Informe o dia.');
      ok.disabled = true;
      try { await ctx.api.processInvestment(x.id, { date: day.value }); tab = 'ativos'; toast('Aplicação ativa.'); show(); } catch (err) { ok.disabled = false; toast(err?.message && err.status === 422 ? err.message : 'Não consegui registrar agora.'); }
    });
    root.replaceChildren(card(el('h2', {}, `${x.name}: processada`), f));
  }

  function form(existing) {
    const x = existing ?? { name: '', kind: 'renda_fixa', indexer: 'cdi', ratePct: 100, appliedCents: null, positionInformedCents: null, appliedOn: todayISO(), maturesOn: '', liquidity: 'diaria', status: 'ativo', note: '' };
    const name = el('input', { class: 'input', id: 'iv-nome', type: 'text', maxlength: '80', placeholder: 'Ex.: CDB PicPay Bank Liquidez', value: x.name });
    const kind = select('iv-tipo', KIND, x.kind);
    const indexer = select('iv-indexador', INDEXER, x.indexer);
    const rate = el('input', { class: 'input', id: 'iv-taxa', type: 'text', inputmode: 'decimal', maxlength: '7', value: String(x.ratePct).replace('.', ',') });
    const applied = moneyInput({ id: 'iv-valor', ariaLabel: 'Valor aplicado', value: x.appliedCents, placeholder: '0,00' });
    const position = moneyInput({ id: 'iv-posicao', ariaLabel: 'Posição atual', value: x.positionInformedCents, placeholder: 'Opcional' });
    const on = el('input', { class: 'input', id: 'iv-data', type: 'date', max: todayISO(), value: x.appliedOn });
    const matures = el('input', { class: 'input', id: 'iv-venc', type: 'date', value: x.maturesOn ?? '' });
    const liq = select('iv-liq', [['diaria', 'Diária (resgato quando quiser)'], ['vencimento', 'No vencimento']], x.liquidity);
    const status = select('iv-status', [['ativo', 'Ativo'], ['processando', 'Processando (ainda não creditado)'], ['resgatado', 'Resgatado']], x.status);
    const note = el('input', { class: 'input', id: 'iv-obs', type: 'text', maxlength: '200', placeholder: 'Opcional', value: x.note ?? '' });
    const save = el('button', { class: 'btn btn-primary', type: 'submit' }, existing ? 'Salvar' : 'Lançar aplicação');
    const back = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Voltar');
    back.addEventListener('click', show);
    const f = el('form', { class: 'entry-form form-std' },
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'iv-nome' }, 'Nome da aplicação'), name),
      field('Tipo', kind), field('Rende como', indexer),
      field('Taxa', rate, 'CDI: 102 vale 102% do CDI. Prefixado e IPCA+: % ao ano.'),
      field('Valor aplicado (R$)', applied.input), field('Data da aplicação', on),
      field('Posição atual (R$)', position.input, 'Opcional: o valor que o app da corretora mostra hoje. Sem ele, o Prumo estima.'),
      field('Liquidez', liq), field('Vencimento', matures), field('Situação', status),
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'iv-obs' }, 'Observação'), note),
      el('div', { class: 'button-row' }, save, back));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cents = applied.cents();
      // 102 (% do CDI) passa de 100: não dá para usar o conversor de juros, que só aceita até 100
      const n = Number(rate.value.trim().replace(/\./g, '').replace(',', '.'));
      const ratePct = rate.value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) / 100 : undefined;
      if (!name.value.trim()) return toast('Dê um nome à aplicação.');
      if (!cents) return toast('Informe o valor aplicado.');
      if (ratePct === undefined && indexer.value !== 'poupanca' && indexer.value !== 'outro') return toast('A taxa deve ser um número, como 102 ou 12,5.');
      if (!on.value) return toast('Informe a data da aplicação.');
      const body = {
        name: name.value.trim(), kind: kind.value, indexer: indexer.value, ratePct: ratePct ?? 0, appliedCents: cents,
        positionCents: position.cents() || null, appliedOn: on.value, maturesOn: matures.value || null, liquidity: liq.value, status: status.value, note: note.value.trim() || null,
      };
      save.disabled = true;
      try {
        if (existing) await ctx.api.updateInvestment(existing.id, body); else await ctx.api.createInvestment(body);
        toast(existing ? 'Aplicação atualizada.' : 'Aplicação lançada.');
        show();
      } catch (err) {
        save.disabled = false;
        toast(err?.status === 422 && err.message ? err.message : 'Não consegui salvar agora.');
      }
    });
    root.replaceChildren(card(el('h2', {}, existing ? 'Editar aplicação' : 'Lançar aplicação'), f));
  }

  show();
  return root;
}

// ---------------------------------------------------------------- Markdown mínimo e seguro (só o que a análise usa)
function inline(text) {
  const out = [];
  text.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) out.push(el('strong', {}, part.slice(2, -2)));
    else if (part) out.push(part.replace(/`/g, ''));
  });
  return out;
}
export function mdToNodes(md) {
  const nodes = [];
  const lines = md.split(/\r?\n/);
  const listLine = /^\s*([-*•]|\d+[.)])\s+/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trimEnd();
    if (!line.trim()) { i += 1; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { nodes.push(el(h[1].length <= 2 ? 'h3' : 'h4', {}, ...inline(h[2]))); i += 1; continue; }
    if (line.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i].trim()); i += 1; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const [head, ...rest] = rows.map(cells).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      if (head) nodes.push(el('div', { class: 'md-table-wrap' }, el('table', { class: 'cc-table md-table' }, el('thead', {}, el('tr', {}, ...head.map((c) => el('th', { scope: 'col' }, ...inline(c))))), el('tbody', {}, ...rest.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, ...inline(c)))))))));
      continue;
    }
    if (listLine.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && listLine.test(lines[i])) { items.push(lines[i].replace(listLine, '')); i += 1; }
      nodes.push(el(ordered ? 'ol' : 'ul', { class: 'md-list' }, ...items.map((t) => el('li', {}, ...inline(t)))));
      continue;
    }
    const para = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\|)/.test(lines[i].trim()) && !listLine.test(lines[i])) { para.push(lines[i].trim()); i += 1; }
    nodes.push(el('p', {}, ...inline(para.join(' '))));
  }
  return nodes;
}

// ---------------------------------------------------------------- Estratégias
export function viewEstrategias(ctx) {
  const root = el('div', { class: 'acc-stack strat' });
  let timer = 0;

  async function show() {
    window.clearTimeout(timer);
    if (!root.children.length) root.replaceChildren(card(el('p', { class: 'muted', role: 'status' }, 'Montando suas jogadas…')));
    let d;
    try {
      d = await ctx.api.getStrategies();
    } catch {
      return root.replaceChildren(card(el('h2', {}, 'Não consegui carregar'), el('p', { class: 'muted' }, 'Confira a conexão e tente de novo.')));
    }
    draw(d);
    if (d.report?.status === 'running') timer = window.setTimeout(() => { if (root.isConnected) show(); }, 4000);
  }

  function draw(d) {
    const s = d.summary;
    const stat = (label, value, sub, tone) => el('div', { class: `cc-stat${tone ? ` ${tone}` : ''}` }, el('span', { class: 'cc-stat-label' }, label), el('strong', {}, value), el('span', { class: 'fine muted' }, sub));
    const top = card(
      el('h2', {}, 'Estratégias'),
      el('p', { class: 'muted' }, 'O Prumo lê suas contas, cartões, dívidas e aplicações juntos e mostra onde mover, resgatar ou quitar primeiro para pagar menos juros e menos imposto.'),
      el('div', { class: 'cc-stats' },
        stat('Patrimônio líquido', brl(s.netWorthCents), 'o que você tem menos o que deve', s.netWorthCents < 0 ? 'tone-critical' : 'tone-ok'),
        stat('Dinheiro com liquidez', brl(s.liquidCents), 'aplicado com resgate diário'),
        stat('Dívidas e negativos', brl(s.debtsCents), 'cheque especial, cartão vencido e dívidas')));

    const plays = d.plays.length
      ? el('ul', { class: 'plays' }, ...d.plays.map((p) => el('li', { class: `play play-${p.tone}` },
        el('div', { class: 'play-top' }, el('span', { class: `pill ${p.priority === 'alta' ? 'tone-critical' : p.priority === 'media' ? 'tone-attention' : 'tone-ok'}` }, p.priority === 'alta' ? 'Prioridade alta' : p.priority === 'media' ? 'Prioridade média' : 'Prioridade baixa'), p.monthlySavingCents ? el('span', { class: 'fine pos' }, `até ${brl(p.monthlySavingCents)} por mês`) : null),
        el('strong', {}, p.title), el('p', {}, p.text))))
      : el('p', { class: 'muted' }, s.hasInvestments ? 'Nenhuma jogada urgente agora. Quando algo mudar (negativo na conta, fatura vencida, imposto caindo de faixa), aparece aqui.' : 'Para as jogadas ficarem precisas, lance suas aplicações em Investimentos e informe, nas Carteiras, a taxa e os dias sem juros do limite da conta.');
    const jogadas = card(el('h3', {}, 'Jogadas para agora'), plays);

    const run = el('button', { class: 'btn btn-primary', type: 'button' }, d.report?.status === 'done' ? 'Gerar nova análise' : 'Gerar análise completa');
    const running = d.report?.status === 'running';
    if (!d.ai.available || running || d.ai.usedToday >= d.ai.perDay) run.disabled = true;
    run.addEventListener('click', async () => {
      run.disabled = true;
      try { await ctx.api.requestStrategyReport(); toast('Montando a análise. Leva cerca de um minuto.'); show(); } catch (err) { toast(err?.message && (err.status === 429 || err.status === 503) ? err.message : 'Não consegui pedir agora.'); run.disabled = false; }
    });
    const body = running
      ? el('p', { class: 'muted', role: 'status' }, 'O Estrategista está analisando seus números… isso leva cerca de um minuto. Você pode sair da tela, a análise fica salva.')
      : d.report?.status === 'done'
        ? el('div', { class: 'md' }, ...mdToNodes(d.report.content))
        : d.report?.status === 'failed' ? el('p', { class: 'error' }, d.report.error ?? 'Não consegui montar a análise agora.') : el('p', { class: 'muted' }, 'Ainda não gerada.');
    const strategist = card(
      el('h3', {}, 'Estrategista financeiro (IA)'),
      el('p', { class: 'muted' }, 'Análise completa, no estilo de um consultor de private banking: diagnóstico do patrimônio, plano de ataque aos juros, eficiência fiscal e destino do aporte mensal, com tabela de ações.'),
      el('div', { class: 'button-row' }, run, el('span', { class: 'fine muted' }, d.ai.available ? `${d.ai.usedToday} de ${d.ai.perDay} análises hoje` : 'A análise por IA ainda não está ligada.')),
      d.report?.status === 'done' ? el('p', { class: 'fine muted' }, `Gerada em ${new Date(d.report.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.`) : null,
      body,
      el('p', { class: 'fine muted' }, 'Educação financeira com os seus números, não recomendação individual de investimento. Confirme taxas, impostos e condições com a instituição antes de agir.'));
    root.replaceChildren(top, jogadas, strategist);
  }

  show();
  return root;
}
