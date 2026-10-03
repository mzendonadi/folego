// Botão "Falar com um parceiro Fôlego": leva ao formulário de autorização (#propostas) da própria página.
// O formulário só aparece quando o servidor liga o recurso; sem ele o botão avisa em vez de não fazer nada.
import { el, icon, toast } from './dom.js';

export function partnerButton(label = 'Quero falar com um parceiro Fôlego') {
  const b = el('button', { class: 'btn btn-secondary btn-sm partner-cta no-print', type: 'button' }, label, icon('arrow-right'));
  b.addEventListener('click', () => {
    const box = document.getElementById('propostas');
    if (!box) return toast('Esta opção não está disponível agora. Tente de novo em instantes.');
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    box.focus({ preventScroll: true });
  });
  return b;
}
