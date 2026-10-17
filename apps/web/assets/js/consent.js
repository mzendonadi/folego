// Aviso de cookies (LGPD): pergunta se podemos compartilhar dados de navegação com a Meta para publicidade.
// Não bloqueia o site: a página abre inteira e o aviso fica no rodapé da tela. "Aceitar" e "Recusar" têm o mesmo peso.
// Sem aceite, o servidor não envia nada à Meta (o PageView só sai com o cookie folego_ads).
import { API_BASE } from '../config.js';
import { el } from './dom.js';
import { enablePixel, track } from './meta-pixel.js';

const KEY = 'folego:cookies';
const MAX_AGE_MS = 170 * 24 * 3600 * 1000; // o cookie de aceite vale 180 dias: perguntamos de novo antes de vencer

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && (v.v === 'sim' || v.v === 'nao') && Date.now() - v.at < MAX_AGE_MS ? v.v : null;
  } catch {
    return null;
  }
}
function write(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v, at: Date.now() }));
  } catch {
    /* sem armazenamento: o aviso volta na próxima visita */
  }
}
async function send(ads, eventId) {
  if (!API_BASE) return;
  try {
    await fetch(`${API_BASE}/consent`, { method: 'POST', credentials: 'same-origin', headers: { 'x-folego': '1', 'content-type': 'application/json' }, body: JSON.stringify({ ads, ...(eventId ? { eventId } : {}) }) });
  } catch {
    /* sem rede: o servidor continua sem enviar nada */
  }
}

let banner = null;
function close() {
  banner?.remove();
  banner = null;
  document.body.classList.remove('has-cookie-banner');
}

export function openConsent() {
  if (banner) return;
  const yes = el('button', { class: 'btn btn-primary', type: 'button' }, 'Aceitar');
  const no = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Recusar');
  const more = el('button', { class: 'link', type: 'button', 'data-open': 'dlg-terms' }, 'Termos e privacidade');
  banner = el('section', { class: 'cookie-banner', role: 'region', 'aria-label': 'Aviso de cookies e privacidade' },
    el('h2', { class: 'cookie-title' }, 'Cookies e privacidade'),
    el('p', {}, 'Usamos o essencial para o site funcionar. Com a sua permissão, também compartilhamos ',
      el('strong', {}, 'dados de navegação (como endereço IP, navegador e páginas visitadas) com a Meta (Facebook e Instagram) para fins de publicidade'),
      ' e medição de anúncios. Se você recusar, o site funciona do mesmo jeito.'),
    el('div', { class: 'cookie-actions' }, yes, no, more));
  yes.addEventListener('click', () => {
    write('sim');
    const id = crypto.randomUUID();
    enablePixel();
    track('PageView', {}, id); // o servidor manda o mesmo PageView com este id: a Meta conta uma vez
    send(true, id);
    close();
  });
  no.addEventListener('click', () => { write('nao'); send(false); close(); });
  document.body.append(banner);
  document.body.classList.add('has-cookie-banner');
}

/** Quem já aceitou: avisa a API de cada visita (o servidor só repassa à Meta se o cookie de aceite estiver presente). */
async function pageview() {
  const id = crypto.randomUUID();
  enablePixel();
  track('PageView', {}, id);
  if (!API_BASE) return;
  try {
    await fetch(`${API_BASE}/pageview`, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'x-folego': '1', 'content-type': 'application/json' }, body: JSON.stringify({ path: location.pathname || '/', eventId: id }) });
  } catch {
    /* sem rede: sem PageView */
  }
}

export function initConsent() {
  document.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('[data-cookie-prefs]')) openConsent();
  });
  const choice = read();
  if (choice === null) openConsent();
  else if (choice === 'sim') pageview();
}
