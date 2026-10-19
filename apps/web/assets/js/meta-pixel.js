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

const FBP_RE = /^fb\.1\.\d{10,14}\.\d{5,20}$/;
const FBC_RE = /^fb\.1\.\d{10,14}\.[A-Za-z0-9_-]{6,200}$/;
const readCookie = (n) => {
  try {
    const m = new RegExp(`(?:^|;\\s*)${n}=([^;]+)`).exec(document.cookie);
    return m ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined;
  }
};
function writeCookie(n, v) {
  try {
    document.cookie = `${n}=${encodeURIComponent(v)}; Max-Age=${90 * 24 * 3600}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch {
    /* sem cookie: o pixel tenta criar o dele */
  }
}
/** Cria _fbp (e _fbc, se veio de anúncio) JÁ, antes do pixel terminar de carregar: assim o primeiro PageView do servidor também leva os dois. O pixel reaproveita o que existir. */
function ensureIds() {
  if (!FBP_RE.test(readCookie('_fbp') || '')) writeCookie('_fbp', `fb.1.${Date.now()}.${Math.floor(1e9 + Math.random() * 9e9)}`);
  if (!FBC_RE.test(readCookie('_fbc') || '')) {
    let fbc;
    try {
      fbc = localStorage.getItem('folego_fbc') || undefined;
    } catch {
      /* sem armazenamento */
    }
    if (fbc && FBC_RE.test(fbc)) writeCookie('_fbc', fbc);
  }
}

/** Liga o pixel (chamado só depois do aceite). */
export function enablePixel() {
  if (on) return;
  on = true;
  ensureIds();
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
  const v = readCookie('_fbp');
  return on && v && FBP_RE.test(v) ? v : undefined;
}

/** Cookie _fbc (clique no anúncio): só existe se a pessoa chegou por um anúncio da Meta. */
export function getFbc() {
  const v = readCookie('_fbc');
  return on && v && FBC_RE.test(v) ? v : undefined;
}
