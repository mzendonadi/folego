// Pixel da Meta no navegador (LGPD): só é carregado DEPOIS do aceite no aviso de cookies. Sem aceite, nada de terceiros é baixado.
// Os mesmos eventos (Lead, InitiateCheckout, PageView) também saem do servidor (Conversions API) com o MESMO event_id:
// a Meta junta os dois e conta uma vez só, e o navegador ajuda a ligar a venda ao anúncio (cookies _fbp e _fbc).
// Correspondência automática de dados do formulário DESLIGADA: nenhum campo digitado é lido pelo pixel.
const PIXEL_ID = '1085904724208873';
let on = false;

function boot() {
  if (window.fbq) return;
  const n = (window.fbq = function () {
    n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
  });
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = '2.0';
  n.queue = [];
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.append(s);
}

/** Liga o pixel (chamado só depois do aceite). */
export function enablePixel() {
  if (on) return;
  on = true;
  boot();
  window.fbq('set', 'autoConfig', false, PIXEL_ID); // sem eventos automáticos nem leitura de campos
  window.fbq('init', PIXEL_ID);
}

/** Evento padrão; eventId igual ao do servidor evita contar em dobro. Sem aceite, não faz nada. */
export function track(name, params, eventId) {
  if (!on || !window.fbq) return;
  try {
    if (eventId) window.fbq('track', name, params || {}, { eventID: eventId });
    else window.fbq('track', name, params || {});
  } catch {
    /* o pixel nunca pode atrapalhar a compra */
  }
}

/** Cookie _fbp (criado pelo pixel): vai junto com o pedido para o servidor repassar à Meta. */
export function getFbp() {
  try {
    const m = /(?:^|;\s*)_fbp=(fb\.1\.\d{10,14}\.\d{5,20})(?:;|$)/.exec(document.cookie);
    return on && m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}
