// Tela de pagamento: resumo do pedido → Pix (QR + copia e cola) → confirmação.
// Nesta versão o pagamento é SIMULADO (ver api.js); o aviso fica visível na tela.
import { el, icon, announce, toast, copyText } from './dom.js';
import { brl, mmss } from './format.js';
import { qrSvg } from '../vendor/qr.js';
import { DEV } from '../config.js';
import { CATALOG, BUNDLE, daysOf } from './catalog.js';

/**
 * @param root elemento onde desenhar
 * @param ctx { offerLetters, addon: { codes } (só complementos, depois do Mapa), api: { createOrder, getOrderStatus, demoConfirmPayment }, caseId, onPaid(orderId) }
 * @returns função de limpeza (timers)
 */
export function renderCheckout(root, ctx) {
  let withLetters = false;
  let withCalendar = false;
  let timerId = 0;
  let pollId = 0;
  let orderId = null;
  let disposed = false;
  let contact = { email: '', phone: '' };

  const stop = () => {
    window.clearInterval(timerId);
    window.clearInterval(pollId);
  };

  const summaryCard = el('section', { class: 'card checkout-summary', 'aria-labelledby': 'co-sum-title' });
  const payCard = el('section', { class: 'card checkout-pay', 'aria-labelledby': 'co-pay-title' });
  root.replaceChildren(summaryCard, payCard);

  const addon = ctx.addon?.codes ?? null;

  // Valores lidos do catálogo na hora (o dono pode mudar); o servidor sempre recalcula o preço que vale.
  const MAP_CENTS = () => CATALOG.recovery_map.cents;
  const LETTERS_CENTS = () => CATALOG.defense_letters.cents;
  const BUNDLE_CENTS = () => BUNDLE.cents;
  const isBundle = () => !addon && withLetters && withCalendar;
  const bundleDiscount = () => (isBundle() ? MAP_CENTS() + LETTERS_CENTS() + CATALOG.calendar_30d.cents - BUNDLE_CENTS() : 0);
  const codes = () => addon ?? ['recovery_map', ...(withLetters ? ['defense_letters'] : []), ...(withCalendar ? ['calendar_30d'] : [])];

  function total() {
    if (addon) return addon.reduce((s, code) => s + CATALOG[code].cents, 0);
    return MAP_CENTS() + (withLetters ? LETTERS_CENTS() : 0) + (withCalendar ? CATALOG.calendar_30d.cents : 0) - bundleDiscount();
  }

  function drawSummary(locked = false) {
    const line = (label, cents, cls = '') => el('li', { class: `co-line ${cls}` }, el('span', {}, label), el('strong', {}, cents < 0 ? `- ${brl(-cents)}` : brl(cents)));
    const bumpBox = (id, checked, title, price, text, onChange) => {
      const input = el('input', { type: 'checkbox', id, checked, disabled: locked });
      input.addEventListener('change', (e) => {
        onChange(e.target.checked);
        drawSummary();
        drawIntro(); // o botão "Gerar Pix" mostra o valor: precisa refletir os complementos marcados
        announce(`Total: ${brl(total())}`);
      });
      return el('div', { class: 'bump' }, el('div', { class: 'check' }, input, el('label', { for: id }, el('strong', {}, title), el('span', { class: 'muted' }, `+ ${brl(price)} · ${text}`))));
    };
    const bumps = addon
      ? []
      : [
          ctx.offerLetters ? bumpBox('bump', withLetters, 'Adicionar o Kit de Cartas e Defesas', LETTERS_CENTS(), 'cartas prontas de prescrição e contestação, só para baixar e enviar', (v) => (withLetters = v)) : null,
          bumpBox('bump-cal', withCalendar, 'Adicionar o Calendário dos 30 dias', CATALOG.calendar_30d.cents, 'suas ações com data e lembretes no celular', (v) => (withCalendar = v)),
        ].filter(Boolean);
    const lines = addon
      ? addon.map((code) => line(CATALOG[code].name, CATALOG[code].cents))
      : [
          line('Mapa da Virada', MAP_CENTS()),
          withLetters ? line('Kit de Cartas e Defesas', LETTERS_CENTS()) : null,
          withCalendar ? line('Calendário dos 30 dias', CATALOG.calendar_30d.cents) : null,
          isBundle() ? line('Desconto Kit Completo', -bundleDiscount(), 'co-discount') : null,
        ].filter(Boolean);
    summaryCard.replaceChildren(
      el('h2', { id: 'co-sum-title' }, 'Seu pedido'),
      el('ul', { class: 'co-lines' }, ...lines),
      ...bumps,
      ...(!addon && !isBundle() && ctx.offerLetters ? [el('p', { class: 'fine' }, `Mapa + Cartas + Calendário juntos saem por ${brl(BUNDLE_CENTS())} (Kit Completo).`)] : []),
      el('div', { class: 'co-total' }, el('span', {}, 'Total'), el('strong', { 'aria-live': 'polite' }, brl(total()))),
      el('p', { class: 'note' }, icon('info'), el('span', {}, `Depois de pagar, você tem ${daysOf(addon ? addon[0] : 'recovery_map')} dias de acesso e pode refazer com dados novos quantas vezes quiser, sem pagar de novo. Uma contagem regressiva mostra quantos dias faltam.`)),
      el('p', { class: 'fine' }, 'Pagamento único por Pix. Sem assinatura e sem renovação automática.'),
    );
  }

  // Contato rápido (só no primeiro pedido do diagnóstico; os complementos reaproveitam o que já foi informado).
  const digitsOf = (v) => v.replace(/\D/g, '');
  const maskPhone = (v) => digitsOf(v).slice(0, 11).replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4,5})(\d{4})$/, '$1-$2');
  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
  function contactFields() {
    const email = el('input', { class: 'input', id: 'co-email', type: 'email', autocomplete: 'email', maxlength: '200', placeholder: 'voce@exemplo.com', value: contact.email });
    const phone = el('input', { class: 'input', id: 'co-phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', maxlength: '15', placeholder: '(11) 91234-5678', value: contact.phone });
    phone.addEventListener('input', () => { phone.value = maskPhone(phone.value); });
    email.setAttribute('aria-describedby', 'co-contact-hint');
    return el('div', { class: 'co-contact' },
      el('p', { class: 'hint', id: 'co-contact-hint' }, 'Usamos para enviar o link de acesso ao seu Mapa e os avisos do pedido, e também para medir e melhorar nossos anúncios (compartilhamos com a Meta). Guardamos com criptografia e apagamos em até 7 dias se você não pagar, ou 30 dias depois do pagamento.'),
      el('div', { class: 'field-row' },
        el('div', { class: 'field' }, el('label', { for: 'co-email', class: 'label' }, 'E-mail'), email),
        el('div', { class: 'field' }, el('label', { for: 'co-phone', class: 'label' }, 'Celular com DDD'), phone)),
    );
  }

  function drawIntro() {
    payCard.replaceChildren(...[
      el('h2', { id: 'co-pay-title' }, 'Gerar o código Pix'),
      el('p', { class: 'muted' }, addon ? 'Você gera o código, paga no app do seu banco e o item é liberado na hora.' : 'Você gera o código, paga no app do seu banco e o Mapa é liberado na hora.'),
      addon ? null : contactFields(),
      el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', id: 'gen-pix' }, `Gerar Pix de ${brl(total())}`, icon('arrow-right')),
      el('p', { class: 'fine' }, addon ? 'Pagamento único por Pix, sem renovação.' : 'Você só paga porque já viu o seu diagnóstico.'),
    ].filter(Boolean));
    payCard.querySelector('#gen-pix').addEventListener('click', generate);
  }

  async function generate() {
    const emailEl = payCard.querySelector('#co-email');
    if (emailEl) {
      const phoneEl = payCard.querySelector('#co-phone');
      contact = { email: emailEl.value.trim(), phone: phoneEl.value };
      const badEmail = !validEmail(contact.email);
      const badPhone = ![10, 11].includes(digitsOf(contact.phone).length);
      emailEl.toggleAttribute('aria-invalid', badEmail);
      phoneEl.toggleAttribute('aria-invalid', badPhone);
      if (badEmail || badPhone) return toast(badEmail ? 'Confira o e-mail: precisamos dele para enviar o seu acesso.' : 'Confira o celular: informe com DDD.');
    }
    const btn = payCard.querySelector('#gen-pix');
    btn.disabled = true;
    btn.textContent = 'Gerando o Pix…';
    try {
      const order = await ctx.api.createOrder({ caseId: ctx.caseId, products: codes(), ...(addon || !contact.email ? {} : { contact: { email: contact.email, phone: digitsOf(contact.phone) } }) });
      if (disposed) return;
      orderId = order.orderId;
      // Conta de teste ligada pelo dono: o servidor já confirmou o pedido, sem Pix e sem cobrança.
      if (order.status === 'paid') {
        toast('Conta de teste: liberado sem cobrança.');
        return ctx.onPaid(order.orderId);
      }
      drawSummary(true);
      drawPix(order);
    } catch (error) {
      btn.disabled = false;
      btn.textContent = `Gerar Pix de ${brl(total())}`;
      toast(error?.code === 'sales_paused' || error?.code === 'product_unavailable' ? error.message : 'Não deu pra gerar o Pix agora. Tente de novo.');
    }
  }

  function drawPix(order) {
    const qrHolder = el('div', { class: 'qr', role: 'img', 'aria-label': 'QR Code do Pix de demonstração' });
    qrHolder.innerHTML = qrSvg(order.pixCode); // SVG gerado localmente a partir de texto fixo, sem dados do usuário
    const status = el('p', { class: 'pix-status', role: 'status' }, icon('clock'), el('span', { id: 'pix-status-text' }, 'Aguardando o pagamento…'));
    const timer = el('span', { class: 'pix-timer', id: 'pix-timer' });
    const codeInput = el('input', { class: 'input pix-code', type: 'text', readonly: true, value: order.pixCode, 'aria-label': 'Código Pix copia e cola', id: 'pix-code' });
    const copyBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, icon('copy'), 'Copiar código');
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(order.pixCode);
      toast(ok ? 'Código copiado. É só colar no app do banco.' : 'Não consegui copiar. Selecione o código e copie manualmente.');
      if (!ok) codeInput.select();
    });
    const demoBtn = el('button', { class: 'btn btn-quiet', type: 'button', id: 'demo-pay' }, 'Simular pagamento aprovado');
    demoBtn.addEventListener('click', async () => {
      demoBtn.disabled = true;
      demoBtn.textContent = 'Confirmando…';
      await ctx.api.demoConfirmPayment(orderId);
    });

    // replaceChildren nativo escreve "null" na tela quando recebe null: os itens opcionais saem pelo filter(Boolean).
    payCard.replaceChildren(...[
      el('h2', { id: 'co-pay-title' }, `Pague ${brl(order.totalCents)} no Pix`),
      // Quem paga vê de quem é o Pix antes de abrir o banco (passa confiança e ensina a conferir o recebedor).
      el('p', { class: 'pix-trust' }, icon('shield'), el('span', {}, el('strong', {}, 'Este Pix é em nome de Matheus Zendonadi dos Santos, quem criou o Fôlego.'), ' Administrador de Empresas, especialista financeiro e em gestão de projetos. Antes de confirmar, confira o nome do recebedor no app do banco (ele pode aparecer abreviado).')),
      // O aviso aparece sempre que o código for de demonstração, inclusive no servidor de produção ainda sem Pix real.
      DEV || String(order.pixCode).startsWith('DEMO-') ? el('div', { class: 'demo-notice', role: 'note' }, icon('alert'), el('p', {}, el('strong', {}, 'Ambiente de demonstração. '), 'Este código não é um Pix real e nenhum valor será cobrado. Use "Simular pagamento aprovado" para ver como fica a entrega.')) : null,
      qrHolder,
      el('p', { class: 'muted center' }, 'Ou use o Pix copia e cola:'),
      el('div', { class: 'pix-code-row' }, codeInput, copyBtn),
      el('ol', { class: 'pix-steps' }, el('li', {}, 'Abra o app do seu banco e escolha Pix.'), el('li', {}, 'Leia o QR Code ou cole o código.'), el('li', {}, addon ? 'Confirme o valor. O item abre sozinho aqui.' : 'Confirme o valor. O Mapa abre sozinho aqui.')),
      el('div', { class: 'pix-meta' }, status, el('p', { class: 'muted' }, 'Expira em ', timer)),
      DEV || String(order.pixCode).startsWith('DEMO-') ? demoBtn : null,
    ].filter(Boolean));
    announce('Pix gerado. Aguardando o pagamento.');

    const tick = () => {
      const left = (order.expiresAt - Date.now()) / 1000;
      const t = payCard.querySelector('#pix-timer');
      if (t) t.textContent = mmss(left);
      if (left <= 0) {
        stop();
        drawExpired();
      }
    };
    tick();
    timerId = window.setInterval(tick, 1000);
    pollId = window.setInterval(async () => {
      const { status: st } = await ctx.api.getOrderStatus(orderId);
      if (disposed) return;
      if (st === 'paid') {
        stop();
        const text = payCard.querySelector('#pix-status-text');
        if (text) text.textContent = addon ? 'Pagamento confirmado! Abrindo…' : 'Pagamento confirmado! Abrindo seu Mapa…';
        announce('Pagamento confirmado. Abrindo seu Mapa.');
        window.setTimeout(() => ctx.onPaid(orderId), 900);
      }
    }, 1000);
  }

  function drawExpired() {
    drawSummary();
    payCard.replaceChildren(
      el('h2', { id: 'co-pay-title' }, 'O Pix expirou'),
      el('p', { class: 'muted' }, 'Sem problema: nada foi cobrado. Gere um novo código quando quiser.'),
      el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', id: 'gen-pix' }, 'Gerar novo Pix', icon('arrow-right')),
    );
    payCard.querySelector('#gen-pix').addEventListener('click', generate);
  }

  drawSummary();
  drawIntro();
  return () => {
    disposed = true;
    stop();
  };
}
