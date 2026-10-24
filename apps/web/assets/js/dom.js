export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Cria elemento sem innerHTML: seguro para qualquer texto vindo do usuário. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Ícone do sprite (decorativo). */
export function icon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** Anuncia para leitores de tela sem mexer no foco. */
export function announce(message) {
  const live = $('#live');
  if (!live) return;
  live.textContent = '';
  window.setTimeout(() => {
    live.textContent = message;
  }, 30);
}

let toastTimer = 0;
export function toast(message) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.hidden = true;
  }, 3200);
}

export function scrollToTop() {
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** Traz um campo para a área visível: entre o cabeçalho fixo e a barra do Continuar (que fica fixa no rodapé no celular).
    Usado quando um campo obrigatório acaba de aparecer ou de dar erro, para a pessoa nunca precisar rolar a tela por conta própria. */
export function revealField(node) {
  if (!node || node.hidden) return;
  window.requestAnimationFrame(() => {
    const header = document.querySelector('.site-header');
    const bar = document.querySelector('.step[data-state="active"] .step-actions');
    const top = (header ? Math.max(0, header.getBoundingClientRect().bottom) : 0) + 12;
    const barTop = bar && getComputedStyle(bar).position === 'sticky' ? bar.getBoundingClientRect().top : window.innerHeight;
    const banner = document.querySelector('.cookie-banner'); // o aviso de cookies também cobre o rodapé enquanto a pessoa não escolhe
    const bannerTop = banner ? banner.getBoundingClientRect().top : window.innerHeight;
    const bottom = Math.min(barTop, bannerTop, window.innerHeight) - 12;
    const r = node.getBoundingClientRect();
    let dy = 0;
    if (r.top < top || r.height > bottom - top) dy = r.top - top; // acima da área, ou maior que ela: alinha o começo
    else if (r.bottom > bottom) dy = r.bottom - bottom; // escondido atrás da barra: sobe só o necessário
    if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
}

export function focusSoon(node) {
  if (!node) return;
  window.requestAnimationFrame(() => node.focus({ preventScroll: true }));
}

/** Copia para a área de transferência, com plano B para navegadores sem permissão. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { 'aria-hidden': 'true', tabindex: '-1', style: 'position:fixed;opacity:0;top:0;left:0' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
