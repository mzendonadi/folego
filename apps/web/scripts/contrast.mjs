// Verifica contraste WCAG dos pares de cor do design (tokens em assets/styles.css devem refletir estes valores).
const themes = {
  claro: { paper: '#F6F3EC', surface: '#FFFFFF', sunken: '#EDE8DD', ink: '#13231D', ink2: '#3F514A', muted: '#586761', line: '#DDD6C8', field: '#78867F',
    primary: '#0E5B49', primaryInk: '#FFFFFF', primaryHover: '#0A4739', mint: '#D9EFE5', mintInk: '#0B4A3B',
    amberBg: '#FBEBCB', amberInk: '#6E4100', tightBg: '#FBE0D0', tightInk: '#7A2A08', ctaBg: '#0E5B49', ctaInk: '#F6F3EC', toneAttn: '#A55F00', toneTight: '#B8420F', toneCrit: '#B3261E', segA: '#6F7F78', segB: '#A55F00', segD: '#4E9E82', dangerBg: '#F8DDD6', dangerInk: '#8F2A17', okBg: '#DDF1E5', okInk: '#0F5A37' },
  escuro: { paper: '#0E1714', surface: '#15221E', sunken: '#1B2B26', ink: '#EAF1EC', ink2: '#C3D2CB', muted: '#9DB0A8', line: '#2A3C35', field: '#6A8479',
    primary: '#5FD6AB', primaryInk: '#062319', primaryHover: '#7BE2BD', mint: '#17322A', mintInk: '#A8EBD2',
    amberBg: '#3A2A0C', amberInk: '#F3C97A', tightBg: '#3F2013', tightInk: '#F7BFA0', ctaBg: '#16342B', ctaInk: '#EAF1EC', toneAttn: '#F0B44C', toneTight: '#F08C5A', toneCrit: '#F27B72', segA: '#7E918A', segB: '#F0B44C', segD: '#3E8F73', dangerBg: '#3D1C15', dangerInk: '#F5B3A5', okBg: '#143325', okInk: '#9BE3B9' },
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
// [texto, fundo, mínimo]: 4.5 texto normal; 3 componentes/UI e texto grande
const pairs = [
  ['ink', 'paper', 4.5], ['ink', 'surface', 4.5], ['ink2', 'paper', 4.5], ['ink2', 'surface', 4.5],
  ['muted', 'paper', 4.5], ['muted', 'surface', 4.5], ['muted', 'sunken', 4.5],
  ['primaryInk', 'primary', 4.5], ['primaryInk', 'primaryHover', 4.5], ['primary', 'paper', 4.5], ['primary', 'surface', 4.5],
  ['mintInk', 'mint', 4.5], ['amberInk', 'amberBg', 4.5], ['dangerInk', 'dangerBg', 4.5], ['okInk', 'okBg', 4.5],
  ['tightInk','tightBg',4.5],['ctaInk','ctaBg',4.5],['toneAttn','surface',3],['toneTight','surface',3],['toneCrit','surface',3],['segA','surface',3],['segB','surface',3],['segD','surface',3],['primary', 'paper', 3], // anel de foco / bordas de componentes
  ['line', 'paper', 1.2], ['field', 'surface', 3], ['field', 'paper', 3], ['field', 'sunken', 3],
];
let fail = 0;
for (const [name, t] of Object.entries(themes)) {
  for (const [fg, bg, min] of pairs) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) fail++;
    if (!ok || process.argv.includes('-v')) console.log(`${ok ? 'ok ' : 'FALHA'} [${name}] ${fg} sobre ${bg}: ${r.toFixed(2)} (mín ${min})`);
  }
}
console.log(fail === 0 ? 'Todos os pares passam.' : `${fail} par(es) reprovado(s).`);
process.exit(fail === 0 ? 0 : 1);
