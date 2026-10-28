// Assinatura (#/conta): conta por e-mail sem senha (código de 6 dígitos) e, depois de assinar, uma área com abas
// (visão geral, lançamentos, orçamento, metas, treinador, simulador, plano). Linha separada dos avulsos:
// "sem assinatura" continua valendo para o Mapa e os complementos. O conteúdo das abas está em account-views.js.
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';
import { PLANS } from '../vendor/engine.js';
import { FEATURE_LABEL, TABS, VIEWS, NEEDS_MONTH, monthNow } from './account-views.js';
import { drawCardCheckout, billingHeader, cancelNotice } from './account-billing.js';
import { installBanner, pushBanner, registerWorker } from './account-app.js';
import { hideHeaderAvatar, showHeaderAvatar } from './account-avatar.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const TAB_IDS = TABS.map((t) => t.id);
const hashFor = (id) => (id === 'coach' ? '/conta' : `/conta/${id}`);

/** Este navegador tem uma conta aberta? As telas do Mapa usam isso para só perguntar ao servidor o preço de assinante quando faz sentido. */
function rememberAccount(on) {
  try {
    if (on) localStorage.setItem('folego_prumo', '1');
    else localStorage.removeItem('folego_prumo');
  } catch {
    /* sem armazenamento: o Mapa segue com o preço normal */
  }
}

export function renderAccount(root, { api, tab: initialTab = null }) {
  registerWorker(); // necessário para instalar o Prumo no celular e receber notificações
  let month = monthNow();
  let wantedTab = TAB_IDS.includes(initialTab) ? initialTab : 'coach';

  // Voltou da página de pagamento do Asaas: o aviso do pagamento pode levar alguns segundos; esperamos aqui em vez de mostrar os planos.
  function takePending() {
    try {
      const raw = sessionStorage.getItem('prumo_pagando');
      sessionStorage.removeItem('prumo_pagando');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  async function waitPayment(acc, pending) {
    root.replaceChildren(card(el('h2', {}, 'Confirmando o seu pagamento…'), el('p', { class: 'pix-status', role: 'status' }, icon('clock'), el('span', {}, 'Leva só alguns segundos. Não precisa fazer nada.'))));
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const now = await api.getAccount().catch(() => null);
      if (now?.subscription?.active && now.subscription.periodEnd > (pending.before ?? 0)) {
        toast('Assinatura ativada! Bem-vindo(a) ao Prumo.');
        return now;
      }
    }
    return acc;
  }

  async function boot() {
    hideHeaderAvatar(); // só quem está dentro do Prumo (com assinatura) vê o ícone de perfil
    let acc;
    try {
      acc = await api.getAccount();
    } catch {
      rememberAccount(false);
      return drawLogin();
    }
    rememberAccount(true);
    const pending = takePending();
    if (pending && !(acc.subscription?.active && acc.subscription.periodEnd > (pending.before ?? 0))) acc = await waitPayment(acc, pending);
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
    // Conta de teste (ligada pelo dono): entra com e-mail e senha, sem código no e-mail.
    const pwEmail = el('input', { class: 'input', id: 'ac-pw-email', type: 'email', autocomplete: 'username', required: true });
    const pwPass = el('input', { class: 'input', id: 'ac-pw', type: 'password', autocomplete: 'current-password', required: true });
    const pwBtn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Entrar com senha');
    const pwForm = el('form', { class: 'tool-form', hidden: true }, el('div', { class: 'field' }, el('label', { class: 'label', for: 'ac-pw-email' }, 'E-mail da conta de teste'), pwEmail), el('div', { class: 'field' }, el('label', { class: 'label', for: 'ac-pw' }, 'Senha'), pwPass), pwBtn);
    pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      pwBtn.disabled = true;
      try {
        await api.loginWithPassword(pwEmail.value.trim(), pwPass.value);
        boot();
      } catch (error) {
        pwBtn.disabled = false;
        toast(error?.status === 429 ? 'Muitas tentativas. Espere alguns minutos.' : 'E-mail ou senha incorretos, ou a conta de teste está desligada.');
      }
    });
    const pwToggle = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Conta de teste? Entrar com senha');
    pwToggle.addEventListener('click', () => {
      pwForm.hidden = !pwForm.hidden;
      if (!pwForm.hidden) pwEmail.focus();
    });
    root.replaceChildren(
      card(
        el('h2', {}, 'Entrar na sua conta'),
        el('p', { class: 'section-sub' }, 'Sem senha: mandamos um código de 6 dígitos para o seu e-mail, válido por 10 minutos.'),
        sendForm,
        codeBox,
        el('div', {}, pwToggle),
        pwForm,
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

  // ---------- sem plano ativo: escolher ----------
  function drawPlans(acc) {
    const cards = PLANS.map((p) => {
      const btn = el('button', { class: 'btn btn-primary', type: 'button' }, `Assinar por ${brl(p.priceCents)}/mês`, icon('arrow-right'));
      btn.addEventListener('click', () => drawCardCheckout(p, root, { api, before: 0, email: acc.email, onBack: () => drawPlans(acc), onDone: boot }));
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
        el('h2', {}, expired ? 'Seu acesso terminou' : 'Escolha seu plano'),
        el('p', { class: 'section-sub' }, `Você está como ${acc.email}. Assinatura mensal no cartão de crédito, que renova sozinha todo mês e pode ser cancelada quando quiser, na própria conta.`),
        expired ? el('div', { class: 'note note-amber' }, icon('alert'), el('span', {}, acc.billing?.status === 'canceled' ? 'Seu plano foi cancelado e o acesso terminou. Seus dados são apagados automaticamente em breve. Se assinar de novo antes disso, você continua de onde parou.' : 'Seu plano não foi renovado e o acesso terminou. Se assinar de novo, você continua de onde parou.')) : null,
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
    const head = billingHeader(acc, plan);
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
      // "Perfil" não é aba da barra: abre pelo ícone do topo (a rota /conta/perfil continua valendo).
      ...groups.map((g) => el('div', { class: 'acc-group', role: 'presentation' }, el('span', { class: 'acc-group-label', 'aria-hidden': 'true' }, g), ...tabButtons.filter((b) => b.dataset.tab !== 'perfil' && TABS.find((t) => t.id === b.dataset.tab).group === g))),
    );
    const NAV_IDS = TAB_IDS.filter((id) => id !== 'perfil');
    tabbar.addEventListener('keydown', (e) => {
      const i = Math.max(NAV_IDS.indexOf(current), 0);
      const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: NAV_IDS.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      const id = NAV_IDS[(next + NAV_IDS.length) % NAV_IDS.length];
      showTab(id);
      root.querySelector(`#acc-tab-${id}`)?.focus();
    });
    panel.id = 'acc-panel';

    const bar = el(
      // No celular o plano, o nome, o e-mail e a renovação saem do topo (ficam em "Plano e dados"); o resto do cabeçalho só aparece se tiver aviso (conta de teste, conta compartilhada).
      'header', { class: 'acc-bar', ...(acc.demo || acc.role === 'member' ? { 'data-keep': '' } : {}) },
      el('div', {}, el('span', { class: `pill tone-${head.tone === 'ok' ? 'ok' : 'attention'} acc-hide-mobile` }, head.pill), acc.demo ? el('span', { class: 'pill tone-attention demo-pill', title: 'Conta de teste ligada pelo dono: nada é cobrado, nem aqui nem nos produtos avulsos.' }, 'Conta de teste · nada é cobrado') : null, el('p', { class: 'muted acc-mail acc-hide-mobile' }, acc.profile?.displayName ? `${acc.profile.displayName} · ${acc.email}` : acc.email)),
      acc.role === 'member' ? el('p', { class: 'fine muted' }, 'Conta compartilhada de ' + acc.ownerEmail) : null,
      el('p', { class: 'muted acc-until acc-hide-mobile' }, head.line),
    );
    const cancelBanner = acc.billing?.status === 'canceled'
      ? el('div', { class: 'note note-amber no-print' }, icon('alert'), el('div', { class: 'warn-row' }, el('span', {}, cancelNotice(new Date(acc.subscription.periodEnd).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })))))
      : acc.billing?.status === 'past_due'
        ? el('div', { class: 'note note-amber no-print' }, icon('alert'), el('span', {}, 'O cartão foi recusado na última cobrança. Veja a aba Plano.'))
        : null;

    const ctx = {
      api, acc, plan,
      has: (f) => plan.features.includes(f),
      get month() { return month; },
      set month(v) { month = v; },
      data: null,
      coach: null,
      goTab: (id) => showTab(id),
      // Depois de editar, apagar ou marcar algo, a tela recarrega no mesmo lugar: o conteúdo antigo fica à vista até o novo chegar e a rolagem volta para onde estava.
      refresh: () => showTab(current, { keepScroll: true }),
      setMonth: (m) => {
        month = m;
        showTab(current);
      },
      reloadAccount: boot,
      startCheckout: (p) => {
        stopPix();
        stopPix = drawCardCheckout(p, panel, { api, before: acc.subscription.periodEnd, email: acc.email, onBack: () => showTab('plano'), onDone: boot });
      },
    };

    async function showTab(id, { keepScroll = false } = {}) {
      const keepY = keepScroll && id === current ? window.scrollY : null;
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
      panel.setAttribute('aria-labelledby', id === 'perfil' ? 'acc-profile-btn' : `acc-tab-${id}`);
      document.getElementById('acc-profile-btn')?.toggleAttribute('data-active', id === 'perfil');
      if (location.pathname.startsWith('/conta')) history.replaceState(history.state, '', hashFor(id));
      if (keepY === null) panel.replaceChildren(el('p', { class: 'muted acc-loading', role: 'status' }, 'Carregando…'));
      try {
        if (ctx.leadsOn === undefined) ctx.leadsOn = Boolean((await api.getFeatures().catch(() => ({}))).leads); // convite a parceiros só se o recurso está ligado
        if (NEEDS_MONTH.has(id)) ctx.data = await api.getMonth(month);
        if (id === 'lancamentos') ctx.wallets = await ctx.api.getWallets().catch(() => null);
        if (id === 'coach') ctx.overview = await api.getCoachOverview();
        if (id === 'mercado') ctx.market = await api.getMarket();
        if (id === 'cobrancas') ctx.recurring = await api.getRecurring();
        if (id === 'contas' && ctx.has('market_pro')) ctx.of = await api.getOpenFinance().catch(() => ({ enabled: false, connections: [] }));
        if (id === 'cenarios' && ctx.has('scenarios')) ctx.scenarioBase = await api.getScenarioBase();
        if (id === 'indicar') ctx.referrals = await api.getReferrals();
        if (id === 'familia') ctx.household = await api.getHousehold();
        if (id === 'dividas') {
          [ctx.debts, ctx.mapOffer] = await Promise.all([ctx.api.getDebts(ctx.debtExtra ?? 0), ctx.api.getMapOffer().catch(() => ({ eligible: false }))]);
        }
        if (id === 'carteiras') ctx.wallets = await ctx.api.getWallets();
        if (id === 'cartoes' && ctx.has('cards')) {
          let cats = null;
          [ctx.cards, ctx.wallets, cats] = await Promise.all([ctx.api.getCards(), ctx.api.getWallets().catch(() => null), ctx.api.getCategories().catch(() => null)]);
          ctx.customCategories = cats?.custom ?? [];
        }
        if (id === 'cofre') ctx.vault = await api.getVault();
        if (id === 'lembretes') ctx.reminders = (await ctx.api.getReminders()).reminders;
        if (id === 'treinador') ctx.coach = await api.getCoach().catch(() => null);
        if (mine !== token) return; // a pessoa já foi para outra aba
        const view = VIEWS[id](ctx);
        const invite = id === 'coach' || id === 'geral' ? installBanner(showTab) : null; // convite para instalar o app (some ao instalar ou dispensar)
        const pushInvite = id === 'coach' || id === 'geral' ? pushBanner(ctx) : null; // convite para ligar as notificações neste aparelho
        const invites = [invite, pushInvite].filter(Boolean);
        const kids = id === 'geral' && invites.length ? [...(view.children ?? [])] : [];
        if (kids.length) {
          // Visão geral: o saldo do mês vem primeiro e os alertas logo depois; os convites (instalar, notificações) só entram a seguir
          const at = /Atenção/.test(kids[1]?.querySelector?.('h2')?.textContent ?? '') ? 1 : 0;
          kids[at].after(...invites);
          panel.replaceChildren(view);
        } else {
          panel.replaceChildren(...[...invites, view]);
        }
        if (keepY !== null) window.scrollTo({ top: keepY, behavior: 'instant' });
      } catch (error) {
        if (mine !== token) return;
        if (error?.status === 402 || error?.status === 401) return boot(); // plano venceu ou sessão caiu
        const retry = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Tentar de novo');
        retry.addEventListener('click', () => showTab(id));
        panel.replaceChildren(card(el('h2', {}, 'Não consegui carregar'), el('p', { class: 'muted' }, 'Confira a conexão e tente de novo.'), retry));
      }
    }

    // Celular: deslizar o dedo para o lado troca de aba (da direita para a esquerda avança, da esquerda para a direita volta).
    // Não vale sobre campos, tabelas e listas que rolam de lado, nem quando o gesto começa na borda da tela (é o "voltar" do navegador).
    {
      let sx = 0, sy = 0, st = 0, live = false;
      const narrow = () => window.matchMedia('(max-width: 959px)').matches;
      const blocked = (t) => {
        for (let n = t; n && n !== panel; n = n.parentElement) {
          if (/^(INPUT|TEXTAREA|SELECT|CANVAS|TABLE)$/.test(n.tagName) || n.isContentEditable || n.hasAttribute?.('data-noswipe')) return true;
          const ox = getComputedStyle(n).overflowX;
          if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 2) return true;
        }
        return false;
      };
      panel.addEventListener('touchstart', (e) => {
        live = false;
        if (e.touches.length !== 1 || !narrow() || blocked(e.target)) return;
        const p = e.touches[0];
        if (p.clientX < 24 || p.clientX > window.innerWidth - 24) return;
        sx = p.clientX; sy = p.clientY; st = Date.now(); live = true;
      }, { passive: true });
      panel.addEventListener('touchend', (e) => {
        if (!live) return;
        live = false;
        const p = e.changedTouches[0];
        const dx = p.clientX - sx, dy = p.clientY - sy;
        if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.7 || Date.now() - st > 700) return;
        if (String(window.getSelection?.() ?? '')) return;
        const i = NAV_IDS.indexOf(current);
        const next = i + (dx < 0 ? 1 : -1);
        if (i < 0 || next < 0 || next >= NAV_IDS.length) return;
        panel.classList.remove('swipe-next', 'swipe-prev');
        showTab(NAV_IDS[next]);
        window.scrollTo({ top: 0, behavior: 'instant' });
        void panel.offsetWidth; // reinicia a animação
        panel.classList.add(dx < 0 ? 'swipe-next' : 'swipe-prev');
        panel.addEventListener('animationend', () => panel.classList.remove('swipe-next', 'swipe-prev'), { once: true });
      }, { passive: true });
    }

    // replaceChildren() é API nativa: diferente do nosso el(), não ignora null — por isso o filter.
    root.replaceChildren(...[bar, cancelBanner, el('div', { class: 'acc-shell' }, tabbar, panel)].filter(Boolean));
    showHeaderAvatar(acc, () => showTab('perfil')); // ícone de perfil na linha da marca, no topo
    showTab(current);
  }

  return boot();
}
