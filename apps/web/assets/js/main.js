import { $, $$, el, icon, announce, toast, scrollToTop, focusSoon, prefersReducedMotion } from './dom.js';
import { state, loadDraft, wipeAll, saveDraft } from './state.js';
import { initIntake, rebuildIntake, goTo, buildInput, isComplete } from './intake.js';
import { renderPreview, renderDelivery } from './results.js';
import { renderCheckout } from './checkout.js';
import { isPending, renderGenerated } from './generated.js';
import { renderTools } from './tools.js';
import { renderTranslator } from './translator.js';
import { renderPartner } from './partner.js';
import { renderAccount } from './account.js';
import { renderUnsubscribe } from './unsubscribe.js';
import { renderResumeBanner } from './banner.js';
import * as api from './api.js';
import { loadCatalog } from './prices.js';
import { track } from './track.js';

document.documentElement.classList.add('js');

// Link de indicação de amigo (?ind=CODIGO): guardamos o código para usar se a pessoa assinar o Prumo.
try {
  const ind = new URLSearchParams(location.search).get('ind');
  if (ind && /^[a-z0-9]{8}$/i.test(ind)) localStorage.setItem('folego_ind', ind.toLowerCase());
} catch {
  /* sem armazenamento: a indicação por convite de e-mail continua valendo */
}

const ROUTES = {
  landing: '#/',
  intake: '#/diagnostico',
  processing: '#/processando',
  preview: '#/resultado',
  checkout: '#/pagamento',
  delivery: '#/mapa',
  addon: '#/complemento',
  tools: '#/ferramentas',
  translator: '#/tradutor',
  partner: '#/parceiros',
  account: '#/conta',
  unsubscribe: '#/descadastrar',
};
const TITLES = {
  landing: 'Fôlego — organize suas dívidas e só pague se gostar',
  intake: 'Diagnóstico grátis — Fôlego',
  processing: 'Fazendo as contas — Fôlego',
  preview: 'Seu diagnóstico — Fôlego',
  checkout: 'Pagar com Pix — Fôlego',
  delivery: 'Seu Mapa da Virada — Fôlego',
  addon: 'Adicionar ao Mapa — Fôlego',
  tools: 'Ferramentas grátis — Fôlego',
  translator: 'Tradutor de cobrança — Fôlego',
  partner: 'Portal do parceiro — Fôlego',
  account: 'Prumo, o app de finanças — Fôlego',
  unsubscribe: 'Cancelar e-mails — Fôlego',
};
const HEADINGS = { intake: '#intake-title', processing: '#processing-title', preview: '#preview-title', checkout: '#checkout-title', addon: '#checkout-title', translator: '#translator-title', delivery: '#delivery-title', tools: '#tools-title' };

let current = 'landing';
let lastTrackedView = '';
let lastTrackedAt = 0;
let disposeCheckout = null;
let processingTimer = 0;
let generatedTimer = 0;

// ---------- roteamento ----------
function viewFromHash(hash) {
  if (hash === ROUTES.account || hash.startsWith(`${ROUTES.account}/`)) return 'account'; // #/conta e #/conta/<aba>
  if (hash.startsWith(`${ROUTES.unsubscribe}/`)) return 'unsubscribe'; // #/descadastrar/<assinatura>
  const found = Object.entries(ROUTES).find(([, h]) => h === hash);
  return found ? found[0] : null;
}

function show(view, { focus = true, scroll = true } = {}) {
  current = view;
  const section = view === 'addon' ? 'checkout' : view; // o complemento usa a mesma tela de pagamento
  $$('[data-view]').forEach((node) => {
    node.hidden = node.dataset.view !== section;
  });
  document.title = TITLES[view];
  const inFlow = view !== 'landing';
  $('.header-cta').hidden = inFlow || !heroGone;
  $('.header-exit').hidden = !inFlow;
  document.querySelectorAll('[data-landing-only]').forEach((n) => { n.hidden = inFlow; });
  document.body.dataset.route = view;
  // O roteador roda duas vezes por navegação (hashchange e popstate): a mesma tela em menos de 1,5 s conta uma vez só.
  if (view !== lastTrackedView || Date.now() - lastTrackedAt > 1500) track('view', { view });
  lastTrackedView = view;
  lastTrackedAt = Date.now();
  if (view !== 'delivery') window.clearTimeout(generatedTimer);
  if (view !== 'checkout' && view !== 'addon' && disposeCheckout) {
    disposeCheckout();
    disposeCheckout = null;
  }
  if (scroll) window.scrollTo({ top: 0, behavior: 'auto' });
  if (focus && HEADINGS[view]) focusSoon($(HEADINGS[view]));
}

function go(view) {
  const hash = ROUTES[view];
  if (location.hash !== hash) history.pushState({ view }, '', hash);
  route();
}

async function ensurePreview() {
  if (state.preview) return true;
  if (!isComplete()) return false;
  await runDiagnosis({ silent: true });
  return Boolean(state.preview);
}

// Já pagou? O cookie de sessão diz (sem cadastro). Se sim, o Mapa reabre sozinho depois de atualizar a página.
let accessChecked = null;
function restoreAccess() {
  if (!accessChecked) {
    accessChecked = api
      .getMe()
      .then(({ access, translator }) => {
        if (translator) state.translatorOrderId = translator.orderId;
        if (!access) return false;
        state.caseId = access.caseId;
        state.orderId = access.orderId;
        state.paid = true;
        return true;
      })
      .catch(() => false);
  }
  return accessChecked;
}

async function redeemLink(token) {
  try {
    const access = await api.redeemAccess(token);
    accessChecked = Promise.resolve(true);
    if (access.kind === 'translator') {
      state.translatorOrderId = access.orderId;
      history.replaceState({ view: 'translator' }, '', ROUTES.translator);
      return true;
    }
    state.caseId = access.caseId;
    state.orderId = access.orderId;
    state.paid = true;
    history.replaceState({ view: 'delivery' }, '', ROUTES.delivery); // tira o token da barra de endereço
    return true;
  } catch {
    history.replaceState({ view: 'landing' }, '', ROUTES.landing);
    toast('Este link não vale mais. Ele pode ter expirado ou ter sido trocado por um mais novo.');
    return false;
  }
}

async function openDelivery({ scrollTo = null } = {}) {
  const delivery = await api.getDelivery(state.orderId);
  const features = await api.getFeatures().catch(() => ({}));
  renderDelivery($('#delivery-root'), delivery, {
    onWipe: askWipe,
    onInviteFriend: async (body) => api.inviteLeadFriend(body),
    onLead: async (body) => {
      await api.submitLead(state.caseId, body);
      await openDelivery({ scrollTo: 'propostas' });
    },
    onLeadRevoke: async () => {
      await api.revokeLead(state.caseId);
      await openDelivery({ scrollTo: 'propostas' });
    },
    sendEmail: features.email ? (email) => api.emailAccessLink(state.orderId, email) : null,
    onAddon: (codes) => {
      state.addonCodes = codes;
      go('addon');
    },
    makeLink: async () => {
      const { token } = await api.createAccessLink(state.orderId);
      return `${location.origin}${location.pathname}#/acesso/${token}`;
    },
    onIncomeInterview: async (body) => {
      await api.submitIncomeInterview(state.caseId, body);
      await openDelivery({ scrollTo: 'renda' });
    },
    onIncomeTask: (key, done) => api.setIncomeProgress(state.caseId, key, done),
  });
  watchGenerated(state.orderId, delivery);
  if (scrollTo) window.setTimeout(() => document.getElementById(scrollTo)?.scrollIntoView({ block: 'start' }), 60);
  return delivery;
}

async function route() {
  if (location.hash.startsWith('#/acesso/')) {
    const ok = await redeemLink(decodeURIComponent(location.hash.slice('#/acesso/'.length)));
    if (!ok) return route();
  }
  let view = viewFromHash(location.hash) ?? 'landing';
  if ((view === 'delivery' || view === 'addon' || view === 'translator') && !state.paid) await restoreAccess();
  if (view === 'addon' && !state.addonCodes) return replaceWith(state.paid ? 'delivery' : 'landing');
  if (view === 'addon' && !state.paid && state.addonCodes[0] !== 'collection_translator') return replaceWith('landing');
  if (view === 'translator') await renderTranslatorView();
  if (view === 'partner') renderPartner($('#partner-root'));
  if (view === 'unsubscribe') renderUnsubscribe($('#unsubscribe-root'), location.hash.split('/')[2] ?? '');
  if (view === 'account') renderAccount($('#account-root'), { api, tab: location.hash.split('/')[2] ?? null });
  if (view === 'delivery' && state.paid && !$('#delivery-root').querySelector('.d-head')) {
    try {
      await openDelivery();
    } catch {
      state.paid = false;
      toast('Não consegui abrir o seu Mapa agora. Tente de novo em instantes.');
      return replaceWith('landing');
    }
  }
  if (view === 'tools') renderTools($('#tools-root'), { onStart: () => startFlow() });
  if (view === 'preview' || view === 'checkout') {
    if (!(await ensurePreview())) return replaceWith('intake');
  }
  if (view === 'checkout' && state.paid) return replaceWith('delivery');
  if (view === 'addon') renderAddonView();
  if (view === 'delivery' && !state.paid) return replaceWith(state.preview ? 'preview' : 'landing');
  if (view === 'processing') return replaceWith(state.preview ? 'preview' : 'intake');
  if (view === 'preview') renderPreviewView();
  if (view === 'checkout') renderCheckoutView();
  show(view);
}

function replaceWith(view) {
  history.replaceState({ view }, '', ROUTES[view]);
  return route();
}

// ---------- fluxo ----------
async function runDiagnosis({ silent = false } = {}) {
  try {
    const input = buildInput();
    const { caseId, preview } = await api.createCase(input);
    state.caseId = caseId;
    state.preview = preview;
    state.paid = false;
    state.orderId = null;
  } catch (error) {
    console.error(error);
    if (!silent) toast(error?.status === 429 ? 'Muitas tentativas seguidas. Espere um minutinho e tente de novo.' : 'Algo deu errado nas contas. Confira os dados e tente de novo.');
    state.preview = null;
  }
}

const PROCESSING_MESSAGES = ['Somando o que entra e o que sai', 'Vendo o que cada dívida custa', 'Montando a ordem de pagamento'];

async function onIntakeComplete() {
  saveDraft();
  show('processing');
  history.pushState({ view: 'processing' }, '', ROUTES.processing);
  const msg = $('#processing-msg');
  let i = 0;
  msg.textContent = PROCESSING_MESSAGES[0];
  window.clearInterval(processingTimer);
  processingTimer = window.setInterval(() => {
    i = (i + 1) % PROCESSING_MESSAGES.length;
    msg.textContent = PROCESSING_MESSAGES[i];
  }, 700);
  const minimum = new Promise((r) => window.setTimeout(r, prefersReducedMotion() ? 300 : 1900));
  await Promise.all([runDiagnosis(), minimum]);
  window.clearInterval(processingTimer);
  if (!state.preview) {
    go('intake');
    return;
  }
  history.replaceState({ view: 'preview' }, '', ROUTES.preview);
  renderPreviewView();
  show('preview');
}

function renderPreviewView() {
  renderPreview($('#preview-root'), state.preview, {
    onBuy: () => {
      track('cta', { id: 'buy_map' });
      go('checkout');
    },
    onWipe: askWipe,
  });
}

// Tradutor de cobrança: texto → leitura rápida grátis → Pix → explicação completa.
async function renderTranslatorView() {
  const ui = renderTranslator($('#translator-root'), {
    api,
    state,
    onBuy: (caseId, codes) => {
      state.translatorCaseId = caseId;
      state.addonCodes = codes;
      go('addon');
    },
  });
  if (state.translatorOrderId) {
    try {
      ui.drawResult(await api.getTranslation(state.translatorOrderId), state.translatorOrderId);
      return;
    } catch {
      state.translatorOrderId = null;
    }
  }
  ui.drawInput();
}

function setBack(target, label) {
  const back = $('#view-checkout .back-link');
  back.dataset.nav = target;
  back.lastChild.textContent = label;
}

function renderCheckoutView() {
  if (disposeCheckout) disposeCheckout();
  setBack('preview', 'Voltar ao diagnóstico');
  const eligible = state.preview.discoveries?.lettersEligible ?? state.preview.prescriptionTeaser.possibleCount;
  disposeCheckout = renderCheckout($('#checkout-root'), {
    offerLetters: eligible > 0,
    caseId: state.caseId,
    api,
    onPaid: async (orderId) => {
      state.orderId = orderId;
      state.paid = true;
      await openDelivery();
      history.pushState({ view: 'delivery' }, '', ROUTES.delivery);
      show('delivery');
    },
  });
}

// Complemento comprado depois do Mapa (Kit de Cartas, Calendário, Renda Extra): mesmo Pix, novo pedido.
function renderAddonView() {
  if (disposeCheckout) disposeCheckout();
  const codes = state.addonCodes;
  const forTranslator = codes[0] === 'collection_translator';
  setBack(forTranslator ? 'translator' : 'delivery', forTranslator ? 'Voltar ao tradutor' : 'Voltar ao meu Mapa');
  disposeCheckout = renderCheckout($('#checkout-root'), {
    addon: { codes },
    caseId: forTranslator ? state.translatorCaseId : state.caseId,
    api,
    onPaid: async (orderId) => {
      state.addonCodes = null;
      if (forTranslator) {
        state.translatorOrderId = orderId;
        history.pushState({ view: 'translator' }, '', ROUTES.translator);
        return route();
      }
      await openDelivery({ scrollTo: { defense_letters: 'cartas', calendar_30d: 'calendario', extra_income_plan: 'renda' }[codes[0]] });
      history.pushState({ view: 'delivery' }, '', ROUTES.delivery);
      show('delivery', { scroll: false });
    },
  });
}

// Roteiros e cartas são escritos em segundo plano: consulta a cada 4 s (por até ~10 min) e troca só essas seções.
function watchGenerated(orderId, delivery) {
  window.clearTimeout(generatedTimer);
  if (!isPending(delivery.generated)) return;
  let tries = 0;
  const tick = async () => {
    tries += 1;
    if (current !== 'delivery' || tries > 150) return;
    try {
      const fresh = await api.getDelivery(orderId);
      renderGenerated($('#delivery-root'), fresh.generated, {
        withLetters: fresh.items.includes('defense_letters'),
        onIncomeInterview: async (body) => {
          await api.submitIncomeInterview(state.caseId, body);
          await openDelivery({ scrollTo: 'renda' });
        },
        onIncomeTask: (key, done) => api.setIncomeProgress(state.caseId, key, done),
      });
      if (!isPending(fresh.generated)) return;
    } catch {
      /* falha de rede momentânea: tenta de novo */
    }
    generatedTimer = window.setTimeout(tick, 4000);
  };
  generatedTimer = window.setTimeout(tick, 4000);
}

// ---------- apagar dados ----------
// Trata o clique nos botões diretamente (não depende do evento "close" do <dialog>).
function askWipe() {
  const cancelBtn = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Cancelar');
  const confirmBtn = el('button', { class: 'btn btn-danger', type: 'button' }, icon('trash'), 'Apagar meus dados');
  const dialog = el(
    'dialog',
    { class: 'dialog dialog-sm', 'aria-labelledby': 'wipe-title' },
    el(
      'div',
      { class: 'dialog-inner' },
      el('header', { class: 'dialog-head' }, el('h2', { id: 'wipe-title' }, 'Apagar tudo agora?')),
      el('div', { class: 'dialog-body prose' }, el('p', {}, 'Vamos apagar o que você informou e o resultado deste diagnóstico. Isso não pode ser desfeito.')),
      el('footer', { class: 'dialog-foot' }, cancelBtn, confirmBtn),
    ),
  );
  const dispose = () => {
    if (dialog.open) dialog.close();
    dialog.remove();
  };
  cancelBtn.addEventListener('click', dispose);
  dialog.addEventListener('close', () => dialog.remove()); // tecla Esc
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    try {
      if (state.caseId) await api.deleteCase(state.caseId);
    } catch (error) {
      console.error(error);
      confirmBtn.disabled = false;
      toast('Não consegui apagar no servidor agora. Tente de novo em instantes.');
      return; // não finge que apagou: os dados locais ficam para a pessoa tentar de novo
    }
    dispose();
    wipeAll();
    rebuildIntake();
    replaceWith('landing');
    toast('Pronto. Seus dados foram apagados.');
    announce('Seus dados foram apagados.');
  });
  document.body.append(dialog);
  dialog.showModal();
  cancelBtn.focus();
}

// ---------- página ----------
let heroGone = false;

function startFlow() {
  if (state.step > 0 || state.doneSteps.length > 0) goTo(state.step, { focus: false });
  go('intake');
  window.setTimeout(() => goTo(state.step), 30);
}

function bindGlobalClicks() {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest('[data-start]')) {
      track('cta', { id: 'start' });
      return startFlow();
    }

    const nav = target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      return go(nav.dataset.nav);
    }

    const open = target.closest('[data-open]');
    if (open) {
      event.preventDefault();
      const dlg = document.getElementById(open.dataset.open);
      if (dlg instanceof HTMLDialogElement) dlg.showModal();
      return;
    }

    if (target.closest('[data-wipe]') && !target.closest('#view-preview, #view-delivery')) return askWipe();

    // Âncoras dentro da página (não são rotas): rolagem suave sem trocar de tela.
    const anchor = target.closest('a[href^="#"]');
    if (anchor && !anchor.getAttribute('href').startsWith('#/')) {
      const id = anchor.getAttribute('href').slice(1);
      const node = id ? document.getElementById(id) : null;
      if (node) {
        event.preventDefault();
        node.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        history.replaceState(history.state, '', `${location.pathname}${location.search}${ROUTES[current]}`);
      }
    }
  });
}

function observeReveal() {
  const items = $$('.reveal');
  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    items.forEach((n) => n.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  items.forEach((n) => io.observe(n));
}

function observeHero() {
  const hero = $('.hero');
  if (!hero || !('IntersectionObserver' in window)) {
    heroGone = true;
    return;
  }
  new IntersectionObserver(([entry]) => {
    heroGone = !entry.isIntersecting;
    if (current === 'landing') $('.header-cta').hidden = !heroGone;
  }).observe(hero);
}

function init() {
  loadDraft();
  initIntake({ timeline: $('#timeline'), summary: $('#summary'), onComplete: onIntakeComplete, onStep: (id) => track('intake_step', { step: id }) });
  bindGlobalClicks();
  observeReveal();
  observeHero();
  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);
  // Preços e aviso do site vêm do servidor (espera no máximo 1,5 s) antes do primeiro desenho.
  loadCatalog().then(route).then(() => {
    if (current === 'landing') restoreAccess().then((paid) => paid && current === 'landing' && renderResumeBanner($('#view-landing'), () => go('delivery')));
  });
}

init();
