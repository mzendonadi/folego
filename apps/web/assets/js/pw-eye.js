// Campo de senha com o ícone do "olho" no canto: mostra ou esconde o que foi digitado (acessível por teclado e leitor de tela).
const NS = 'http://www.w3.org/2000/svg';

function eyeSvg(off) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  };
  add('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' });
  add('circle', { cx: '12', cy: '12', r: '3' });
  if (off) add('path', { d: 'M4 4l16 16' });
  return svg;
}

/** Envolve o campo de senha já criado (o mesmo elemento segue valendo: ler `.value` continua igual). */
export function withEye(input) {
  const wrap = document.createElement('div');
  wrap.className = 'pw-wrap';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-eye';
  btn.setAttribute('aria-label', 'Mostrar a senha');
  btn.setAttribute('aria-pressed', 'false');
  btn.append(eyeSvg(false));
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Esconder a senha' : 'Mostrar a senha');
    btn.replaceChildren(eyeSvg(show));
    input.focus();
  });
  wrap.append(input, btn);
  return wrap;
}
