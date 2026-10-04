const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlRound = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** R$ 1.234,56 (centavos → texto). */
export const brl = (cents) => brlFmt.format(cents / 100);
/** R$ 1.235: para manchetes, onde os centavos só atrapalham. */
export const brlWhole = (cents) => brlRound.format(Math.round(cents / 100));
/** 123456 → "1.234,56" (para dentro do campo de dinheiro). */
export const centsToField = (cents) => numFmt.format(cents / 100);
/** Teto de reais que cabem num campo (R$ 999.999.999): evita valores absurdos e fica abaixo do limite da API. */
const MAX_REAIS_DIGITS = 9;

/**
 * Texto do campo → centavos, lendo como a pessoa escreve: número sem vírgula é em REAIS ("1700" = R$ 1.700,00),
 * com vírgula vêm os centavos ("1700,5" = R$ 1.700,50). Ponto seguido de 1-2 dígitos no fim vale como decimal ("15.5").
 * Vazio → null.
 */
export function fieldToCents(text) {
  const s = String(text).trim().replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const comma = s.lastIndexOf(',');
  let whole;
  let frac = '';
  if (comma >= 0) {
    whole = s.slice(0, comma);
    frac = s.slice(comma + 1);
  } else {
    const dot = s.match(/^(.*)\.(\d{1,2})$/);
    if (dot && !/^\d{1,3}(\.\d{3})+$/.test(s)) {
      whole = dot[1];
      frac = dot[2];
    } else whole = s;
  }
  whole = whole.replace(/\D/g, '').slice(0, MAX_REAIS_DIGITS);
  frac = frac.replace(/\D/g, '').slice(0, 2).padEnd(2, '0');
  const n = Number((whole || '0') + frac);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Máscara enquanto a pessoa digita: põe os pontos de milhar e preserva a vírgula e os decimais já digitados
 * ("1700" → "1.700"; "1700,5" → "1.700,5"), sem reescrever o que ela ainda está escrevendo.
 * Ao sair do campo, centsToField fecha em "1.700,50".
 */
export function maskMoneyLive(text) {
  const raw = String(text).replace(/[^\d,]/g, '');
  const comma = raw.indexOf(',');
  const whole = (comma >= 0 ? raw.slice(0, comma) : raw).replace(/^0+(?=\d)/, '').slice(0, MAX_REAIS_DIGITS);
  const frac = comma >= 0 ? raw.slice(comma + 1).replace(/\D/g, '').slice(0, 2) : null;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return frac === null ? grouped : `${grouped || '0'},${frac}`;
}

/** "1,5" ou "1.5" → 150 bps. Inválido → undefined. */
export function percentToBps(text) {
  const clean = String(text).trim().replace('%', '').replace(',', '.');
  if (clean === '') return undefined;
  const n = Number(clean);
  if (!Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 100);
}

export function formatMonths(n) {
  if (n <= 0) return 'menos de 1 mês';
  const years = Math.floor(n / 12);
  const months = n % 12;
  const y = years > 0 ? `${years} ${years === 1 ? 'ano' : 'anos'}` : '';
  const m = months > 0 ? `${months} ${months === 1 ? 'mês' : 'meses'}` : '';
  return [y, m].filter(Boolean).join(' e ');
}

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const plural = (n, one, many) => (n === 1 ? one : many);

export function mmss(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
