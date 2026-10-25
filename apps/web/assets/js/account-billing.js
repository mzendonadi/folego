// Prumo: assinatura mensal no cartão (checkout, cancelamento com aviso, exportação dos dados e perfil/notificações).
// O cartão é digitado na página segura do provedor de pagamento: nenhum dado de cartão passa pelo Fôlego.
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';
import { PLANS } from '../vendor/engine.js';
import { confirmDialog } from './confirm.js';
import { appCard } from './account-app.js';
import { assistantCard } from './account-assistant.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const dateBr = (ms) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
export const PURGE_DAYS_TEXT = 'até 15 dias';

/** Aviso padrão de cancelamento (mesmo texto do e-mail e dos termos). */
export const cancelNotice = (until) => `Cobrança interrompida. Você continua com acesso e pode baixar todos os seus dados até ${until}. Não devolvemos o valor do mês em andamento. Depois dessa data, seus dados são apagados automaticamente.`;

/** Resumo do cabeçalho: "mensal", quando renova ou até quando vai o acesso (em vez de "30 dias restantes"). */
export function billingHeader(acc, plan) {
  const b = acc.billing;
  const end = acc.subscription.periodEnd;
  if (!b) return { pill: `Plano ${plan.name}`, line: `Acesso até ${dateBr(end)}`, tone: 'ok' };
  if (b.status === 'canceled') return { pill: `Plano ${plan.name}`, line: `Cancelado · acesso até ${dateBr(end)}`, tone: 'warn' };
  if (b.status === 'past_due') return { pill: `Plano ${plan.name}`, line: 'Cartão recusado · atualize para manter o acesso', tone: 'bad' };
  return { pill: `Plano ${plan.name} · mensal`, line: `${b.priceCents ? `${brl(b.priceCents)}/mês · ` : ''}renova em ${dateBr(end)}`, tone: 'ok' };
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Botões de download dos dados: planilha (.xlsx) e PDF. Valem enquanto houver acesso, inclusive depois de cancelar. */
export function exportButtons(api) {
  const day = new Date().toISOString().slice(0, 10);
  const xlsx = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('list'), 'Baixar planilha (.xlsx)');
  xlsx.addEventListener('click', async () => {
    xlsx.disabled = true;
    try {
      save(await api.downloadExportXlsx(), `prumo-meus-dados-${day}.xlsx`);
    } catch {
      toast('Não consegui gerar a planilha agora.');
    }
    xlsx.disabled = false;
  });
  const pdf = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('printer'), 'Baixar PDF');
  pdf.addEventListener('click', async () => {
    pdf.disabled = true;
    try {
      const report = await api.getExport();
      const { buildReportPdf } = await import('../vendor/report.js');
      save(new Blob([await buildReportPdf(report)], { type: 'application/pdf' }), `prumo-meus-dados-${day}.pdf`);
    } catch {
      toast('Não consegui gerar o PDF agora.');
    }
    pdf.disabled = false;
  });
  return el('div', { class: 'button-row no-print' }, xlsx, pdf);
}

/** Assinar: aceite dos termos + cobrança mensal no cartão. Abre a página segura do provedor e espera a confirmação. */
export function drawCardCheckout(plan, mount, { api, onBack = null, onDone, before = 0, email = '' }) {
  let pollId = 0;
  const stop = () => window.clearInterval(pollId);
  const back = onBack ? el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('arrow-left'), 'Voltar') : null;
  back?.addEventListener('click', () => {
    stop();
    onBack();
  });
  // Quem está assinando: mostra o e-mail da conta e deixa trocar antes de seguir (evita assinar na conta errada).
  const swap = el('button', { class: 'link', type: 'button' }, 'Trocar de conta');
  swap.addEventListener('click', async () => {
    stop();
    await api.logout().catch(() => {});
    onDone();
  });
  const who = el('p', { class: 'muted', id: 'co-who' }, 'Assinando como ', el('strong', {}, email), ' · ', swap);
  const terms = el('input', { type: 'checkbox', id: 'co-terms' });
  const openTerms = el('button', { class: 'link', type: 'button' }, 'Termos e privacidade');
  openTerms.addEventListener('click', () => document.getElementById('dlg-terms')?.showModal());
  const go = el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', disabled: true }, `Continuar para o pagamento seguro`, icon('arrow-right'));
  // Dados de quem assina: mesmos componentes dos demais formulários (.field, .label, .hint, .input).
  const nameInput = el('input', { type: 'text', id: 'co-name', class: 'input', autocomplete: 'name', maxlength: '100', placeholder: 'Como está no seu documento' });
  const cpfInput = el('input', { type: 'text', id: 'co-cpf', class: 'input', inputmode: 'numeric', autocomplete: 'off', maxlength: '14', placeholder: '000.000.000-00' });
  const phoneInput = el('input', { type: 'tel', id: 'co-phone', class: 'input', inputmode: 'tel', autocomplete: 'tel-national', maxlength: '15', placeholder: '(11) 91234-5678' });
  const digits = (v) => v.replace(/\D/g, '');
  const maskCpf = (v) => digits(v).slice(0, 11).replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
  const maskPhone = (v) => digits(v).slice(0, 11).replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4,5})(\d{4})$/, '$1-$2');
  const refresh = () => { go.disabled = !(terms.checked && nameInput.value.trim().split(/\s+/).length >= 2 && nameInput.value.trim().length >= 5 && digits(cpfInput.value).length === 11); };
  cpfInput.addEventListener('input', () => { cpfInput.value = maskCpf(cpfInput.value); refresh(); });
  phoneInput.addEventListener('input', () => { phoneInput.value = maskPhone(phoneInput.value); });
  nameInput.addEventListener('input', refresh);
  terms.addEventListener('change', refresh);
  const body = card(
    back,
    el('h2', {}, `Assinar o plano ${plan.name}`),
    email ? who : null,
    el('p', { class: 'plan-sum' }, el('strong', {}, `${brl(plan.priceCents)} por mês`), ' · cobrança mensal no cartão de crédito'),
    el('ul', { class: 'tick-list left' },
      el('li', {}, icon('check'), 'Renova sozinha todo mês, no mesmo dia, até você cancelar'),
      el('li', {}, icon('check'), 'Cancele quando quiser, na própria conta: a cobrança para na hora'),
      el('li', {}, icon('check'), 'Ao cancelar, você usa o app e baixa seus dados até o fim do mês pago (sem reembolso do mês em andamento)'),
      el('li', {}, icon('check'), 'O cartão é digitado na página segura do provedor de pagamento; o Fôlego não vê nem guarda o número do cartão')),
    el('div', { class: 'field-row' },
      el('div', { class: 'field' }, el('label', { for: 'co-name', class: 'label' }, 'Nome completo'), nameInput),
      el('div', { class: 'field' }, el('label', { for: 'co-cpf', class: 'label' }, 'CPF'), cpfInput)),
    el('div', { class: 'field' }, el('label', { for: 'co-phone', class: 'label' }, 'Celular com DDD (opcional)'), phoneInput, el('p', { class: 'hint' }, 'Só para avisos sobre a cobrança e suporte.')),
    el('div', { class: 'check' }, terms, el('label', { for: 'co-terms' }, 'Li e aceito os ', openTerms, ' e autorizo a cobrança mensal recorrente de ', brl(plan.priceCents), ' no meu cartão até eu cancelar.')),
    go,
    el('p', { class: 'fine' }, 'Dúvida antes de assinar? Escreva para ', el('a', { class: 'link', href: 'mailto:suporte@folego.online' }, 'suporte@folego.online'), '.'),
  );
  mount.replaceChildren(body);
  go.addEventListener('click', async () => {
    // A página segura do provedor abre numa aba nova (aberta já no clique, para o navegador não bloquear) e esta tela
    // continua aqui, aguardando; quando o pagamento passa, ela mesma avança.
    go.disabled = true;
    go.textContent = 'Preparando o pagamento…';
    for (const n of [nameInput, cpfInput, phoneInput, terms]) n.disabled = true;
    let order;
    try {
      order = await api.createCheckout(plan.code, { name: nameInput.value.trim(), cpf: digits(cpfInput.value), ...(digits(phoneInput.value).length >= 10 ? { phone: digits(phoneInput.value) } : {}) });
    } catch (e) {
      for (const n of [nameInput, cpfInput, phoneInput, terms]) n.disabled = false;
      go.disabled = false;
      go.textContent = 'Continuar para o pagamento seguro';
      return toast(e?.message || 'Não deu para iniciar agora. Tente de novo.');
    }
    const demo = String(order.checkoutUrl).startsWith('DEMO-CARD');
    const status = el('p', { class: 'pix-status', role: 'status' }, icon('clock'), el('span', {}, 'Aguardando a confirmação do pagamento…'));
    if (demo) {
      const demoBtn = el('button', { class: 'btn btn-secondary btn-block', type: 'button' }, 'Simular cartão aprovado');
      demoBtn.addEventListener('click', () => api.demoConfirmPayment(order.orderId).catch(() => {}));
      go.replaceWith(el('div', { class: 'demo-notice', role: 'note' }, icon('alert'), el('p', {}, el('strong', {}, 'Ambiente de demonstração. '), 'Nenhum cartão será cobrado.')), demoBtn, status);
    } else if (order.returnsToSite) {
      // O Asaas devolve a pessoa ao Prumo depois de pagar: seguimos na MESMA aba. Ao voltar, a conta espera a confirmação.
      try {
        sessionStorage.setItem('prumo_pagando', JSON.stringify({ plan: plan.code, before }));
      } catch {
        /* sem armazenamento: ao voltar, a conta confere sozinha de qualquer jeito */
      }
      go.replaceWith(status);
      window.location.assign(order.checkoutUrl);
      return;
    } else {
      go.replaceWith(status, el('a', { class: 'btn btn-primary btn-lg btn-block', href: order.checkoutUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Abrir o pagamento seguro', icon('arrow-right')), el('p', { class: 'fine' }, 'Esta tela confirma sozinha quando o pagamento passar.'));
    }
    pollId = window.setInterval(async () => {
      const now = await api.getAccount().catch(() => null);
      if (now?.subscription?.active && now.subscription.periodEnd > before) {
        stop();
        toast('Assinatura ativada! Bem-vindo(a) ao Prumo.');
        onDone();
      }
    }, 1500);
  });
  return stop;
}

/**
 * Trocar de plano sem cancelar. A pessoa vê, antes de confirmar, a conta do pró-rata por dia:
 * upgrade paga hoje só a diferença proporcional dos dias que faltam; downgrade vira desconto na próxima fatura.
 * Nos meses seguintes vale o preço cheio do plano escolhido.
 */
function planChangeCard(ctx, current) {
  const others = PLANS.filter((p) => p.code !== current.code);
  const box = el('div', { class: 'acc-stack' });
  const draw = () => {
    const buttons = others.map((p) => {
      const up = p.priceCents > current.priceCents;
      const b = el('button', { class: `btn ${up ? 'btn-primary' : 'btn-secondary'} btn-sm`, type: 'button' }, `${up ? 'Fazer upgrade para' : 'Mudar para'} ${p.name} · ${brl(p.priceCents)}/mês`);
      b.addEventListener('click', () => pick(p, b));
      return b;
    });
    box.replaceChildren(
      el('p', { class: 'muted' }, 'Troque de plano sem cancelar. Você paga só a diferença proporcional dos dias que faltam no mês atual e, nos meses seguintes, o valor normal do plano escolhido.'),
      el('div', { class: 'button-row no-print' }, ...buttons),
    );
  };
  const nameOf = (code) => PLANS.find((p) => p.code === code)?.name ?? code;
  async function pick(target, btn) {
    btn.disabled = true;
    let q;
    try {
      q = await ctx.api.quotePlanChange(target.code);
    } catch (e) {
      btn.disabled = false;
      return toast(e?.message || 'Não consegui calcular agora. Tente de novo.');
    }
    btn.disabled = false;
    const when = dateBr(q.nextChargeOn);
    const upText = q.waived
      ? `Faltam só ${q.daysLeft} ${q.daysLeft === 1 ? 'dia' : 'dias'} do mês pago, então liberamos o ${nameOf(q.toPlan)} agora, sem cobrança extra. Em ${when} a mensalidade passa a ser ${brl(q.nextChargeCents)}.`
      : `Você paga hoje ${brl(q.chargeNowCents)}: a diferença entre os planos pelos ${q.daysLeft} dias que faltam até ${when}. O ${nameOf(q.toPlan)} vale assim que o pagamento passar. Em ${when} a mensalidade passa a ser ${brl(q.nextChargeCents)}, no mesmo dia de sempre.`;
    const downText = `O ${nameOf(q.toPlan)} vale agora e você deixa de ter os recursos exclusivos do ${nameOf(q.fromPlan)}. A diferença dos ${q.daysLeft} dias que faltam (${brl(q.creditCents)}) vira desconto na próxima fatura: ${brl(q.nextChargeCents)} em ${when}. Depois, ${brl(q.toPriceCents)} por mês.`;
    const ok = await confirmDialog({
      title: q.kind === 'upgrade' ? `Mudar para o ${nameOf(q.toPlan)}?` : `Voltar para o ${nameOf(q.toPlan)}?`,
      text: q.kind === 'upgrade' ? upText : downText,
      confirmLabel: q.kind === 'upgrade' && !q.waived ? `Pagar ${brl(q.chargeNowCents)} e mudar` : 'Confirmar a troca',
    });
    if (!ok) return;
    box.replaceChildren(el('p', { class: 'muted', role: 'status' }, 'Preparando a troca…'));
    let out;
    try {
      out = await ctx.api.changePlan(target.code);
    } catch (e) {
      draw();
      return toast(e?.message || 'Não consegui trocar agora. Tente de novo.');
    }
    if (out.status === 'applied') {
      toast(`Plano ${nameOf(q.toPlan)} ativado.`);
      return ctx.reloadAccount();
    }
    // Upgrade com cobrança: a diferença é paga na página segura do provedor; esta tela confirma sozinha quando o pagamento passar.
    const waiting = el('p', { class: 'pix-status', role: 'status' }, icon('clock'), el('span', {}, 'Aguardando a confirmação do pagamento…'));
    const demo = String(out.checkoutUrl).startsWith('DEMO-CARD');
    const action = demo
      ? (() => {
          const d = el('button', { class: 'btn btn-secondary btn-block', type: 'button' }, 'Simular cartão aprovado');
          d.addEventListener('click', () => ctx.api.demoConfirmPayment(out.orderId).catch(() => {}));
          return d;
        })()
      : el('a', { class: 'btn btn-primary btn-block', href: out.checkoutUrl, target: '_blank', rel: 'noopener noreferrer' }, `Abrir o pagamento seguro · ${brl(q.chargeNowCents)}`, icon('arrow-right'));
    box.replaceChildren(el('p', { class: 'muted' }, `Troca para o ${nameOf(q.toPlan)}: diferença proporcional de ${brl(q.chargeNowCents)}. O cartão é digitado na página segura do provedor.`), action, waiting);
    const id = window.setInterval(async () => {
      const now = await ctx.api.getAccount().catch(() => null);
      if (now?.subscription?.plan === q.toPlan) {
        window.clearInterval(id);
        toast(`Plano ${nameOf(q.toPlan)} ativado.`);
        ctx.reloadAccount();
      }
    }, 2000);
    window.setTimeout(() => window.clearInterval(id), 15 * 60_000);
  }
  draw();
  return card(el('h2', {}, 'Trocar de plano'), box);
}

/** Aba Plano: situação da assinatura mensal, cancelamento com aviso, dados e conta. */
export function viewPlano(ctx, FEATURE_LABEL) {
  const { acc, plan } = ctx;
  const b = acc.billing;
  const end = acc.subscription.periodEnd;
  const isMember = acc.role === 'member';
  const head = billingHeader(acc, plan);

  const status = [];
  if (isMember) status.push(el('p', { class: 'muted' }, `Você usa a conta compartilhada de ${acc.ownerEmail}. O plano e a cobrança são do titular.`));
  else if (!b) {
    status.push(el('p', { class: 'muted' }, `Seu acesso vai até ${dateBr(end)}. Para continuar sem interrupção, assine a renovação mensal no cartão de crédito.`));
    const go = el('button', { class: 'btn btn-primary', type: 'button' }, `Assinar o ${plan.name} · ${brl(plan.priceCents)}/mês`, icon('arrow-right'));
    go.addEventListener('click', () => ctx.startCheckout(plan));
    status.push(el('div', { class: 'button-row no-print' }, go));
  } else if (b.status === 'canceled') {
    status.push(el('p', { class: 'muted' }, `Para voltar, é só assinar de novo depois de ${dateBr(end)}. Se assinar antes de seus dados serem apagados, você continua de onde parou.`));
  } else {
    if (b.status === 'past_due') status.push(el('div', { class: 'note note-amber' }, icon('alert'), el('span', {}, `O cartão foi recusado na última cobrança. O provedor tenta de novo e avisamos por e-mail; seu acesso continua até ${dateBr(end)}. Se preferir, cancele abaixo.`)));
    status.push(el('p', { class: 'muted' }, `Assinatura mensal no cartão de crédito${b.priceCents ? `: ${brl(b.priceCents)} por mês` : ''}. Renova sozinha em ${dateBr(end)} e depois no mesmo dia de cada mês, até você cancelar.`));
    const cancel = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Cancelar assinatura');
    cancel.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Cancelar a assinatura?',
        text: `A cobrança para agora. Você continua usando o Prumo e pode baixar todos os seus dados até ${dateBr(end)}. Não devolvemos o valor do mês em andamento. Depois dessa data, seus dados são apagados automaticamente.`,
        confirmLabel: 'Cancelar assinatura',
        danger: true,
      });
      if (!ok) return;
      try {
        await ctx.api.setSubscriptionCancel(true);
        toast('Assinatura cancelada. Você pode usar e baixar seus dados até o fim do período.');
        ctx.reloadAccount();
      } catch (e) {
        toast(e?.message || 'Não consegui cancelar agora. Tente de novo.');
      }
    });
    status.push(el('div', { class: 'button-row no-print' }, cancel));
  }

  const logoutBtn = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Sair deste aparelho');
  logoutBtn.addEventListener('click', async () => {
    await ctx.api.logout().catch(() => {});
    ctx.reloadAccount();
  });
  const deleteBtn = el('button', { class: 'btn btn-danger btn-sm', type: 'button' }, icon('trash'), 'Apagar minha conta');
  deleteBtn.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Apagar a conta agora?', text: 'Apagamos seus lançamentos, dívidas, metas, lembretes e a assinatura, e paramos a cobrança. Isso não pode ser desfeito e não há reembolso do mês em andamento. Baixe seus dados antes, se quiser guardar.', confirmLabel: 'Apagar tudo', danger: true }))) return;
    try {
      await ctx.api.deleteAccount();
      ctx.reloadAccount();
    } catch {
      toast('Não consegui apagar agora. Tente de novo.');
    }
  });

  return el(
    'div', { class: 'acc-stack' },
    card(
      el('h2', {}, `Plano ${plan.name}`),
      el('p', { class: 'plan-line' }, el('span', { class: `pill tone-${head.tone === 'bad' ? 'attention' : head.tone === 'warn' ? 'attention' : 'ok'}` }, head.pill), el('span', { class: 'muted' }, ` ${head.line}`)),
      el('ul', { class: 'bullets' }, ...plan.features.map((f) => el('li', {}, FEATURE_LABEL[f] ?? f))),
      ...status,
    ),
    !isMember && b && b.status === 'active' ? planChangeCard(ctx, plan) : null,
    card(
      el('h2', {}, 'Seus dados'),
      el('p', { class: 'muted' }, 'Tudo o que você lançou é seu. Baixe quando quiser, em planilha (abre no Excel e no Google Planilhas) ou em PDF. Se cancelar, o download continua liberado até o fim do mês já pago.'),
      exportButtons(ctx.api),
    ),
    card(el('h2', {}, 'Conta'), el('p', { class: 'muted' }, acc.email), el('p', { class: 'fine' }, 'Precisa de ajuda? Escreva para ', el('a', { class: 'link', href: 'mailto:suporte@folego.online' }, 'suporte@folego.online'), '.'), el('div', { class: 'button-row no-print' }, logoutBtn, deleteBtn)),
  );
}

/** Aba Perfil: nome e quais e-mails a pessoa quer receber. */
export function viewPerfil(ctx) {
  const p = ctx.acc.profile ?? { displayName: null, notifyDigest: true, notifyReminders: true, marketing: true };
  const name = el('input', { class: 'input', id: 'pf-nome', type: 'text', maxlength: '60', autocomplete: 'name', placeholder: 'Como podemos te chamar?', value: p.displayName ?? '' });
  const toggle = (id, label, hint, on) => {
    const input = el('input', { type: 'checkbox', id });
    input.checked = on;
    return { input, row: el('div', { class: 'pref-row' }, el('div', { class: 'check' }, input, el('label', { for: id }, el('strong', {}, label), el('span', { class: 'fine muted' }, ` ${hint}`)))) };
  };
  const digest = toggle('pf-digest', 'Resumo semanal', 'Todo domingo: gastos da semana, o que vence e o foco das dívidas.', p.notifyDigest);
  const reminders = toggle('pf-lembretes', 'Lembretes de contas', 'E-mail na antecedência que você escolheu em cada lembrete.', p.notifyReminders);
  const news = toggle('pf-novidades', 'Novidades e dicas do Fôlego', 'Campanhas e conteúdos. Dá para cancelar a qualquer momento.', p.marketing);
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Salvar preferências');
  const form = el(
    'form', { class: 'entry-form' },
    el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'pf-nome' }, 'Seu nome (opcional)'), name),
    el('div', { class: 'field field-wide' }, el('span', { class: 'label' }, 'E-mail da conta'), el('p', { class: 'muted' }, ctx.acc.email)),
    el('div', { class: 'field field-wide' }, el('span', { class: 'label' }, 'Quais e-mails você quer receber'), digest.row, reminders.row, news.row, el('p', { class: 'fine muted' }, 'E-mails de segurança e de cobrança (código de acesso, cartão recusado, cancelamento) sempre são enviados.')),
    btn,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      const out = await ctx.api.updateProfile({ displayName: name.value.trim() || null, notifyDigest: digest.input.checked, notifyReminders: reminders.input.checked, marketing: news.input.checked });
      ctx.acc.profile = out;
      toast('Preferências salvas.');
    } catch {
      toast('Não consegui salvar agora.');
    }
    btn.disabled = false;
  });
  return el('div', { class: 'stack' }, appCard(ctx), assistantCard(ctx), card(el('h2', {}, 'Perfil e notificações'), form));
}

export { PLANS };
