// Propostas de parceiros: aparece só se o servidor liga o recurso E há algo honesto a oferecer.
// Consentimento separado, caixa desmarcada, revogável. Nada disso muda a ordem do Mapa.
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';

const CAT = {
  consignado: { label: 'Crédito consignado (trocar dívida cara por uma com juros menores)', short: 'consignado' },
  renegotiation: { label: 'Renegociação das dívidas e orientação para buscar recursos com consciência', short: 'renegociação e orientação' },
};

export function leadsSection(state, { onSubmit, onRevoke }) {
  if (!state?.enabled || (!state.available && !state.active)) return null;
  const card = (...c) => el('section', { class: 'card d-section', id: 'propostas', tabindex: '-1', 'aria-labelledby': 'propostas-t' }, el('h2', { id: 'propostas-t' }, 'Fale com um parceiro Fôlego'), ...c);

  if (state.active) {
    const btn = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Revogar minha autorização');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await onRevoke();
        toast('Autorização revogada. Apagamos seus dados de contato e paramos os envios.');
      } catch {
        btn.disabled = false;
        toast('Não consegui revogar agora. Tente de novo em instantes.');
      }
    });
    return card(
      el('p', {}, `Você autorizou o recebimento de propostas (${state.active.categories.map((k) => CAT[k]?.short ?? k).join(', ')}) em ${new Date(state.active.since).toLocaleDateString('pt-BR')}.`),
      el('p', { class: 'fine' }, 'Parceiros que já receberam seu contato são avisados da revogação e devem apagar os dados. Você pode revogar quando quiser.'),
      el('div', { class: 'no-print' }, btn),
    );
  }

  const cats = state.categories.map((k) => {
    const input = el('input', { type: 'checkbox', id: `lead-cat-${k}`, value: k });
    return el('div', { class: 'check' }, input, el('label', { for: `lead-cat-${k}` }, CAT[k].label));
  });
  const name = el('input', { class: 'input', id: 'lead-name', type: 'text', autocomplete: 'name', maxlength: '120' });
  const phone = el('input', { class: 'input', id: 'lead-phone', type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '(11) 91234-5678' });
  const email = el('input', { class: 'input', id: 'lead-email', type: 'email', autocomplete: 'email' });
  const consent = el('input', { type: 'checkbox', id: 'lead-consent' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Autorizar e receber propostas');
  const form = el(
    'form', { class: 'tool-form', hidden: true },
    el('fieldset', { class: 'fieldset' }, el('legend', { class: 'label' }, 'O que você quer receber (marque só o que quiser)'), ...cats),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'lead-name' }, 'Seu nome'), name),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'lead-phone' }, 'Telefone com DDD (WhatsApp)'), phone),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'lead-email' }, 'E-mail (opcional)'), email),
    el('div', { class: 'check' }, consent, el('label', { for: 'lead-consent' }, 'Autorizo o Fôlego a enviar meu nome, telefone e um resumo do meu perfil (faixa de renda, UF, tipo e faixa das dívidas) apenas a parceiros que atuam nas categorias marcadas. Posso revogar a qualquer momento aqui nesta página.')),
    el('p', { class: 'fine' }, 'Não pedimos CPF: o parceiro só pede quando você falar com ele. Comprar o Mapa não depende desta autorização.'),
    submit,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const categories = cats.map((c) => c.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
    if (categories.length === 0) return toast('Marque pelo menos uma categoria.');
    if (!consent.checked) return toast('Para continuar, marque a autorização.');
    if (name.value.trim().length < 3 || phone.value.replace(/\D/g, '').length < 10) return toast('Confira nome e telefone.');
    submit.disabled = true;
    try {
      await onSubmit({ name: name.value.trim(), phone: phone.value.trim(), email: email.value.trim() || undefined, categories, consent: true });
      toast('Autorização registrada. Você pode revogar quando quiser.');
    } catch (error) {
      submit.disabled = false;
      toast(error?.status === 409 ? 'Você já autorizou. Atualize a página.' : 'Não consegui registrar agora. Confira os dados e tente de novo.');
    }
  });
  const open = el('button', { class: 'btn btn-secondary no-print', type: 'button' }, 'Quero receber propostas');
  open.addEventListener('click', () => {
    form.hidden = false;
    open.hidden = true;
    name.focus();
  });
  return card(
    el('p', { class: 'section-sub' }, 'Depois de ver o seu Mapa, você pode receber propostas de empresas parceiras. É opcional e separado da compra.'),
    state.categories.includes('consignado') && state.estimatedSavingsCents > 0
      ? el('p', { class: 'note' }, icon('info'), el('span', {}, `Estimativa: trocar dívidas caras por crédito consignado poderia reduzir cerca de ${brl(state.estimatedSavingsCents)} em juros. É uma simulação com taxas de referência, não uma oferta: a condição real depende de cada instituição.`))
      : null,
    el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'O Fôlego recebe comissão dos parceiros. Isso não muda a ordem do seu Mapa. Crédito novo é dívida nova: só faz sentido se reduz o que você paga no total.')),
    open,
    form,
  );
}
