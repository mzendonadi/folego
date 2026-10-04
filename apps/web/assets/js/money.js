// Campo de dinheiro com máscara: número sem vírgula é em reais ("1500" = R$ 1.500,00); com vírgula, os centavos ("1500,5" = R$ 1.500,50).
// Mesmo comportamento do formulário do diagnóstico (intake.js), para não haver dois jeitos de digitar valor no site.
import { el } from './dom.js';
import { fieldToCents, centsToField, maskMoneyLive } from './format.js';

/** @returns {{ input: HTMLInputElement, cents: () => (number|null), set: (cents: (number|null)) => void }} */
export function moneyInput({ id, ariaLabel, value = null, placeholder = '0,00', small = false } = {}) {
  const input = el('input', {
    class: `input${small ? ' input-sm' : ''} money`,
    id,
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'off',
    placeholder,
    'aria-label': ariaLabel,
  });
  const set = (cents) => {
    input.value = cents === null || cents === undefined ? '' : centsToField(cents);
  };
  set(value);
  // Digitando: só os pontos de milhar (1700 → 1.700, mil e setecentos reais). Ao sair do campo: fecha em 1.700,00.
  input.addEventListener('input', () => {
    input.value = maskMoneyLive(input.value);
    input.setSelectionRange(input.value.length, input.value.length);
  });
  input.addEventListener('blur', () => set(fieldToCents(input.value)));
  return { input, cents: () => fieldToCents(input.value), set };
}
