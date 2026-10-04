// Preços e avisos que vêm do servidor (o dono edita no backoffice). Aqui só ficam os valores padrão de reserva
// (para o site continuar funcionando se o catálogo demorar) e a troca dos textos fixos do HTML.
import { el } from './dom.js';
import { CATALOG, applyCatalog, priceLabel } from './catalog.js';
import * as api from './api.js';

/** Troca os preços escritos no HTML: [data-price="codigo"] → "R$ 29"; [data-price-int] / [data-price-dec] para o cartão grande. */
export function bindStaticPrices(root = document) {
  root.querySelectorAll('[data-price]').forEach((n) => {
    const code = n.dataset.price;
    if (code === 'bundle') n.textContent = priceLabel('bundle');
    else if (CATALOG[code]) n.textContent = priceLabel(code);
  });
  root.querySelectorAll('[data-price-int]').forEach((n) => {
    const c = CATALOG[n.dataset.priceInt]?.cents;
    if (c !== undefined) n.textContent = String(Math.floor(c / 100));
  });
  root.querySelectorAll('[data-price-dec]').forEach((n) => {
    const c = CATALOG[n.dataset.priceDec]?.cents;
    if (c !== undefined) n.textContent = `,${String(c % 100).padStart(2, '0')}`;
  });
}

function showAnnouncement(a) {
  document.getElementById('site-announcement')?.remove();
  if (!a?.text) return;
  const bar = el('div', { class: `announce announce-${a.tone === 'warn' ? 'warn' : 'info'}`, id: 'site-announcement', role: 'status' }, a.text);
  document.body.prepend(bar);
}

export const site = { salesPaused: false };

/** Busca preços e avisos. Espera no máximo 1,5 s (o site nunca fica travado por isso). */
export async function loadCatalog() {
  try {
    const c = await Promise.race([api.getCatalog(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))]);
    applyCatalog(c);
    site.salesPaused = Boolean(c.salesPaused);
    bindStaticPrices();
    // A vitrine de guias só aparece na página inicial quando o dono liga ao menos um guia.
    const open = (c.products ?? []).filter((p) => p.code.startsWith('guide_') && p.active).map((p) => p.code);
    const box = document.getElementById('guias');
    document.querySelectorAll('[data-guides-link]').forEach((a) => { a.hidden = open.length === 0; });
    if (box) {
      box.hidden = open.length === 0;
      box.querySelectorAll('[data-guide]').forEach((a) => {
        a.hidden = !open.includes(a.dataset.guide);
      });
    }
    showAnnouncement(c.announcement);
  } catch {
    /* segue com os valores padrão */
  }
}

