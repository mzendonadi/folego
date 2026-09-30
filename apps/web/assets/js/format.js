const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlRound = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** R$ 1.234,56 (centavos → texto). */
export const brl = (cents) => brlFmt.format(cents / 100);
/** R$ 1.235: para manchetes, onde os centavos só atrapalham. */
export const brlWhole = (cents) => brlRound.format(Math.round(cents / 100));
/** 123456 → "1.234,56" (para dentro do campo de dinheiro). */
export const centsToField = (cents) => numFmt.format(cents / 100);
/** Só os dígitos viram centavos: "1.234,56" → 123456. Vazio → null. */
export function fieldToCents(text) {
  const digits = String(text).replace(/\D/g, '');
  if (digits === '') return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
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
