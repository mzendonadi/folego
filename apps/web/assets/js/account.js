// Assinatura (#/conta): conta por e-mail sem senha (código de 6 dígitos) e, depois de assinar, uma área com abas
// (visão geral, lançamentos, orçamento, metas, treinador, simulador, plano). Linha separada dos avulsos:
// "sem assinatura" continua valendo para o Mapa e os complementos. O conteúdo das abas está em account-views.js.
import { el, icon, toast, copyText } from './dom.js';
import { brl, mmss } from './format.js';
import { qrSvg } from '../vendor/qr.js';
import { DEV } from '../config.js';
import { PLANS } from '../vendor/engine.js';
import { FEATURE_LABEL, TABS, VIEWS, NEEDS_MONTH, monthNow } from './account-views.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const TAB_IDS = TABS.map((t) => t.id);
const hashFor = (id) => (id === 'coach' ? '#/conta' : `#/conta/${id}`);

export function renderAccount(root, { api, tab: initialTab = null }) {
  let month = monthNow();
  let wantedTab = TAB_IDS.includes(initialTab) ? initialTab : 'coach';

  async function boot() {
    let acc;
    try {
      acc = await api.getAccount();
    } catch {
      return drawLogin();
    }
    if (!acc.subscription?.active) {
      const hh = await api.getHousehold().catch(() => null);
      return hh?.invite ? drawInvite(acc, hh) : drawPlans(acc);
    }
    return drawApp(acc);
  }

  // ---------- login por código ----------
  function drawLogin() {
    const email = el('input', { class: 'input', id: 'ac-email', type: 'email', autocomplete: 'email', required: true });
    const sendBtn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Enviar código');
    const sendForm = el('form', { class: 'tool-form' }, el('div', { class: 'field' }, el('label', { class: 'label', for: 'ac-email' }, 'Seu e-mail'), email), sendBtn);
    const codeBox = el('div', { hidden: true });
    sendForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      sendBtn.disabled = true;
      try {
        const out = await api.requestLoginCode(email.value.trim());
        drawCode(email.value.trim(), out.devCode);
      } catch (error) {
        sendBtn.disabled = false;
        toast(error?.status === 429 ? 'Você já pediu alguns códigos. Espere um pouco.' : 'Não consegui enviar o código agora.');
      }
    });
    root.replaceChildren(
      card(
        el('h2', {}, 'Entrar na sua conta'),
        el('p', { class: 'section-sub' }, 'Sem senha: mandamos um código de 6 dígitos para o seu e-mail, válido por 10 minutos.'),
        sendForm,
        codeBox,
      ),
    );
    function drawCode(addr, devCode) {
      const code = el('input', { class: 'input', id: 'ac-code', type: 'text', inputmode: 'numeric', maxlength: '6', autocomplete: 'one-time-code' });
      const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Entrar');
      const form = el(
        'form', { class: 'tool-form' },
        el('div', { class: 'field' }, el('label', { class: 'label', for: 'ac-code' }, `Código enviado para ${addr}`), code),
        devCode ? el('p', { class: 'fine' }, `Ambiente de desenvolvimento: código ${devCode}`) : null,
        btn,
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        btn.disabled = true;
        try {
          await api.loginWithCode(addr, code.value.trim());
          boot();
        } catch {
          btn.disabled = false;
          toast('Código incorreto ou vencido.');
        }
      });
      codeBox.replaceChildren(form);
      codeBox.hidden = false;
      code.focus();
    }
  }

  // ---------- Pix (assinar, renovar ou trocar de plano) ----------
  /** Desenha o pagamento dentro de `mount`. `before` = fim do período antes do pagamento (0 se ainda não há assinatura ativa). */
  function drawPix(plan, mount, { before = 0, onBack = null, onDone }) {
    let timerId = 0;
    let pollId = 0;
    const stop = () => {
      window.clearInterval(timerId);
      window.clearInterval(pollId);
    };
    const gen = el('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button' }, `Gerar Pix de ${brl(plan.priceCents)}`, icon('arrow-right'));
    const back = onBack ? el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('arrow-left'), 'Voltar') : null;
    back?.addEventListener('click', () => {
      stop();
      onBack();
    });
    const payCard = card(back, el('h2', {}, `${before ? 'Renovar' : 'Assinar'} ${plan.name}`), el('p', { class: 'muted' }, 'Pagamento único por Pix, válido por 30 dias. Sem cartão salvo e sem renovação automática.'), gen);
    mount.replaceChildren(payCard);
    gen.addEventListener('click', async () => {
      gen.disabled = true;
      gen.textContent = 'Gerando o Pix…';
      let order;
      try {
        order = await api.createSubscriptionOrder(plan.code);
      } catch {
        gen.disabled = false;
        gen.textContent = `Gerar Pix de ${brl(plan.priceCents)}`;
        return toast('Não deu para gerar o Pix agora. Tente de novo.');
      }
      const qrHolder = el('div', { class: 'qr', role: 'img', 'aria-label': 'QR Code do Pix' });
      qrHolder.innerHTML = qrSvg(order.pixCode);
      const status = el('p', { class: 'pix-status', role: 'status' }, icon('clock'), el('span', {}, 'Aguardando o pagamento…'));
      const timer = el('span', { class: 'pix-timer' });
      const codeInput = el('input', { class: 'input pix-code', type: 'text', readonly: true, value: order.pixCode, 'aria-label': 'Código Pix copia e cola' });
      const copyBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, icon('copy'), 'Copiar código');
      copyBtn.addEventListener('click', async () => toast((await copyText(order.pixCode)) ? 'Código copiado.' : 'Não consegui copiar.'));
      const demo = DEV || String(order.pixCode).startsWith('DEMO-');
      const demoBtn = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Simular pagamento aprovado');
      demoBtn.addEventListener('click', () => api.demoConfirmPayment(order.orderId).catch(() => {}));
      payCard.replaceChildren(...[
        back,
        el('h2', {}, `Pague ${brl(order.totalCents)} no Pix`),
        demo ? el('div', { class: 'demo-notice', role: 'note' }, icon('alert'), el('p', {}, el('strong', {}, 'Ambiente de demonstração. '), 'Nenhum valor será cobrado.')) : null,
        qrHolder,
        el('p', { class: 'muted center' }, 'Ou use o Pix copia e cola:'),
        el('div', { class: 'pix-code-row' }, codeInput, copyBtn),
        el('div', { class: 'pix-meta' }, status, el('p', { class: 'muted' }, 'Expira em ', timer)),
        demo ? demoBtn : null,
      ].filter(Boolean));
      const tick = () => {
        const left = (order.expiresAt - Date.now()) / 1000;
        timer.textContent = mmss(left);
        if (left <= 0) stop();
      };
      tick();
      timerId = window.setInterval(tick, 1000);
      pollId = window.setInterval(async () => {
        const now = await api.getAccount().catch(() => null);
        // Pago = o fim do período andou para a frente (serve para assinar, renovar e trocar de plano).
        if (now?.subscription?.active && now.subscription.periodEnd > before) {
          stop();
          toast(before ? 'Pagamento confirmado. Plano renovado!' : 'Assinatura ativada!');
          onDone();
        }
      }, 1500);
    });
    return stop;
  }

  // ---------- sem plano ativo: escolher ----------
  function drawPlans(acc) {
    const cards = PLANS.map((p) => {
      const btn = el('button', { class: 'btn btn-primary', type: 'button' }, `Assinar por ${brl(p.priceCents)}/mês`, icon('arrow-right'));
      btn.addEventListener('click', () => drawPix(p, root, { before: 0, onBack: () => drawPlans(acc), onDone: boot }));
      return el(
        'article', { class: 'script' },
        el('h3', {}, p.name), el('p', { class: 'muted' }, p.tagline),
        el('p', { class: 'card-price' }, el('strong', {}, brl(p.priceCents)), el('span', { class: 'muted' }, '/mês')),
        el('ul', { class: 'bullets' }, ...p.features.map((f) => el('li', {}, FEATURE_LABEL[f]))),
        p.soon.length > 0 ? el('p', { class: 'fine' }, `Em breve: ${p.soon.join(' ')}`) : null,
        btn,
      );
    });
    const logout = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Sair');
    logout.addEventListener('click', async () => {
      await api.logout();
      boot();
    });
    const expired = acc.subscription && !acc.subscription.active;
    root.replaceChildren(
      card(
        el('h2', {}, expired ? 'Seu plano venceu' : 'Escolha seu plano'),
        el('p', { class: 'section-sub' }, `Você está como ${acc.email}. ${expired ? 'Seus lançamentos e metas continuam guardados: é só renovar para voltar a usar. ' : ''}Pagamento por Pix, a cada 30 dias, sem cartão salvo.`),
        el('div', { class: 'plans' }, ...cards),
      ),
      card(logout),
    );
  }

  // ---------- convite para conta compartilhada (quem ainda não assina) ----------
  function drawInvite(acc, hh) {
    const accept = el('button', { class: 'btn btn-primary', type: 'button' }, 'Aceitar convite');
    accept.addEventListener('click', async () => {
      accept.disabled = true;
      try {
        await api.acceptHousehold();
        boot();
      } catch (e) {
        accept.disabled = false;
        toast(e?.message || 'Não consegui aceitar agora.');
      }
    });
    const plans = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Prefiro ter a minha própria conta');
    plans.addEventListener('click', () => drawPlans(acc));
    root.replaceChildren(card(el('h2', {}, 'Você recebeu um convite'), el('p', {}, el('strong', {}, hh.invite.ownerEmail), ' convidou você para dividir a conta de finanças dela(e) no Prumo. Ao aceitar, vocês veem e editam os mesmos lançamentos, dívidas, metas e lembretes. Só o titular paga.'), el('div', { class: 'button-row' }, accept, plans)));
  }

  // ---------- área da assinatura (com abas) ----------
  function drawApp(acc) {
    const plan = PLANS.find((p) => p.code === acc.subscription.plan);
    const days = Math.max(0, Math.ceil((acc.subscription.periodEnd - Date.now()) / 86_400_000));
    let current = wantedTab;
    let token = 0;
    let stopPix = () => {};

    const panel = el('div', { class: 'acc-panel', role: 'tabpanel', tabindex: '-1' });
    const tabButtons = TABS.map((t) => {
      const locked = t.needs && !plan.features.includes(t.needs);
      const b = el('button', { class: 'acc-tab', type: 'button', role: 'tab', id: `acc-tab-${t.id}`, 'aria-controls': 'acc-panel', 'data-tab': t.id }, t.label, locked ? icon('lock', 'icon icon-lock') : null);
      b.addEventListener('click', () => showTab(t.id));
      return b;
    });
    const groups = [...new Set(TABS.map((t) => t.group))];
    const tabbar = el(
      'div', { class: 'acc-tabs no-print', role: 'tablist', 'aria-label': 'Áreas do Prumo' },
      ...groups.map((g) => el('div', { class: 'acc-group', role: 'presentation' }, el('span', { class: 'acc-group-label', 'aria-hidden': 'true' }, g), ...tabButtons.filter((b) => TABS.find((t) => t.id === b.dataset.tab).group === g))),
    );
    tabbar.addEventListener('keydown', (e) => {
      const i = TAB_IDS.indexOf(current);
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TAB_IDS.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      const id = TAB_IDS[(next + TAB_IDS.length) % TAB_IDS.length];
      showTab(id);
      root.querySelector(`#acc-tab-${id}`)?.focus();
    });
    panel.id = 'acc-panel';

    const renewBtn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Renovar');
    renewBtn.addEventListener('click', () => showTab('plano'));
    const bar = el(
      'header', { class: 'acc-bar' },
      el('div', {}, el('span', { class: 'pill tone-ok' }, `Plano ${plan.name}`), el('p', { class: 'muted acc-mail' }, acc.email)),
      acc.role === 'member' ? el('p', { class: 'fine muted' }, 'Conta compartilhada de ' + acc.ownerEmail) : null,
      el('p', { class: 'muted acc-until' }, days === 0 ? 'Vence hoje' : `${days} ${days === 1 ? 'dia' : 'dias'} restantes`, acc.subscription.cancelAtPeriodEnd ? ' · não renova' : ''),
    );
    const warn = days <= 3 ? el('div', { class: 'note note-amber no-print' }, icon('alert'), el('div', { class: 'warn-row' }, el('span', {}, days === 0 ? 'Seu plano vence hoje.' : `Seu plano vence em ${days} ${days === 1 ? 'dia' : 'dias'}.`), renewBtn)) : null;

    const ctx = {
      api, acc, plan,
      has: (f) => plan.features.includes(f),
      get month() { return month; },
      set month(v) { month = v; },
      data: null,
      coach: null,
      goTab: (id) => showTab(id),
      refresh: () => showTab(current),
      setMonth: (m) => {
        month = m;
        showTab(current);
      },
      reloadAccount: boot,
      startPix: (p) => {
        stopPix();
        stopPix = drawPix(p, panel, { before: acc.subscription.periodEnd, onBack: () => showTab('plano'), onDone: boot });
      },
    };

    async function showTab(id) {
      stopPix();
      current = id;
      wantedTab = id;
      const mine = ++token;
      tabButtons.forEach((b) => {
        const on = b.dataset.tab === id;
        b.setAttribute('aria-selected', String(on));
        b.tabIndex = on ? 0 : -1;
        if (on && !window.matchMedia('(min-width: 960px)').matches) tabbar.scrollTo({ left: Math.max(0, b.offsetLeft - 24), behavior: 'smooth' });
      });
      panel.setAttribute('aria-labelledby', `acc-tab-${id}`);
      if (location.hash.startsWith('#/conta')) history.replaceState(history.state, '', hashFor(id));
      panel.replaceChildren(el('p', { class: 'muted acc-loading', role: 'status' }, 'Carregando…'));
      try {
        if (NEEDS_MONTH.has(id)) ctx.data = await api.getMonth(month);
        if (id === 'lancamentos') ctx.wallets = await ctx.api.getWallets().catch(() => null);
        if (id === 'coach') ctx.overview = await api.getCoachOverview();
        if (id === 'mercado') ctx.market = await api.getMarket();
        if (id === 'familia') ctx.household = await api.getHousehold();
        if (id === 'dividas') ctx.debts = await ctx.api.getDebts(ctx.debtExtra ?? 0);
        if (id === 'carteiras') ctx.wallets = await ctx.api.getWallets();
        if (id === 'lembretes') ctx.reminders = (await ctx.api.getReminders()).reminders;
        if (id === 'treinador') ctx.coach = await api.getCoach().catch(() => null);
        if (mine !== token) return; // a pessoa já foi para outra aba
        panel.replaceChildren(VIEWS[id](ctx));
      } catch (error) {
        if (mine !== token) return;
        if (error?.status === 402 || error?.status === 401) return boot(); // plano venceu ou sessão caiu
        const retry = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Tentar de novo');
        retry.addEventListener('click', () => showTab(id));
        panel.replaceChildren(card(el('h2', {}, 'Não consegui carregar'), el('p', { class: 'muted' }, 'Confira a conexão e tente de novo.'), retry));
      }
    }

    // replaceChildren() é API nativa: diferente do nosso el(), não ignora null — por isso o filter.
    root.replaceChildren(...[bar, warn, el('div', { class: 'acc-shell' }, tabbar, panel)].filter(Boolean));
    showTab(current);
  }

  return boot();
}
