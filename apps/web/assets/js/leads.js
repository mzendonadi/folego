// Fale com um parceiro Fôlego: aparece só se o servidor liga o recurso E há algo honesto a oferecer.
// Consentimento separado, caixa desmarcada, revogável. Nada disso muda a ordem do Mapa nem depende de comprar algo:
// quem só fez o diagnóstico grátis também pode usar (o perfil já veio do formulário; aqui só pedimos nome, telefone e o aceite).
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';

const CAT = {
  consignado: { label: 'Crédito consignado', hint: 'Consignados para CLT, Aposentados e Concursados', short: 'consignado' },
  renegotiation: { label: 'Renegociação e orientação', hint: 'Negociar as dívidas e buscar recursos com consciência', short: 'renegociação e orientação' },
};
const POINTS = ['Empresas parceiras selecionadas pelo Fôlego', 'Propostas sem compromisso', 'Crédito rápido e seguro'];
// Para quem tem vínculo e renda que costumam abrir o consignado (renda, idade e vínculo vêm do diagnóstico): argumentos concretos e honestos, sem prometer aprovação.
const PRIORITY_POINTS = [
  'O consignado costuma ter juros bem menores que cartão de crédito e cheque especial',
  'Uma parcela só, descontada direto da folha ou do benefício: menos risco de atrasar',
  'Você compara as propostas e só fecha se o total que você paga diminuir',
  'Empresas parceiras selecionadas pelo Fôlego, com atendimento por WhatsApp',
];

/**
 * @param state { enabled, available, categories, estimatedSavingsCents, active }
 * @param handlers { onSubmit(body), onBuy?() }  onBuy: depois da autorização, leva ao botão de compra do Mapa ("Concluir meu Mapa")
 */
export function leadsSection(state, { onSubmit, onBuy }) {
  if (!state?.enabled || (!state.available && !state.active)) return null;
  const shell = (...c) => el('section', { class: 'card partner-card', id: 'propostas', tabindex: '-1', 'aria-labelledby': 'propostas-t' }, ...c);
  const head = (title, sub) => el('header', { class: 'partner-head' },
    el('span', { class: 'partner-ico', 'aria-hidden': 'true' }, icon('shield')),
    el('div', {}, el('h2', { id: 'propostas-t' }, title), sub ? el('p', { class: 'partner-sub' }, sub) : null));

  if (state.active) {
    // Quem pediu para falar com um parceiro ainda não tem o Mapa: o próximo passo é concluir o Mapa (mesmo botão de compra da prévia).
    const conclude = onBuy ? el('button', { class: 'btn btn-primary btn-lg', type: 'button', 'data-conclude-map': '' }, 'Concluir meu Mapa', icon('arrow-right')) : null;
    conclude?.addEventListener('click', () => onBuy());
    return shell(
      head('Pronto: um parceiro vai falar com você', `Você autorizou o contato (${state.active.categories.map((k) => CAT[k]?.short ?? k).join(', ')}) em ${new Date(state.active.since).toLocaleDateString('pt-BR')}.`),
      conclude ? el('p', { class: 'fine' }, 'Enquanto isso, conclua o seu Mapa: a ordem certa para pagar e os roteiros de negociação.') : null,
      conclude ? el('div', { class: 'no-print' }, conclude) : null,
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
    el('label', { class: 'check partner-consent', for: 'lead-consent' }, consent, el('span', {}, 'Autorizo o Fôlego a enviar meu nome, telefone e um resumo do meu perfil (faixa de renda, UF, tipo e faixa das dívidas) apenas a parceiros que atuam nas categorias marcadas. Posso revogar a qualquer momento, por e-mail.')),
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
      toast('Autorização registrada. Agora é só concluir o seu Mapa.');
    } catch (error) {
      submit.disabled = false;
      toast(error?.status === 409 ? 'Você já autorizou. Atualize a página.' : 'Não consegui registrar agora. Confira os dados e tente de novo.');
    }
  });
  const priority = state.priority === true;
  const open = el('button', { class: 'btn btn-primary btn-lg no-print', type: 'button' }, priority ? 'Quero propostas para o meu perfil' : 'Quero falar com um parceiro Fôlego', icon('arrow-right'));
  open.addEventListener('click', () => {
    form.hidden = false;
    open.hidden = true;
    name.focus();
  });
  return shell(
    priority
      ? head('Seu perfil costuma ter as melhores condições de crédito', 'Pelo que você informou, um parceiro pode avaliar trocar dívidas caras por uma parcela menor. Sem compromisso e sem custo para você.')
      : head('Quer ter ainda mais tranquilidade financeira?', 'Fale com um parceiro e tenha ainda mais Fôlego.'),
    el('ul', { class: 'partner-points' }, ...(priority ? PRIORITY_POINTS : POINTS).map((t) => el('li', {}, icon('check'), t))),
    state.categories.includes('consignado') && state.estimatedSavingsCents > 0
      ? el('p', { class: 'note' }, icon('info'), el('span', {}, `Estimativa: trocar dívidas caras por crédito consignado poderia reduzir cerca de ${brl(state.estimatedSavingsCents)} em juros. É uma simulação com taxas de referência, não uma oferta: a condição real depende de cada instituição.`))
      : null,
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
      el('p', {}, 'Fale com um parceiro e tenha ainda mais ', el('strong', {}, 'Fôlego'), '. Você conta a sua situação em cerca de 3 minutos, vê o seu diagnóstico e escolhe se quer conversar com empresas parceiras.')),
    el('div', { class: 'partner-banner-cta' }, go, el('p', { class: 'fine' }, 'Propostas sem compromisso. Crédito rápido e seguro.')));
}
