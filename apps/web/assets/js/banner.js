// Faixa no topo da página inicial para quem já pagou neste aparelho: volta ao Mapa sem cadastro.
import { el, icon } from './dom.js';

export function renderResumeBanner(landing, onOpen) {
  if (landing.querySelector('.resume-banner')) return;
  const btn = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Abrir meu Mapa', icon('arrow-right'));
  btn.addEventListener('click', onOpen);
  landing.prepend(el('div', { class: 'resume-banner' }, el('div', { class: 'wrap resume-inner' }, el('p', {}, el('strong', {}, 'Seu Mapa está liberado neste aparelho.'), ' Continue de onde parou.'), btn)));
}
