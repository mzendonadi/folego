// Auditoria de layout no navegador: injete no console da página e chame window.__audit(). Devolve só o que foge do padrão.
window.__audit = () => {
  const vw = innerWidth;
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    for (let p = e; p && p !== document.body; p = p.parentElement) {
      if (p.hidden) return false;
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  };
  const path = (e) => {
    const out = [];
    for (let p = e; p && p !== document.body && out.length < 3; p = p.parentElement) out.push(p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + (p.className && typeof p.className === 'string' ? '.' + p.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
    return out.join('<');
  };
  const res = { vw, overflowX: document.documentElement.scrollWidth - vw, outside: [], gridMargin: [], clipped: [], tinyText: [], tap: [], heights: {} };
  const bump = (k, h) => {
    res.heights[k] ??= {};
    res.heights[k][h] = (res.heights[k][h] ?? 0) + 1;
  };
  for (const e of [...document.body.querySelectorAll('*')].filter(vis)) {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    if (r.right > vw + 1 && !e.closest('.bo-table-wrap, .gantt, pre, [role="group"][tabindex="0"], .acc-tabs')) res.outside.push(path(e) + ' r=' + Math.round(r.right));
    const par = e.parentElement;
    if (par) {
      const pcs = getComputedStyle(par);
      const mt = parseFloat(cs.marginTop);
      const row = pcs.display.includes('grid') || (pcs.display.includes('flex') && pcs.flexDirection.startsWith('row'));
      if (row && mt > 1 && e.previousElementSibling && !['P', 'H2', 'H3'].includes(e.tagName)) res.gridMargin.push(path(e) + ' mt=' + Math.round(mt));
    }
    if (['hidden', 'clip'].includes(cs.overflowX) && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && cs.textOverflow !== 'ellipsis' && !['svg', 'use'].includes(e.tagName.toLowerCase())) res.clipped.push(path(e) + ' ' + e.scrollWidth + '>' + e.clientWidth);
    const fs = parseFloat(cs.fontSize);
    if (fs < 12 && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) res.tinyText.push(path(e) + ' ' + fs + 'px');
    const tag = e.tagName;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag) && !['checkbox', 'radio', 'hidden', 'range', 'file'].includes(e.type)) bump((tag === 'TEXTAREA' ? 'textarea' : tag.toLowerCase()) + (e.classList.contains('input-sm') ? '-sm' : ''), Math.round(r.height));
    if (e.matches('.btn')) bump('btn' + (e.classList.contains('btn-sm') ? '-sm' : ''), Math.round(r.height));
    if (['BUTTON', 'A'].includes(tag) && !e.closest('p, li, .prose, .fine, footer') && (r.height < 32 || r.width < 32) && !e.matches('.skip-link')) res.tap.push(path(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  const cap = (a, n = 8) => [...new Set(a)].slice(0, n);
  res.outside = cap(res.outside);
  res.gridMargin = cap(res.gridMargin);
  res.clipped = cap(res.clipped);
  res.tinyText = cap(res.tinyText, 5);
  res.tap = cap(res.tap, 6);
  return res;
};
