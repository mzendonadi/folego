// Prumo > Dívidas: aviso do Mapa da Virada para quem assina.
//  - Ousado: oferta (preço de assinante no Pix e prazo de acesso; os valores vêm do servidor).
//  - Desbravador: o Mapa já é do plano; só o caminho para fazer o diagnóstico, sem preço nem pagamento.
//  - Controle: não aparece. Com Mapa ativo, vira um atalho para abrir o Mapa.
// O formulário é o mesmo da página inicial (/diagnostico): o botão usa o mesmo gatilho "data-start" do resto do site.
import { el, icon } from './dom.js';
import { brl } from './format.js';
import { newDebt, saveDraft, state } from './state.js';
import { rebuildIntake } from './intake.js';
import { partnerBanner } from './leads.js';

const fmtDay = (ms) => new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const daysLeft = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / 86_400_000));
const blank = (d) => !d.creditor.trim() && d.balanceCents === null;

/** Leva as dívidas já cadastradas no Prumo para o formulário do diagnóstico (a pessoa não digita tudo de novo). Só se o rascunho estiver vazio. */
function prefillFromPrumo(debts) {
  const list = (debts?.debts ?? []).filter((d) => !d.virtual && !d.paidOff && d.balanceCents > 0).slice(0, 12);
  if (list.length === 0 || !state.answers.debts.every(blank)) return;
  state.answers.debts = list.map((d) => ({
    ...newDebt(),
    creditor: d.name,
    balanceCents: d.balanceCents,
    paymentCents: d.minPaymentCents || null,
    ratePct: d.monthlyRateBps ? String(d.monthlyRateBps / 100).replace('.', ',') : '',
  }));
  saveDraft();
  rebuildIntake();
}

/** Convite "Quer ter ainda mais tranquilidade financeira? Fale com um parceiro": aparece nas telas principais do Prumo quando o recurso está ligado. */
export function partnerPrompt(ctx) {
  if (!ctx.leadsOn) return null;
  return partnerBanner({ onStart: () => prefillFromPrumo(ctx.debts) });
}

export function mapBanner(ctx) {
  const o = ctx.mapOffer;
  if (!o?.eligible) return null;

  // Mapa ativo: atalho para abrir (vale para os dois planos).
  if (o.active) {
    const left = daysLeft(o.active.until);
    const open = el('a', { class: 'btn btn-primary', href: '/mapa' }, 'Abrir meu Mapa', icon('arrow-right'));
    open.addEventListener('click', () => {
      state.caseId = o.active.caseId;
      state.orderId = o.active.orderId;
      state.paid = true;
    });
    return el(
      'section', { class: 'card map-banner map-banner-active', 'aria-labelledby': 'mb-title' },
      el('span', { class: 'map-banner-ico', 'aria-hidden': 'true' }, icon('map')),
      el('div', { class: 'map-banner-text' },
        el('h2', { id: 'mb-title' }, 'Seu Mapa da Virada está ativo'),
        el('p', {}, `Liberado até ${fmtDay(o.active.until)}${o.mode === 'free' ? ', enquanto sua assinatura valer' : ` (${left} ${left === 1 ? 'dia' : 'dias'})`}. Abra para ver o plano e use "Refazer" quando seus números mudarem.`),
        o.mode === 'paid' && left <= 7 ? el('p', { class: 'fine' }, `Depois dessa data ele se encerra e você pode liberar outro por ${brl(o.priceCents)} no Pix.`) : null),
      el('div', { class: 'map-banner-buy' }, open),
    );
  }

  const start = el('button', { class: 'btn btn-primary', type: 'button', 'data-start': '' }, o.mode === 'free' ? 'Fazer meu Mapa' : 'Liberar meu Mapa', icon('arrow-right'));
  start.addEventListener('click', () => prefillFromPrumo(ctx.debts)); // roda antes do gatilho geral, que abre o formulário

  if (o.mode === 'free') {
    return el(
      'section', { class: 'card map-banner', 'aria-labelledby': 'mb-title' },
      el('span', { class: 'map-banner-ico', 'aria-hidden': 'true' }, icon('map')),
      el('div', { class: 'map-banner-text' },
        el('h2', { id: 'mb-title' }, 'Mapa da Virada incluso no seu plano'),
        el('p', {}, `Faça o diagnóstico completo quando quiser: ordem de pagamento, roteiros de negociação e plano mês a mês. Fica liberado enquanto sua assinatura valer, com direito de refazer.${(ctx.debts?.debts ?? []).some((d) => !d.virtual && !d.paidOff && d.balanceCents > 0) ? ' As dívidas que você cadastrou aqui já vão preenchidas.' : ''}`)),
      el('div', { class: 'map-banner-buy' }, start),
    );
  }

  return el(
    'section', { class: 'card map-banner', 'aria-labelledby': 'mb-title' },
    el('span', { class: 'map-banner-ico', 'aria-hidden': 'true' }, icon('map')),
    el('div', { class: 'map-banner-text' },
      el('h2', { id: 'mb-title' }, 'Mapa da Virada com preço de assinante'),
      el('p', {}, `O diagnóstico completo, com ordem de pagamento e roteiros de negociação. ${o.days} dias de acesso e direito de refazer. Você vê o resultado grátis antes de pagar.`)),
    el('div', { class: 'map-banner-buy' },
      el('p', { class: 'map-price' },
        el('span', { class: 'map-was' }, el('span', { class: 'sr-only' }, 'De '), brl(o.regularCents)),
        el('strong', { class: 'map-now' }, el('span', { class: 'sr-only' }, 'por '), brl(o.priceCents)),
        o.discountCents > 0 ? el('span', { class: 'map-save' }, `economia de ${brl(o.discountCents)}`) : null),
      start,
      el('p', { class: 'fine' }, 'Pagamento único no Pix')),
  );
}
