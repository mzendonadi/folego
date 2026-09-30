// Campo de dinheiro com máscara: a pessoa digita só números e os dois últimos viram centavos ("1500" → "15,00").
// Mesmo comportamento do formulário do diagnóstico (intake.js), para não haver dois jeitos de digitar valor no site.
import { el } from './dom.js';
import { fieldToCents, centsToField } from './format.js';

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
  input.addEventListener('input', () => {
    set(fieldToCents(input.value));
    input.setSelectionRange(input.value.length, input.value.length);
  });
  return { input, cents: () => fieldToCents(input.value), set };
}
