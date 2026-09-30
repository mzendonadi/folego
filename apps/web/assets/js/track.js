// Rastreamento próprio e anônimo (funil e jornada do backoffice): só o nome do evento, a tela e, uma vez por visita, a origem
// (UTM ou site de onde veio) e o tipo de aparelho. Sem IP, sem nome, sem e-mail, sem terceiros. Respeita "Não rastrear".
import { API_BASE } from '../config.js';
import * as api from './api.js';

const clean = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9._\- ]/g, '').trim().slice(0, 60);
const dnt = () => navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.msDoNotTrack === '1';

function attribution() {
  const q = new URLSearchParams(location.search);
  let source = clean(q.get('utm_source'));
  let medium = clean(q.get('utm_medium'));
  const campaign = clean(q.get('utm_campaign'));
  if (!source && document.referrer) {
    try {
      const host = new URL(document.referrer).hostname.replace(/^www\./, '');
      if (host && host !== location.hostname.replace(/^www\./, '')) {
        source = clean(host);
        medium = medium || 'referencia';
      }
    } catch {
      /* referência inválida: ignora */
    }
  }
  const device = window.matchMedia('(max-width: 767px)').matches ? 'mobile' : window.matchMedia('(max-width: 1100px)').matches ? 'tablet' : 'desktop';
  return { ...(source ? { source } : {}), ...(medium ? { medium } : {}), ...(campaign ? { campaign } : {}), device };
}

let attrSent = false;
try {
  attrSent = sessionStorage.getItem('folego_attr') === '1';
} catch {
  /* sessionStorage indisponível */
}

/** Registra um evento. Nunca lança erro nem atrasa a página. */
export function track(name, props = {}) {
  if (!API_BASE || dnt()) return;
  const body = { name, props };
  if (!attrSent) {
    attrSent = true;
    body.attr = attribution();
    try {
      sessionStorage.setItem('folego_attr', '1');
    } catch {
      /* segue sem guardar */
    }
  }
  api.trackEvent(body).catch(() => {});
}
