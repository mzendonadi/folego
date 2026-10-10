// Produtos e preços: o dono edita valor, dias de acesso, nome, se está à venda e se usa IA — e vê o que é grátis.
// O site lê estes preços do servidor: mudou aqui, muda para o próximo cliente (pedidos já feitos guardam o preço antigo).
import { api } from '../api.js';
import { el, toast, brl, dt, card, grid, table, badge, field, PRODUCT } from '../ui.js';
import { moneyInput } from '../../money.js';

const kindBadge = (p) => (p.kind === 'subscription' ? badge('Assinatura mensal (cartão)', 'muted') : p.priceCents === 0 ? badge('Grátis', 'ok') : p.usesAi ? badge('Pago · usa IA', 'warn') : badge('Pago', 'muted'));

function productCard(p, reload) {
  const price = moneyInput({ id: `pr-${p.code}`, ariaLabel: `Preço de ${p.name}`, value: p.priceCents });
  const name = el('input', { class: 'input', type: 'text', maxlength: '80', value: p.name, 'aria-label': 'Nome' });
  const days = el('input', { class: 'input', type: 'number', min: '1', max: '365', value: String(p.accessDays), 'aria-label': 'Dias de acesso' });
  const desc = el('textarea', { class: 'input', rows: '2', maxlength: '400', 'aria-label': 'Descrição' });
  desc.value = p.description;
  const active = el('input', { type: 'checkbox', id: `ac-${p.code}` });
  active.checked = p.active;
  const ai = el('input', { type: 'checkbox', id: `ai-${p.code}` });
  ai.checked = p.usesAi;
  const save = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Salvar alterações');
  save.addEventListener('click', async () => {
    const cents = price.cents();
    if (cents === null) return toast('Informe o preço (pode ser 0,00 para grátis).');
    save.disabled = true;
    try {
      await api.salvarProduto(p.code, { name: name.value.trim(), priceCents: cents, accessDays: Number(days.value) || p.accessDays, active: active.checked, usesAi: ai.checked, description: desc.value });
      toast(`${name.value.trim() || p.name}: salvo.`);
      reload();
    } catch (e) {
      save.disabled = false;
      toast(e.message);
    }
  });
  return el(
    'article', { class: `bo-product${p.active ? '' : ' is-off'}` },
    el('header', { class: 'bo-head-line' }, el('h3', {}, PRODUCT[p.code] ?? p.name), kindBadge(p), p.active ? null : badge('Fora de venda', 'bad')),
    el('div', { class: 'bo-product-grid' },
      field('Nome exibido', name),
      field('Preço (R$)', price.input, p.kind === 'subscription' ? 'Por mês, no cartão de crédito.' : 'Pix único.'),
      p.kind === 'subscription' ? field('Cobrança', el('p', { class: 'muted bo-static' }, 'Mensal, no cartão')) : field('Dias de acesso ao conteúdo', days, 'Também é o prazo para a pessoa refazer com dados novos. Contado do pagamento.'),
    ),
    field('Descrição (uso interno)', desc),
    el('div', { class: 'bo-checks' },
      el('div', { class: 'check' }, active, el('label', { for: `ac-${p.code}` }, 'À venda')),
      el('div', { class: 'check' }, ai, el('label', { for: `ai-${p.code}` }, 'Usa IA (depois do pagamento)')),
    ),
    el('div', { class: 'bo-actions' }, save, el('span', { class: 'fine' }, `Código: ${p.code} · atualizado ${dt(p.updatedAt)}`)),
    p.history.length ? el('details', { class: 'bo-history' }, el('summary', {}, 'Histórico de preços'), el('ul', {}, ...p.history.map((h) => el('li', {}, `${dt(h.at)}: ${h.oldCents === null ? '—' : brl(h.oldCents)} → ${brl(h.newCents)}${h.by ? ` (${h.by})` : ''}`)))) : null,
  );
}

export async function produtosScreen(ctx) {
  const host = el('div', { class: 'bo-stack' });
  async function draw() {
    const d = await api.produtos();
    const oneOff = d.products.filter((p) => p.kind === 'one_off');
    const subs = d.products.filter((p) => p.kind === 'subscription');

    const bundle = moneyInput({ id: 'pr-bundle', ariaLabel: 'Preço do Kit Completo', value: d.bundlePriceCents });
    const saveBundle = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Salvar');
    saveBundle.addEventListener('click', async () => {
      const cents = bundle.cents();
      if (!cents || cents < 100) return toast('Informe um valor válido.');
      try {
        await api.salvarConfig({ bundlePriceCents: cents });
        toast('Preço do Kit Completo salvo.');
        draw();
      } catch (e) {
        toast(e.message);
      }
    });
    // Mapa da Virada para quem assina: Ousado paga este valor (Pix) e tem estes dias; Desbravador usa sem pagar enquanto a assinatura valer.
    const subMap = moneyInput({ id: 'pr-submap', ariaLabel: 'Preço do Mapa para assinante Ousado', value: d.subscriberMapPriceCents });
    const subDays = el('input', { class: 'input', id: 'pr-submap-dias', type: 'number', min: '1', max: '365', step: '1', value: String(d.subscriberMapDays), 'aria-label': 'Dias de acesso do Mapa para assinante Ousado' });
    const saveSubMap = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Salvar');
    saveSubMap.addEventListener('click', async () => {
      const cents = subMap.cents();
      const dias = Number(subDays.value);
      if (!cents || cents < 100) return toast('Informe um valor válido.');
      if (!Number.isInteger(dias) || dias < 1 || dias > 365) return toast('Dias de acesso: de 1 a 365.');
      try {
        await api.salvarConfig({ subscriberMapPriceCents: cents, subscriberMapDays: dias });
        toast('Mapa para assinantes salvo.');
        draw();
      } catch (e) {
        toast(e.message);
      }
    });
    const mapRegular = d.products.find((p) => p.code === 'recovery_map')?.priceCents ?? 0;
    const sum = d.products.filter((p) => p.active);
    host.replaceChildren(
      el('p', { class: 'muted bo-lead' }, 'Edite os valores quando quiser. A mudança vale para os próximos pedidos e aparece no site em até alguns segundos; quem já gerou um Pix mantém o valor daquele pedido.'),
      grid(3, card('À venda agora', el('strong', { class: 'bo-big' }, String(sum.length)), el('p', { class: 'muted' }, 'produtos e planos ativos')), card('Pagos com IA', el('strong', { class: 'bo-big' }, String(d.products.filter((p) => p.usesAi && p.kind === 'one_off').length)), el('p', { class: 'muted' }, 'IA escreve o texto depois do pagamento')), card('Gratuitos', el('strong', { class: 'bo-big' }, String(d.free.length)), el('p', { class: 'muted' }, 'ferramentas e resultado inicial'))),
      card('Produtos avulsos (Pix único)', el('div', { class: 'bo-stack' }, ...oneOff.map((p) => productCard(p, draw)))),
      card('Kit Completo', el('p', { class: 'muted' }, 'Mapa + Cartas + Calendário comprados juntos. É um preço fechado: o desconto é calculado no servidor.'), el('div', { class: 'bo-actions' }, field('Preço do Kit (R$)', bundle.input), saveBundle), (() => {
        const soma = ['recovery_map', 'defense_letters', 'calendar_30d'].reduce((s, c) => s + (d.products.find((p) => p.code === c)?.priceCents ?? 0), 0);
        return el('p', { class: 'fine' }, `Soma dos três separados: ${brl(soma)}. ${d.bundlePriceCents < soma ? `Desconto de ${brl(soma - d.bundlePriceCents)}.` : 'Atenção: o Kit está mais caro que a soma; sem desconto o servidor cobra os itens separados.'}`);
      })()),
      card('Mapa da Virada para assinantes do Prumo', el('p', { class: 'muted' }, 'Na tela Dívidas, o assinante do Ousado vê um aviso para liberar o Mapa por este valor no Pix, com este prazo de acesso. O assinante do Desbravador usa o Mapa sem pagar, enquanto a assinatura valer. O Controle não muda. Preço e prazo são calculados no servidor.'), el('div', { class: 'bo-actions' }, field('Preço para o Ousado (R$)', subMap.input), field('Dias de acesso', subDays), saveSubMap), el('p', { class: 'fine' }, mapRegular > d.subscriberMapPriceCents ? `Preço normal do Mapa: ${brl(mapRegular)}. O Ousado economiza ${brl(mapRegular - d.subscriberMapPriceCents)}.` : 'Atenção: o preço do assinante não está abaixo do preço normal do Mapa; o servidor cobra o menor dos dois.')),
      card('Mapa da Virada para assinantes do Prumo', el('p', { class: 'muted' }, 'Na tela Dívidas, o assinante do Ousado vê um aviso para liberar o Mapa por este valor no Pix, com este prazo de acesso. O assinante do Desbravador usa o Mapa sem pagar, enquanto a assinatura valer. O Controle não muda. Preço e prazo são calculados no servidor.'), el('div', { class: 'bo-actions' }, field('Preço para o Ousado (R$)', subMap.input), field('Dias de acesso', subDays), saveSubMap), el('p', { class: 'fine' }, mapRegular > d.subscriberMapPriceCents ? `Preço normal do Mapa: ${brl(mapRegular)}. O Ousado economiza ${brl(mapRegular - d.subscriberMapPriceCents)}.` : 'Atenção: o preço do assinante não está abaixo do preço normal do Mapa; o servidor cobra o menor dos dois.')),
      card('Assinaturas do Prumo (recorrência mensal no cartão)', el('p', { class: 'muted' }, 'A pessoa assina uma vez e o cartão é cobrado todo mês até ela cancelar. Cancelar interrompe a cobrança na hora e mantém o acesso até o fim do mês pago. Mudar o preço vale para novas assinaturas e para as cobranças seguintes criadas daqui para frente; confira no Asaas as assinaturas já existentes.'), el('div', { class: 'bo-stack' }, ...subs.map((p) => productCard(p, draw)))),
      card('Recursos gratuitos', table([{ label: 'Recurso', render: (f) => f.name }, { label: 'O que é', render: (f) => f.description }, { label: 'IA', render: (f) => (f.usesAi ? 'Sim' : 'Não') }], d.free), el('p', { class: 'fine' }, 'Os gratuitos são a porta de entrada do funil. Não passam por pedido, então não têm preço editável; para cobrar por um deles, ele precisa virar um produto.')),
    );
  }
  await draw();
  return host;
}

