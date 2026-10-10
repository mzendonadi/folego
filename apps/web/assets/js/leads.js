// Fale com um parceiro Fôlego: aparece só se o servidor liga o recurso E há algo honesto a oferecer.
// Consentimento separado, caixa desmarcada, revogável. Nada disso muda a ordem do Mapa nem depende de comprar algo:
// quem só fez o diagnóstico grátis também pode usar (o perfil já veio do formulário; aqui só pedimos nome, telefone e o aceite).
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';

const CAT = {
  consignado: { label: 'Crédito consignado', hint: 'Trocar dívida cara por uma com juros menores', short: 'consignado' },
  renegotiation: { label: 'Renegociação e orientação', hint: 'Negociar as dívidas e buscar recursos com consciência', short: 'renegociação e orientação' },
};
const POINTS = ['Empresas parceiras selecionadas pelo Fôlego', 'Sem CPF e sem compromisso: você decide se segue', 'Você revoga quando quiser, aqui mesmo'];

/**
 * @param state { enabled, available, categories, estimatedSavingsCents, active }
 * @param handlers { onSubmit(body), onRevoke() }
 */
export function leadsSection(state, { onSubmit, onRevoke }) {
  if (!state?.enabled || (!state.available && !state.active)) return null;
  const shell = (...c) => el('section', { class: 'card partner-card', id: 'propostas', tabindex: '-1', 'aria-labelledby': 'propostas-t' }, ...c);
  const head = (title, sub) => el('header', { class: 'partner-head' },
    el('span', { class: 'partner-ico', 'aria-hidden': 'true' }, icon('shield')),
    el('div', {}, el('h2', { id: 'propostas-t' }, title), sub ? el('p', { class: 'partner-sub' }, sub) : null));

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
    return shell(
      head('Pronto: um parceiro vai falar com você', `Você autorizou o contato (${state.active.categories.map((k) => CAT[k]?.short ?? k).join(', ')}) em ${new Date(state.active.since).toLocaleDateString('pt-BR')}.`),
      el('p', { class: 'fine' }, 'Os parceiros que já receberam seu contato são avisados se você revogar e devem apagar os dados. Você pode revogar quando quiser.'),
      el('div', { class: 'no-print' }, btn),
    );
  }

  const cats = state.categories.map((k) => {
    const input = el('input', { type: 'checkbox', id: `lead-cat-${k}`, value: k });
    return el('label', { class: 'partner-opt', for: `lead-cat-${k}` }, input, el('span', {}, el('strong', {}, CAT[k].label), el('span', { class: 'muted' }, CAT[k].hint)));
  });
  const field = (label, input) => el('div', { class: 'field' }, el('label', { class: 'label', for: input.id }, label), input);
  const name = el('input', { class: 'input', id: 'lead-name', type: 'text', autocomplete: 'name', maxlength: '120' });
  const phone = el('input', { class: 'input', id: 'lead-phone', type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '(11) 91234-5678' });
  const email = el('input', { class: 'input', id: 'lead-email', type: 'email', autocomplete: 'email' });
  const consent = el('input', { type: 'checkbox', id: 'lead-consent' });
  const submit = el('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, 'Autorizar e falar com um parceiro');
  const form = el(
    'form', { class: 'partner-form', hidden: true },
    el('fieldset', { class: 'partner-cats' }, el('legend', { class: 'label' }, 'Sobre o que você quer conversar (marque só o que quiser)'), ...cats),
    field('Seu nome', name),
    field('Telefone com DDD (WhatsApp)', phone),
    el('div', { class: 'field partner-wide' }, el('label', { class: 'label', for: 'lead-email' }, 'E-mail (opcional)'), email),
    el('label', { class: 'check partner-consent', for: 'lead-consent' }, consent, el('span', {}, 'Autorizo o Fôlego a enviar meu nome, telefone e um resumo do meu perfil (faixa de renda, UF, tipo e faixa das dívidas) apenas a parceiros que atuam nas categorias marcadas. Posso revogar a qualquer momento aqui nesta página.')),
    el('p', { class: 'fine partner-wide' }, 'Não pedimos CPF: o parceiro só pede quando você falar com ele. Usamos o perfil do diagnóstico que você já preencheu, então não há nada a digitar de novo.'),
    el('div', { class: 'partner-actions' }, submit),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const categories = cats.map((c) => c.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
    if (categories.length === 0) return toast('Marque pelo menos um assunto.');
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
  const open = el('button', { class: 'btn btn-primary btn-lg no-print', type: 'button' }, 'Quero falar com um parceiro Fôlego', icon('arrow-right'));
  open.addEventListener('click', () => {
    form.hidden = false;
    open.hidden = true;
    name.focus();
  });
  return shell(
    head('Quer ter ainda mais tranquilidade financeira?', 'Fale com um parceiro e tenha ainda mais Fôlego.'),
    el('ul', { class: 'partner-points' }, ...POINTS.map((t) => el('li', {}, icon('check'), t))),
    state.categories.includes('consignado') && state.estimatedSavingsCents > 0
      ? el('p', { class: 'note' }, icon('info'), el('span', {}, `Estimativa: trocar dívidas caras por crédito consignado poderia reduzir cerca de ${brl(state.estimatedSavingsCents)} em juros. É uma simulação com taxas de referência, não uma oferta: a condição real depende de cada instituição.`))
      : null,
    el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Crédito novo é dívida nova: só faz sentido se reduz o que você paga no total.')),
    open,
    form,
  );
}

/** Faixa de convite (Prumo): leva ao diagnóstico grátis e, na prévia, ao formulário do parceiro. */
export function partnerBanner({ onStart } = {}) {
  const go = el('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-start': '', 'data-partner': '' }, 'Falar com um parceiro', icon('arrow-right'));
  if (onStart) go.addEventListener('click', onStart);
  return el('section', { class: 'partner-banner', 'aria-labelledby': 'pb-title' },
    el('div', { class: 'partner-banner-copy' },
      el('h2', { id: 'pb-title' }, 'Quer ter ainda mais tranquilidade financeira?'),
      el('p', {}, 'Fale com um parceiro e tenha ainda mais ', el('strong', {}, 'Fôlego'), '. Você faz o diagnóstico grátis, vê o seu resultado e, se quiser, escolhe conversar com empresas parceiras.')),
    el('div', { class: 'partner-banner-cta' }, go, el('p', { class: 'fine' }, 'Sem CPF, sem compromisso. Você revoga quando quiser.')));
}
