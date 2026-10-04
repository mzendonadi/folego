// Guias pagos sob medida: comparador de financiamento, renegociador de contas de casa, dinheiro esquecido e currículo por vaga.
// Fluxo igual ao do tradutor: a pessoa preenche, vê a prévia grátis e libera o guia completo por Pix. O que ela digitou não fica
// guardado no servidor; no currículo, nome e contatos ficam só neste navegador.
import { el, icon, toast, copyText } from './dom.js';
import { brl, percentToBps } from './format.js';
import { CATALOG } from './catalog.js';
import { moneyInput } from './money.js';

export const GUIDES = {
  financing: {
    code: 'guide_financing',
    title: 'Comparador honesto de financiamento',
    short: 'Compare propostas de carro, moto, imóvel ou empréstimo pelo que elas custam de verdade.',
    eyebrow: 'Comprar melhor',
    lead: 'Informe o valor do bem e até 4 propostas. A gente calcula o custo efetivo (CET), o total que você vai pagar e mostra o que está encarecendo cada uma. A prévia é grátis.',
  },
  housebills: {
    code: 'guide_housebills',
    title: 'Renegociador de contas de casa',
    short: 'Luz, água, gás, internet ou celular atrasados: plano de acordo, roteiro de ligação e carta pronta.',
    eyebrow: 'Reorganizar a vida',
    lead: 'Conte o que está atrasado e quanto cabe por mês. Você vê uma proposta de acordo de graça; o roteiro completo e a carta para a ouvidoria saem depois.',
  },
  forgotten: {
    code: 'guide_forgotten',
    title: 'Guia do dinheiro esquecido',
    short: 'Descubra onde procurar o dinheiro que pode estar parado em seu nome, com passo a passo e sem golpe.',
    eyebrow: 'Ganhar mais',
    lead: 'Responda 9 perguntas rápidas. Montamos o roteiro dos lugares oficiais que fazem sentido para você, com documentos e passo a passo. A consulta oficial é gratuita; aqui você paga pela organização.',
  },
  resume: {
    code: 'guide_resume',
    title: 'Currículo por vaga',
    short: 'Cole a vaga e conte o que você já fez: o currículo sai ajustado ao que a vaga pede, sem inventar nada.',
    eyebrow: 'Ganhar mais',
    lead: 'Cole o anúncio da vaga e conte sua experiência. Mostramos de graça o quanto você já cobre da vaga; o currículo pronto, a carta e o roteiro de entrevista saem depois.',
  },
};
export const GUIDE_KINDS = Object.keys(GUIDES);

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const list = (items, cls = 'bullets') => el('ul', { class: cls }, ...items.map((t) => el('li', {}, t)));
const field = (label, control, hint, id) => el('div', { class: 'field' }, el('label', { class: 'label', for: id ?? control.id }, label), control, hint ? el('p', { class: 'hint' }, hint) : null);
const input = (id, attrs = {}) => el('input', { class: 'input', id, autocomplete: 'off', ...attrs });
const select = (id, options, value) => {
  const s = el('select', { class: 'input select', id }, ...options.map(([v, l]) => el('option', { value: v }, l)));
  if (value !== undefined) s.value = value;
  return s;
};
const yesNo = [['', 'Escolha…'], ['sim', 'Sim'], ['nao', 'Não']];
const yesNoMaybe = [['', 'Escolha…'], ['sim', 'Sim'], ['nao', 'Não'], ['nao_sei', 'Não sei']];
const fmtPct = (n) => `${Number(n).toLocaleString('pt-BR')}%`;
class FormError extends Error {}
const need = (cond, msg) => {
  if (!cond) throw new FormError(msg);
};
const copyBtn = (label, text) => {
  const b = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('copy'), label);
  b.addEventListener('click', async () => toast((await copyText(typeof text === 'function' ? text() : text)) ? 'Copiado.' : 'Não consegui copiar. Selecione o texto e copie manualmente.'));
  return b;
};

// ---------------------------------------------------------------- formulários
function financingForm() {
  const kind = select('fi-kind', [['veiculo', 'Carro ou moto'], ['imovel', 'Imóvel'], ['pessoal', 'Empréstimo pessoal'], ['outro', 'Outro']]);
  const price = moneyInput({ id: 'fi-preco', ariaLabel: 'Valor do bem' });
  const down = moneyInput({ id: 'fi-entrada', ariaLabel: 'Entrada', placeholder: '0,00' });
  const income = moneyInput({ id: 'fi-renda', ariaLabel: 'Renda líquida mensal', placeholder: 'opcional' });
  const saving = moneyInput({ id: 'fi-guardar', ariaLabel: 'Quanto você consegue guardar por mês', placeholder: 'opcional' });
  const offersBox = el('div', { class: 'offers' });
  const offers = [];
  const addOffer = () => {
    if (offers.length >= 4) return toast('No máximo 4 propostas.');
    const n = offers.length + 1;
    const o = {
      name: input(`fi-nome-${n}`, { type: 'text', maxlength: '40', value: `Proposta ${n}`, 'aria-label': `Nome da proposta ${n}` }),
      term: input(`fi-prazo-${n}`, { type: 'text', inputmode: 'numeric', maxlength: '3', placeholder: 'meses', 'aria-label': `Prazo da proposta ${n} em meses` }),
      rate: input(`fi-taxa-${n}`, { type: 'text', inputmode: 'decimal', maxlength: '5', placeholder: 'ex.: 1,6', 'aria-label': `Juros ao mês da proposta ${n} em porcentagem` }),
      system: select(`fi-sistema-${n}`, [['price', 'Parcela fixa (Price)'], ['sac', 'Parcela que cai (SAC)']]),
      fees: moneyInput({ id: `fi-tarifas-${n}`, ariaLabel: `Tarifas pagas no ato da proposta ${n}`, placeholder: '0,00' }),
      extras: moneyInput({ id: `fi-extras-${n}`, ariaLabel: `Seguro e tarifas mensais da proposta ${n}`, placeholder: '0,00' }),
    };
    offers.push(o);
    const remove = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('trash'), 'Remover');
    const box = el(
      'fieldset', { class: 'offer-box' },
      el('legend', {}, `Proposta ${n}`),
      el('div', { class: 'form-grid' },
        field('Nome (banco ou loja)', o.name),
        field('Prazo (meses)', o.term),
        field('Juros ao mês (%)', o.rate, 'Está na simulação, como "taxa de juros".'),
        field('Tipo de parcela', o.system),
        field('Tarifas e seguros pagos no ato', o.fees.input, 'IOF, avaliação do bem, registro, seguro à vista…'),
        field('Seguro e tarifas todo mês', o.extras.input, 'Seguro prestamista, tarifa de manutenção…'),
      ),
      n > 1 ? remove : null,
    );
    remove.addEventListener('click', () => {
      offers.splice(offers.indexOf(o), 1);
      box.remove();
    });
    offersBox.append(box);
  };
  addOffer();
  addOffer();
  const addBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('plus'), 'Adicionar outra proposta');
  addBtn.addEventListener('click', addOffer);
  const node = el(
    'div', { class: 'tool-form' },
    el('div', { class: 'form-grid' },
      field('O que você quer financiar?', kind),
      field('Valor do bem', price.input),
      field('Entrada', down.input, 'Use a mesma entrada em todas as propostas para a comparação ser justa.'),
      field('Renda líquida por mês (opcional)', income.input, 'Para avisar se a parcela pesa demais.'),
      field('Quanto consegue guardar por mês (opcional)', saving.input, 'Para mostrar quanto tempo levaria para comprar à vista.'),
    ),
    el('h3', {}, 'Propostas'),
    offersBox,
    addBtn,
  );
  const read = () => {
    const priceC = price.cents();
    need(priceC && priceC > 0, 'Informe o valor do bem.');
    const downC = down.cents() ?? 0;
    need(downC < priceC, 'A entrada precisa ser menor que o valor do bem.');
    const out = offers.map((o, i) => {
      const term = Number(o.term.value.replace(/\D/g, ''));
      need(term >= 1 && term <= 480, `Proposta ${i + 1}: informe o prazo em meses (1 a 480).`);
      const bps = percentToBps(o.rate.value.trim() === '' ? '0' : o.rate.value);
      need(bps !== undefined && bps <= 3000, `Proposta ${i + 1}: informe os juros ao mês, ex.: 1,6.`);
      return { name: o.name.value.trim() || `Proposta ${i + 1}`, termMonths: term, monthlyRateBps: bps, system: o.system.value, upfrontFeesCents: o.fees.cents() ?? 0, monthlyExtrasCents: o.extras.cents() ?? 0 };
    });
    need(out.length >= 1, 'Informe pelo menos uma proposta.');
    const payload = { kind: kind.value, priceCents: priceC, downPaymentCents: downC, offers: out };
    if (income.cents()) payload.netIncomeCents = income.cents();
    if (saving.cents()) payload.savingMonthlyCents = saving.cents();
    return payload;
  };
  return { node, read };
}

function houseBillsForm() {
  const kind = select('hb-kind', [['energia', 'Energia elétrica'], ['agua', 'Água e esgoto'], ['gas', 'Gás'], ['internet', 'Internet'], ['celular', 'Celular'], ['tv', 'TV por assinatura']]);
  const overdue = moneyInput({ id: 'hb-valor', ariaLabel: 'Valor em atraso' });
  const months = input('hb-meses', { type: 'text', inputmode: 'numeric', maxlength: '3', placeholder: 'ex.: 4', 'aria-label': 'Meses em atraso' });
  const capacity = moneyInput({ id: 'hb-cabe', ariaLabel: 'Quanto cabe por mês' });
  const cut = select('hb-corte', [['nao', 'Não recebi aviso'], ['aviso', 'Recebi aviso de corte'], ['cortado', 'Já cortaram']]);
  const low = select('hb-baixa', [['nao', 'Não'], ['nao_sei', 'Não sei'], ['sim', 'Sim (CadÚnico, BPC, renda baixa)']]);
  const dispute = el('input', { type: 'checkbox', id: 'hb-conteste' });
  const node = el(
    'div', { class: 'tool-form' },
    el('div', { class: 'form-grid' },
      field('Qual conta está atrasada?', kind),
      field('Quanto está devendo hoje (total)?', overdue.input, 'O valor que a empresa cobra, com multa e juros.'),
      field('Há quantos meses está em atraso?', months),
      field('Quanto cabe pagar por mês nesse acordo?', capacity.input, 'Além da fatura do mês. Seja realista: acordo que não cabe volta a atrasar.'),
      field('E o corte do serviço?', cut),
      field('A família é de baixa renda?', low, 'Existe tarifa social em energia e, em várias cidades, em água.'),
    ),
    el('div', { class: 'check' }, dispute, el('label', { for: 'hb-conteste' }, 'Acho que o valor cobrado está errado')),
  );
  const read = () => {
    const o = overdue.cents();
    need(o && o > 0, 'Informe quanto está devendo.');
    const m = Number(months.value.replace(/\D/g, ''));
    need(m >= 1 && m <= 120, 'Informe há quantos meses está em atraso (1 a 120).');
    const c = capacity.cents();
    need(c && c > 0, 'Informe quanto cabe pagar por mês.');
    return { kind: kind.value, overdueCents: o, monthsOverdue: m, monthlyCapacityCents: c, cutStatus: cut.value, lowIncome: low.value, disputesAmount: dispute.checked };
  };
  return { node, read };
}

const FORGOTTEN_QUESTIONS = [
  ['workedFormal', 'Já trabalhou com carteira assinada (CLT)?', yesNo],
  ['workedBefore1989', 'Trabalhou com carteira assinada antes de 1989?', yesNo],
  ['closedBankAccount', 'Tem ou teve conta em banco que encerrou ou que não usa mais?', yesNoMaybe],
  ['consorcioOrCoop', 'Já participou de consórcio ou de cooperativa de crédito?', yesNoMaybe],
  ['relativeDied', 'Algum parente próximo faleceu e deixou conta, investimento ou benefício?', yesNo],
  ['declaresIr', 'Declara ou já declarou Imposto de Renda?', yesNo],
  ['invested', 'Já investiu em ações, fundos ou Tesouro Direto?', yesNo],
  ['lifeInsurance', 'Tem ou teve seguro de vida (inclusive pelo trabalho ou junto com financiamento)?', yesNoMaybe],
  ['inssBenefit', 'Já recebeu ou pediu algum benefício do INSS?', yesNo],
];

function forgottenForm() {
  const sels = FORGOTTEN_QUESTIONS.map(([key, label, opts]) => [key, label, select(`fg-${key}`, opts)]);
  const node = el('div', { class: 'tool-form' }, ...sels.map(([, label, s]) => field(label, s)), el('p', { class: 'fine' }, 'Não pedimos CPF, nome nem nenhum documento. As respostas só servem para montar o seu roteiro.'));
  const read = () => {
    const out = {};
    for (const [key, label, s] of sels) {
      need(s.value !== '', `Responda: ${label}`);
      out[key] = s.value;
    }
    return out;
  };
  return { node, read };
}

function resumeForm(ctx) {
  const role = input('rs-cargo', { type: 'text', maxlength: '80', placeholder: 'Ex.: Assistente administrativo', 'aria-label': 'Cargo da vaga' });
  const level = select('rs-nivel', [['entrada', 'Estou começando'], ['pleno', 'Tenho experiência'], ['senior', 'Tenho muita experiência']]);
  level.value = 'pleno';
  const job = el('textarea', { class: 'input', id: 'rs-vaga', rows: '8', maxlength: '4000', placeholder: 'Cole aqui o texto completo da vaga (requisitos, atividades, benefícios)…', 'aria-label': 'Texto da vaga' });
  const count = el('p', { class: 'fine', id: 'rs-conta' }, '0 de 4000 caracteres');
  job.addEventListener('input', () => {
    count.textContent = `${job.value.length} de 4000 caracteres`;
  });
  const skills = input('rs-hab', { type: 'text', maxlength: '500', placeholder: 'Ex.: Excel, atendimento ao cliente, organização', 'aria-label': 'Habilidades' });
  const edu = input('rs-form', { type: 'text', maxlength: '200', placeholder: 'Ex.: Ensino médio completo; Curso técnico em administração (cursando)', 'aria-label': 'Formação' });
  const lang = input('rs-idiomas', { type: 'text', maxlength: '120', placeholder: 'Ex.: Inglês básico', 'aria-label': 'Idiomas' });
  const expBox = el('div', { class: 'offers' });
  const exps = [];
  const addExp = () => {
    if (exps.length >= 6) return toast('No máximo 6 experiências.');
    const n = exps.length + 1;
    const e = {
      role: input(`rs-ex-cargo-${n}`, { type: 'text', maxlength: '80', placeholder: 'Ex.: Auxiliar de escritório', 'aria-label': `Cargo da experiência ${n}` }),
      years: input(`rs-ex-anos-${n}`, { type: 'text', inputmode: 'numeric', maxlength: '2', placeholder: 'anos', 'aria-label': `Anos na experiência ${n}` }),
      tasks: el('textarea', { class: 'input', id: `rs-ex-tarefas-${n}`, rows: '4', maxlength: '800', placeholder: 'O que você fazia, uma coisa por linha. Ex.:\nAtendia clientes por telefone\nControlava planilha de pedidos no Excel', 'aria-label': `Tarefas da experiência ${n}` }),
    };
    exps.push(e);
    const remove = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('trash'), 'Remover');
    const box = el('fieldset', { class: 'offer-box' }, el('legend', {}, `Experiência ${n}`), el('div', { class: 'form-grid' }, field('Cargo', e.role), field('Tempo (anos)', e.years)), field('O que você fazia', e.tasks), n > 1 ? remove : null);
    remove.addEventListener('click', () => {
      exps.splice(exps.indexOf(e), 1);
      box.remove();
    });
    expBox.append(box);
  };
  addExp();
  const addBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('plus'), 'Adicionar outra experiência');
  addBtn.addEventListener('click', addExp);
  // Dados pessoais: ficam SÓ neste navegador (memória da tela), nunca vão ao servidor.
  const personal = ctx.personal;
  const pName = input('rs-nome', { type: 'text', maxlength: '80', autocomplete: 'name', value: personal.name ?? '', 'aria-label': 'Seu nome' });
  const pPhone = input('rs-tel', { type: 'tel', maxlength: '20', autocomplete: 'tel', value: personal.phone ?? '', 'aria-label': 'Telefone' });
  const pMail = input('rs-mail', { type: 'email', maxlength: '120', autocomplete: 'email', value: personal.email ?? '', 'aria-label': 'E-mail' });
  const pCity = input('rs-cidade', { type: 'text', maxlength: '60', autocomplete: 'address-level2', value: personal.city ?? '', 'aria-label': 'Cidade' });
  const node = el(
    'div', { class: 'tool-form' },
    el('div', { class: 'form-grid' }, field('Cargo da vaga', role), field('Seu momento', level)),
    field('Texto da vaga', job, 'Quanto mais completo o anúncio, melhor o ajuste.'),
    count,
    el('h3', {}, 'O que você já fez'),
    field('Suas habilidades (separe por vírgula)', skills),
    expBox,
    addBtn,
    el('div', { class: 'form-grid' }, field('Formação', edu), field('Idiomas', lang)),
    el('div', { class: 'note' }, icon('lock'), el('div', {}, el('strong', {}, 'Seus dados de contato ficam só neste aparelho.'), el('p', {}, 'Nome, telefone e e-mail abaixo NÃO são enviados: servem apenas para montar o arquivo na sua tela. Não coloque dados pessoais nos campos acima.'))),
    el('div', { class: 'form-grid' }, field('Seu nome', pName), field('Telefone', pPhone), field('E-mail', pMail), field('Cidade', pCity)),
  );
  const read = () => {
    need(role.value.trim().length >= 3, 'Informe o cargo da vaga.');
    need(job.value.trim().length >= 40, 'Cole o texto da vaga (pelo menos algumas linhas).');
    const experiences = exps
      .map((e) => ({ role: e.role.value.trim(), years: Number(e.years.value.replace(/\D/g, '')) || 0, tasks: e.tasks.value.trim() }))
      .filter((e) => e.role);
    need(experiences.length > 0 || skills.value.trim().length >= 3, 'Conte pelo menos uma experiência ou algumas habilidades.');
    Object.assign(personal, { name: pName.value.trim(), phone: pPhone.value.trim(), email: pMail.value.trim(), city: pCity.value.trim() });
    return { targetRole: role.value.trim(), level: level.value, jobText: job.value, skills: skills.value.trim(), education: edu.value.trim(), languages: lang.value.trim(), experiences };
  };
  return { node, read };
}

const FORMS = { financing: financingForm, housebills: houseBillsForm, forgotten: forgottenForm, resume: resumeForm };

// ---------------------------------------------------------------- prévias (grátis)
const PREVIEWS = {
  financing: (p) => ({
    title: p.headline,
    items: [
      `Valor financiado: ${brl(p.financedCents)}, comparando ${p.offersCount} ${p.offersCount === 1 ? 'proposta' : 'propostas'}.`,
      `Melhor custo efetivo: ${fmtPct(p.best.cetAnnualPct)} ao ano (CET), total de ${brl(p.best.totalPaidCents)}.`,
      p.flagCount > 0 ? `${p.flagCount} ${p.flagCount === 1 ? 'alerta' : 'alertas'} de custo escondido ou de risco encontrado nas propostas.` : 'Nenhum alerta forte nas propostas informadas.',
    ],
    locked: ['O CET e o total pago de cada proposta, lado a lado', 'O que está encarecendo cada contrato (tarifas, seguros, prazo)', 'Quanto tempo levaria para comprar à vista, se der para guardar', 'As perguntas certas para fazer ao banco antes de assinar'],
  }),
  housebills: (p) => ({
    title: p.headline,
    items: [
      `Dívida de ${brl(p.overdueCents)} em ${p.label.toLowerCase()}${p.essential ? ': serviço essencial, entra na frente das outras contas.' : '.'}`,
      `Parcelamento dentro do que cabe: ${p.installment.count} ${p.installment.count === 1 ? 'parcela' : 'parcelas'} de ${brl(p.installment.installmentCents)}.`,
      p.hasCutNote ? 'Há orientação específica para a situação de corte do serviço.' : 'Sem corte por enquanto: dá para negociar com calma.',
      p.hasLowIncomeNote ? 'Pode haver tarifa social que reduz a conta todo mês.' : null,
    ].filter(Boolean),
    locked: ['O roteiro da ligação, palavra por palavra, e as respostas para as objeções', 'A carta pronta para a ouvidoria, com os campos para preencher', 'O que pedir por escrito e a quem reclamar se a empresa não responder', 'A estimativa de quanto da dívida é multa e juros e a meta de desconto'],
  }),
  forgotten: (p) => ({
    title: p.headline,
    items: [`Por onde começar: ${p.firstSourceName}.`, p.hasHeirPath ? 'Inclui o caminho para herdeiros (valores de pessoa falecida).' : 'Roteiro montado só com o que combina com as suas respostas.', 'Não prometemos valor: só dizemos onde procurar, em ordem, e como evitar golpe.'],
    locked: ['A lista dos lugares oficiais, com o link de cada um', 'O passo a passo e os documentos de cada consulta', 'A lista de golpes mais comuns e como reconhecê-los', 'Um quadro para marcar o que você já consultou'],
  }),
  resume: (p) => ({
    title: p.headline,
    items: [
      `Você já mostra ${p.matchedCount} ${p.matchedCount === 1 ? 'ponto' : 'pontos'} que a vaga pede${p.topMatched.length ? `: ${p.topMatched.join(', ')}` : ''}.`,
      p.missingCount > 0 ? `${p.missingCount} ${p.missingCount === 1 ? 'ponto da vaga ainda não aparece' : 'pontos da vaga ainda não aparecem'} no que você contou${p.topMissing.length ? ` (${p.topMissing.join(', ')})` : ''}.` : 'Você cobre tudo o que identificamos na vaga.',
    ],
    locked: ['O currículo completo, ajustado à vaga, pronto para salvar em PDF', 'O resumo profissional e as tarefas escritas com as palavras da vaga', 'A carta de apresentação e o roteiro de entrevista', 'Dicas para passar pelos filtros automáticos de seleção'],
  }),
};

// ---------------------------------------------------------------- conteúdo completo (pago)
function financingFull(a) {
  const best = a.offers[a.bestIndex];
  const table = el(
    'div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Comparação das propostas' },
    el('table', { class: 'data-table' },
      el('thead', {}, el('tr', {}, ...['Proposta', 'CET ao ano', 'Total pago', 'Custo do crédito', '1ª parcela'].map((h, i) => el('th', { scope: 'col', class: i > 0 ? 'num' : '' }, h)))),
      el('tbody', {}, ...a.ranking.map((i, pos) => {
        const o = a.offers[i];
        return el('tr', { class: pos === 0 ? 'is-highlight' : '' }, el('th', { scope: 'row' }, o.name, pos === 0 && a.offers.length > 1 ? ' ✓ mais barata' : ''), el('td', { class: 'num' }, fmtPct(o.cetAnnualPct)), el('td', { class: 'num' }, brl(o.totalPaidCents)), el('td', { class: 'num' }, brl(o.costOfCreditCents)), el('td', { class: 'num' }, brl(o.firstInstallmentCents)));
      })),
    ),
  );
  return [
    card(el('p', { class: 'eyebrow' }, 'Resultado'), el('h2', {}, a.offers.length > 1 ? `A mais barata é "${best.name}"` : `Custo da proposta "${best.name}"`),
      el('p', {}, `Você financia ${brl(a.financedCents)} (bem de ${brl(a.priceCents)} com entrada de ${brl(a.downPaymentCents)}).${a.offers.length > 1 ? ` A mais cara custa ${brl(a.spreadCents)} a mais no total.` : ''}`),
      table, el('p', { class: 'fine' }, 'CET = custo efetivo total: junta juros, tarifas e seguros numa taxa só. É o número certo para comparar. Cálculo indicativo: vale o que está no contrato.')),
    ...a.ranking.map((i) => {
      const o = a.offers[i];
      return card(
        el('h3', {}, o.name),
        el('dl', { class: 'stats' },
          ...[['Valor financiado', brl(o.financedCents)], ['Prazo', `${o.termMonths} meses`], ['Primeira parcela', brl(o.firstInstallmentCents)], ['Última parcela', brl(o.lastInstallmentCents)], ['Total pago', brl(o.totalPaidCents)], ['Custo do crédito', `${brl(o.costOfCreditCents)} (${fmtPct(o.costPctOfFinanced)})`], ['CET', `${fmtPct(o.cetMonthlyPct)} ao mês · ${fmtPct(o.cetAnnualPct)} ao ano`], ['Juros anunciados', `${fmtPct(o.nominalRateMonthlyPct)} ao mês`]].map(([k, v]) => el('div', { class: 'stat' }, el('dt', {}, k), el('dd', {}, v)))),
        ...o.flags.map((f) => el('div', { class: f.tone === 'attention' ? 'note note-amber' : 'note' }, icon(f.tone === 'attention' ? 'alert' : 'info'), el('span', {}, f.text))),
      );
    }),
    a.waiting ? card(el('h3', {}, 'E se eu esperar e comprar à vista?'), el('p', {}, `Guardando o que você informou, juntar o valor financiado levaria cerca de ${a.waiting.months} ${a.waiting.months === 1 ? 'mês' : 'meses'}. Nesse caminho você evita ${brl(a.waiting.avoidedCostCents)} de custo do crédito na melhor proposta. Só você sabe se vale esperar: o bem pode ficar mais caro e há quem precise dele agora.`)) : null,
    card(el('h3', {}, 'Antes de assinar'), list(a.tips)),
    card(el('h3', {}, 'Perguntas para fazer ao banco'), list(a.questions), copyBtn('Copiar as perguntas', () => a.questions.map((q, n) => `${n + 1}. ${q}`).join('\n'))),
  ];
}

function houseBillsFull(a) {
  return [
    card(el('p', { class: 'eyebrow' }, a.label), el('h2', {}, `Seu plano para negociar ${brl(a.overdueCents)}`),
      el('p', { class: a.essential ? 'note note-amber' : 'note' }, icon(a.essential ? 'alert' : 'info'), el('span', {}, a.priorityWhy)),
      el('dl', { class: 'stats' }, ...[['Dívida hoje', brl(a.overdueCents)], ['Principal estimado', brl(a.estimatedPrincipalCents)], ['Multa e juros estimados', brl(a.estimatedPenaltyCents)], ['Meta à vista', `${brl(a.cashAsk.askCents)} a ${brl(a.cashAsk.fallbackCents)}`], ['Parcelando', `${a.installment.count}x de ${brl(a.installment.installmentCents)}`]].map(([k, v]) => el('div', { class: 'stat' }, el('dt', {}, k), el('dd', {}, v)))),
      el('p', { class: 'fine' }, 'A divisão entre principal e encargos é uma estimativa (multa de 2% e juros de 1% ao mês). Peça o demonstrativo para ver os números reais. Não há garantia de desconto: a empresa decide.')),
    a.cutNote ? card(el('div', { class: 'note note-amber' }, icon('alert'), el('span', {}, a.cutNote))) : null,
    a.disputeNote ? card(el('div', { class: 'note' }, icon('info'), el('span', {}, a.disputeNote))) : null,
    a.lowIncomeNote ? card(el('div', { class: 'note' }, icon('info'), el('span', {}, a.lowIncomeNote))) : null,
    card(el('h3', {}, 'Passo a passo'), el('ol', { class: 'guide' }, ...a.steps.map((s) => el('li', {}, s)))),
    card(el('h3', {}, 'Roteiro da ligação ou do chat'), list(a.phoneScript, 'bullets script'), copyBtn('Copiar o roteiro', () => a.phoneScript.join('\n'))),
    card(el('h3', {}, 'Se disserem isso, responda assim'), ...a.objections.map((o) => el('div', { class: 'objection' }, el('p', {}, el('strong', {}, 'Eles: '), o.they), el('p', {}, el('strong', {}, 'Você: '), o.you)))),
    card(el('h3', {}, 'Peça por escrito'), list(a.askInWriting)),
    card(el('h3', {}, 'Carta para a ouvidoria'), el('pre', { class: 'letter' }, a.letter), copyBtn('Copiar a carta', a.letter)),
    card(el('h3', {}, 'Se a empresa não resolver'), el('p', {}, a.channel.note), el('p', {}, `Reclame também no consumidor.gov.br e no Procon da sua cidade${a.channel.phone ? `. Telefone da ${a.channel.regulator}: ${a.channel.phone}` : ''}.`)),
    card(el('h3', {}, 'Seus direitos'), list(a.rights)),
    card(el('h3', {}, 'Cuidado com golpe'), list(a.warnings)),
  ].filter(Boolean);
}

function forgottenFull(a, orderId) {
  const key = `folego:esquecido:${orderId}`;
  let done = {};
  try {
    done = JSON.parse(localStorage.getItem(key) ?? '{}');
  } catch {
    done = {};
  }
  const save = () => {
    try {
      localStorage.setItem(key, JSON.stringify(done));
    } catch {
      /* sem armazenamento: o quadro só vale nesta tela */
    }
  };
  const tracker = el('ul', { class: 'checklist' }, ...a.tracker.map((t) => {
    const cb = el('input', { type: 'checkbox', id: `fg-ck-${t.id}` });
    cb.checked = Boolean(done[t.id]);
    cb.addEventListener('change', () => {
      done[t.id] = cb.checked;
      save();
    });
    return el('li', {}, el('div', { class: 'check' }, cb, el('label', { for: cb.id }, t.label)));
  }));
  return [
    card(el('p', { class: 'eyebrow' }, 'Seu roteiro'), el('h2', {}, `${a.sources.length} lugares oficiais, cerca de ${a.totalMinutes} minutos`), el('p', {}, a.honesty)),
    card(el('div', { class: 'note note-amber' }, icon('alert'), el('div', {}, el('strong', {}, 'Cuidado com golpe: é o assunto em que mais aparecem'), list(a.scamAlerts)))),
    ...a.sources.map((s, i) => card(
      el('p', { class: 'eyebrow' }, `Passo ${i + 1} · cerca de ${s.minutes} min`),
      el('h3', {}, s.name),
      el('p', {}, s.why),
      el('p', { class: 'muted' }, s.covers),
      el('p', {}, el('a', { href: s.link, target: '_blank', rel: 'noopener noreferrer' }, s.linkLabel)),
      el('h4', {}, 'O que levar'), list(s.docs),
      el('h4', {}, 'Passo a passo'), el('ol', { class: 'guide' }, ...s.steps.map((t) => el('li', {}, t))),
      el('p', { class: 'fine' }, s.tip),
    )),
    card(el('h3', {}, 'Marque o que você já consultou'), tracker, el('p', { class: 'fine' }, 'As marcações ficam só neste aparelho.')),
  ];
}

function resumeFull(a, ctx) {
  const personal = ctx.personal;
  const sheet = el('article', { class: 'resume-sheet', 'aria-label': 'Pré-visualização do currículo' });
  const header = el('div', { class: 'resume-head' });
  const draw = () => {
    const contact = [personal.phone, personal.email, personal.city].filter(Boolean).join('  ·  ');
    header.replaceChildren(el('h1', {}, personal.name || '[SEU NOME]'), el('p', { class: 'resume-contact' }, contact || '[telefone · e-mail · cidade]'));
  };
  draw();
  const r = a.resume;
  // append() é nativo: não ignora null (viraria o texto "null"), por isso o filter
  sheet.append(
    ...[
    header,
    el('p', { class: 'resume-headline' }, r.headline),
    el('h2', {}, 'Resumo'), el('p', {}, r.summary),
    r.experiences.length ? el('h2', {}, 'Experiência') : null,
    ...r.experiences.flatMap((e) => [el('h3', {}, `${e.role}${e.years ? ` · ${e.years} ${e.years === 1 ? 'ano' : 'anos'}` : ''}`), el('ul', {}, ...e.bullets.map((b) => el('li', {}, b.text)))]),
    r.skillsOrdered.length ? el('h2', {}, 'Habilidades') : null,
    r.skillsOrdered.length ? el('p', {}, r.skillsOrdered.join(' · ')) : null,
    r.education ? el('h2', {}, 'Formação') : null,
    r.education ? el('p', {}, r.education) : null,
    r.languages ? el('h2', {}, 'Idiomas') : null,
    r.languages ? el('p', {}, r.languages) : null,
    ].filter(Boolean),
  );
  const mkInput = (key, label, type = 'text') => {
    const i = el('input', { class: 'input', id: `rs-p-${key}`, type, value: personal[key] ?? '', 'aria-label': label });
    i.addEventListener('input', () => {
      personal[key] = i.value.trim();
      draw();
    });
    return field(label, i);
  };
  const printBtn = el('button', { class: 'btn btn-primary', type: 'button' }, icon('printer'), 'Salvar em PDF');
  printBtn.addEventListener('click', () => window.print());
  const plain = () => [personal.name || '[SEU NOME]', [personal.phone, personal.email, personal.city].filter(Boolean).join(' · '), '', r.headline, '', 'RESUMO', r.summary, '', 'EXPERIÊNCIA', ...r.experiences.flatMap((e) => [`${e.role}${e.years ? ` (${e.years} anos)` : ''}`, ...e.bullets.map((b) => `- ${b.text}`), '']), 'HABILIDADES', r.skillsOrdered.join(' · '), '', r.education ? `FORMAÇÃO\n${r.education}` : '', r.languages ? `IDIOMAS\n${r.languages}` : ''].join('\n');
  const chip = (k, tone) => el('span', { class: `pill tone-${tone}` }, k.label);
  const noNumber = r.experiences.flatMap((e) => e.bullets).filter((b) => b.needsNumber).length;
  return [
    card(el('p', { class: 'eyebrow no-print' }, 'Seu currículo para esta vaga'), el('h2', { class: 'no-print' }, a.targetRole),
      el('div', { class: 'no-print' },
        el('p', {}, `Cobertura da vaga: ${a.coveragePct}%.`),
        el('div', { class: 'lis-meter', role: 'img', 'aria-label': `${a.coveragePct}% da vaga coberta` }, el('span', { style: `width:${a.coveragePct}%` })),
        a.matched.length ? el('p', {}, el('strong', {}, 'Você já mostra: '), ...a.matched.flatMap((k) => [chip(k, 'ok'), ' '])) : null,
        a.missing.length ? el('p', {}, el('strong', {}, 'Falta mostrar (só inclua se for verdade): '), ...a.missing.flatMap((k) => [chip(k, 'attention'), ' '])) : null,
        ...a.requirementNotes.map((n) => el('p', { class: 'note' }, icon('info'), el('span', {}, n))),
        list(a.honestyNotes),
        noNumber > 0 ? el('p', { class: 'fine' }, `${noNumber} ${noNumber === 1 ? 'tarefa está' : 'tarefas estão'} sem número. Acrescente quantidade, tempo ou resultado onde puder, com honestidade.`) : null)),
    card(el('h3', { class: 'no-print' }, 'Seus dados (ficam só neste aparelho)'), el('div', { class: 'form-grid no-print' }, mkInput('name', 'Nome'), mkInput('phone', 'Telefone', 'tel'), mkInput('email', 'E-mail', 'email'), mkInput('city', 'Cidade')),
      sheet, el('div', { class: 'button-row no-print' }, printBtn, copyBtn('Copiar como texto', plain))),
    card(el('h3', {}, 'Carta de apresentação'), el('pre', { class: 'letter' }, a.coverLetter), copyBtn('Copiar a carta', a.coverLetter)),
    card(el('h3', {}, 'Para passar pelos filtros'), list(a.atsTips), el('h4', {}, 'Formato'), list(a.layoutTips)),
    card(el('h3', {}, 'Perguntas de entrevista'), ...a.interview.map((q) => el('div', { class: 'objection' }, el('p', {}, el('strong', {}, q.question)), el('p', {}, q.how)))),
  ];
}

const FULL = { financing: financingFull, housebills: houseBillsFull, forgotten: forgottenFull, resume: resumeFull };

// ---------------------------------------------------------------- tela
/** @param ctx { api, state, onBuy(caseId, code, kind), goList() } */
export function renderGuided(root, kind, ctx) {
  const spec = GUIDES[kind];
  const personal = (ctx.state.guidedPersonal ??= {});
  const price = () => CATALOG[spec.code];

  function drawForm() {
    const form = FORMS[kind]({ personal });
    const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Ver a prévia grátis', icon('arrow-right'));
    const live = el('div', { class: 'tool-form' }, form.node, btn);
    const wrap = el('form', { novalidate: true }, live);
    wrap.addEventListener('submit', async (e) => {
      e.preventDefault();
      let payload;
      try {
        payload = form.read();
      } catch (err) {
        if (err instanceof FormError) return toast(err.message);
        throw err;
      }
      btn.disabled = true;
      btn.textContent = 'Calculando…';
      try {
        const { caseId, preview } = await ctx.api.createGuided(kind, payload);
        ctx.state.guidedCaseId = caseId;
        drawPreview(preview, caseId);
      } catch (error) {
        btn.disabled = false;
        btn.textContent = 'Ver a prévia grátis';
        toast(error?.status === 429 ? 'Muitas tentativas seguidas. Espere um minutinho.' : error?.status === 422 || error?.status === 400 ? (error.message?.startsWith('Confira') ? error.message : 'Confira os valores preenchidos e tente de novo.') : 'Não consegui calcular agora. Tente de novo.');
      }
    });
    root.replaceChildren(card(el('p', { class: 'section-sub' }, spec.lead), wrap, el('p', { class: 'fine' }, 'Ao continuar você aceita os Termos e a Política de Privacidade. O que você digitou não fica guardado: só o resultado.')));
  }

  function drawPreview(p, caseId) {
    const view = PREVIEWS[kind](p);
    const item = price();
    const on = item?.active !== false;
    const buy = el('button', { class: 'btn btn-primary btn-lg', type: 'button', disabled: !on }, on ? `Liberar o guia completo · ${brl(item.cents)}` : 'Ainda não está à venda', on ? icon('arrow-right') : null);
    buy.addEventListener('click', () => ctx.onBuy(caseId, spec.code, kind));
    const again = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Mudar as respostas');
    again.addEventListener('click', drawForm);
    root.replaceChildren(card(
      el('p', { class: 'eyebrow' }, 'Prévia grátis'),
      el('h2', {}, view.title),
      list(view.items),
      el('h3', {}, 'No guia completo'),
      el('ul', { class: 'discover-list' }, ...view.locked.map((t) => el('li', {}, icon('lock', 'icon icon-lock'), el('span', {}, t)))),
      el('div', { class: 'button-row' }, buy, again),
      el('p', { class: 'fine' }, on ? 'Pagamento único por Pix. Nada é cobrado se você não gostar.' : 'Este guia ainda não foi liberado para venda. Volte em breve.'),
    ));
  }

  function drawFull({ content, accessUntil }, orderId) {
    const link = el('button', { class: 'btn btn-quiet btn-sm no-print', type: 'button' }, icon('lock'), 'Guardar link para abrir em outro aparelho');
    const linkOut = el('div', { class: 'access-out no-print' });
    link.addEventListener('click', async () => {
      try {
        const { token } = await ctx.api.createAccessLink(orderId);
        const url = `${location.origin}${location.pathname}#/acesso/${token}`;
        const box = el('input', { class: 'input pix-code', type: 'text', readonly: true, value: url, 'aria-label': 'Seu link de acesso' });
        linkOut.replaceChildren(el('div', { class: 'pix-code-row' }, box, copyBtn('Copiar link', url)));
      } catch {
        toast('Não consegui gerar o link agora.');
      }
    });
    root.replaceChildren(
      ...FULL[kind](content, kind === 'resume' ? { personal } : orderId).filter(Boolean),
      card(el('p', { class: 'muted no-print' }, `Seu guia fica disponível até ${new Date(accessUntil).toLocaleDateString('pt-BR')}.`), el('p', { class: 'fine' }, 'Informação geral e cálculo indicativo: não substitui contrato, advogado, Defensoria Pública nem orientação financeira individual.'), link, linkOut),
    );
  }

  return { drawForm, drawPreview, drawFull };
}

/** Lista dos guias (#/guia): vitrine com o que está à venda e o que está chegando. */
export function renderGuideList(root, { onOpen, mine = [] }) {
  const owned = new Map(mine.map((g) => [g.kind, g]));
  root.replaceChildren(
    card(el('p', { class: 'section-sub' }, 'Cada guia começa com uma prévia grátis. Você só paga se gostar, por Pix, uma vez.')),
    ...GUIDE_KINDS.map((k) => {
      const g = GUIDES[k];
      const item = CATALOG[g.code];
      const on = item?.active !== false && Boolean(item);
      const open = el('button', { class: 'btn btn-primary', type: 'button' }, owned.has(k) ? 'Abrir meu guia' : 'Começar (prévia grátis)', icon('arrow-right'));
      open.addEventListener('click', () => onOpen(k, owned.get(k)));
      return card(el('p', { class: 'eyebrow' }, g.eyebrow), el('h3', {}, g.title), el('p', {}, g.short), el('p', { class: 'fine' }, on ? `${brl(item.cents)} por Pix, só se você gostar da prévia.` : 'Em breve: já dá para ver a prévia, a venda será liberada em seguida.'), open);
    }),
  );
}
