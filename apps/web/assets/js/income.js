// Criador de Renda Extra 2.0: sem IA antes da compra. Depois de pagar, uma entrevista curta personaliza
// um plano de verdade (a IA só escreve texto sobre os números e as ideias que o motor já calculou).
import { el, icon, toast } from './dom.js';
import { fieldToCents, centsToField } from './format.js';

const list = (items, cls = 'bullets') => el('ul', { class: cls }, ...items.map((t) => el('li', {}, t)));

function card(...children) {
  return el('section', { class: 'card d-section', id: 'renda', 'aria-labelledby': 'renda-t' }, el('h2', { id: 'renda-t' }, 'Criador de Renda Extra'), ...children);
}

function statusBox(icon_, title, text) {
  return el('div', { class: 'pending' }, icon(icon_), el('div', {}, el('strong', {}, title), el('p', { class: 'muted' }, text)));
}

const HOURS_LABEL = { ate_5h: 'Até 5 horas por semana', '5_10h': '5 a 10 horas por semana', '10_20h': '10 a 20 horas por semana', mais_20h: 'Mais de 20 horas por semana' };
const MODE_LABEL = { presencial: 'Presencial', online: 'Online', tanto_faz: 'Tanto faz' };

// ---------- entrevista (só depois de pagar; a IA só entra em ação depois disto) ----------
function interviewForm(onSubmit) {
  const skills = el('textarea', { class: 'input', id: 'inc-skills', rows: '3', maxlength: '500', placeholder: 'Ex.: cozinho bem, sei costurar, tenho jeito para consertar coisas, já vendi roupa usada...' });
  const hours = el('select', { class: 'input', id: 'inc-hours' }, ...Object.entries(HOURS_LABEL).map(([v, label]) => el('option', { value: v }, label)));
  const capital = el('input', { class: 'input', id: 'inc-capital', type: 'text', inputmode: 'numeric', placeholder: '0,00', 'data-money': '' });
  capital.value = '0,00';
  const vehicle = el('input', { type: 'checkbox', id: 'inc-vehicle' });
  const mode = el('select', { class: 'input', id: 'inc-mode' }, ...Object.entries(MODE_LABEL).map(([v, label]) => el('option', { value: v }, label)));
  const prior = el('textarea', { class: 'input', id: 'inc-prior', rows: '2', maxlength: '500', placeholder: 'Opcional' });
  const name = el('input', { class: 'input', id: 'inc-name', type: 'text', autocomplete: 'name', maxlength: '120' });
  const phone = el('input', { class: 'input', id: 'inc-phone', type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '(11) 91234-5678' });
  const email = el('input', { class: 'input', id: 'inc-email', type: 'email', autocomplete: 'email' });
  const wantsPartner = el('input', { type: 'checkbox', id: 'inc-partner' });
  const submit = el('button', { class: 'btn btn-primary btn-block', type: 'submit' }, icon('arrow-right'), 'Gerar meu plano personalizado');

  capital.addEventListener('input', () => {
    const cents = fieldToCents(capital.value);
    capital.value = cents === null ? '' : centsToField(cents);
    capital.setSelectionRange(capital.value.length, capital.value.length);
  });

  const form = el(
    'form',
    { class: 'tool-form' },
    el('p', { class: 'section-sub' }, 'Você já pagou: agora responda rápido para a IA montar um plano feito para o seu perfil, não uma lista genérica.'),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'inc-skills' }, 'O que você sabe fazer, ou tem vontade de tentar?'), skills),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'inc-hours' }, 'Quanto tempo por semana você teria para isso?'), hours),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'inc-capital' }, 'Quanto você tem disponível para começar, em reais (pode ser R$ 0)'), capital),
    el('div', { class: 'check' }, vehicle, el('label', { for: 'inc-vehicle' }, 'Tenho carro, moto ou bike disponível')),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'inc-mode' }, 'Prefere algo presencial, online, ou tanto faz?'), mode),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'inc-prior' }, 'Já tentou algo parecido antes? O que rolou?'), prior),
    el('h3', {}, 'Para receber o plano e, se quiser, novidades sobre parcerias'),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'inc-name' }, 'Seu nome'), name),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'inc-phone' }, 'Telefone com DDD'), phone),
    el('div', { class: 'field' }, el('label', { class: 'label', for: 'inc-email' }, 'E-mail (opcional)'), email),
    el('div', { class: 'check' }, wantsPartner, el('label', { for: 'inc-partner' }, 'Quero também ser avisado sobre parcerias de capacitação (SEBRAE, escolas técnicas, cursos) que possam me ajudar a empreender. Separado do seu plano — desmarcado por padrão.')),
    el('p', { class: 'fine' }, 'Seus dados servem só para personalizar e entregar o seu plano. Isso não muda em nada o restante do seu Mapa.'),
    submit,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const skillsVal = skills.value.trim();
    const nameVal = name.value.trim();
    const phoneDigits = phone.value.replace(/\D/g, '');
    if (skillsVal.length < 5) return toast('Conte um pouco mais sobre o que você sabe fazer.');
    if (nameVal.length < 3 || phoneDigits.length < 10) return toast('Confira seu nome e telefone.');
    submit.disabled = true;
    try {
      await onSubmit({
        skills: skillsVal,
        hoursBand: hours.value,
        capitalCents: fieldToCents(capital.value) ?? 0,
        hasVehicle: vehicle.checked,
        mode: mode.value,
        priorAttempts: prior.value.trim(),
        name: nameVal,
        phone: phone.value.trim(),
        email: email.value.trim() || undefined,
        wantsPartnerContact: wantsPartner.checked,
      });
    } catch (error) {
      submit.disabled = false;
      toast(error?.status === 422 ? 'Confira os dados preenchidos.' : 'Não consegui enviar agora. Tente de novo em instantes.');
    }
  });
  return form;
}

// ---------- plano pronto ----------
function planContent(g, onToggleTask) {
  const c = g.content;
  const origin =
    c.source === 'ai'
      ? 'Personalizado com ajuda de inteligência artificial a partir do que você contou (sem inventar números nem plataformas).'
      : 'Montado com os seus números.';
  const progress = g.progress ?? {};
  return [
    el('p', { class: 'section-sub' }, origin),
    c.openingNote ? el('p', { class: 'note' }, icon('info'), el('span', {}, c.openingNote)) : null,
    el('p', { class: 'note' }, icon('info'), el('span', {}, c.target.text)),
    el(
      'article', { class: 'script' },
      el('h3', {}, c.idea.title),
      el('p', {}, c.idea.why),
      el('p', { class: 'muted' }, c.idea.rateNote),
      c.idea.platforms.length > 0 ? el('p', {}, el('strong', {}, 'Onde oferecer: '), c.idea.platforms.join(', ')) : null,
    ),
    el('h3', {}, 'Plano de 4 semanas'),
    el(
      'ol', { class: 'weeks' },
      ...c.weeks.map((w) =>
        el(
          'li', {},
          el('strong', {}, `Semana ${w.week}: ${w.title}`),
          el(
            'ul', { class: 'checklist' },
            ...w.tasks.map((task, i) => {
              const key = `w${w.week}t${i}`;
              const input = el('input', { type: 'checkbox', id: `task-${key}` });
              input.checked = Boolean(progress[key]);
              input.addEventListener('change', async () => {
                input.disabled = true;
                try {
                  await onToggleTask(key, input.checked);
                } catch {
                  input.checked = !input.checked;
                  toast('Não consegui salvar agora. Tente de novo.');
                }
                input.disabled = false;
              });
              return el('li', { class: 'check' }, input, el('label', { for: `task-${key}` }, task));
            }),
          ),
        ),
      ),
    ),
    el('h3', {}, 'Cuidados'),
    list(c.cautions),
    c.encouragement ? el('p', { class: 'note' }, icon('info'), el('span', {}, c.encouragement)) : null,
    el('p', { class: 'fine' }, 'Não prometemos ganhos: o resultado depende do seu esforço, da sua região e do seu tempo.'),
  ];
}

export function incomeSection(g, { onSubmitInterview = async () => {}, onToggleTask = async () => {} } = {}) {
  if (!g || g.status === 'unavailable') {
    return card(statusBox('info', 'Indisponível nesta demonstração', 'Na versão real, você responde uma entrevista curta e a IA monta seu plano logo depois do pagamento.'));
  }
  if (g.status === 'needs_interview') {
    return card(interviewForm(onSubmitInterview));
  }
  if (g.status === 'pending' || g.status === 'generating') {
    return card(statusBox('clock', 'Estamos montando o seu plano…', 'Leva cerca de 1 minuto. Você não precisa fazer nada: esta parte da página se atualiza sozinha.'));
  }
  if (g.status === 'failed' || !g.content) {
    return card(statusBox('alert', 'Não conseguimos preparar agora', 'Isso é problema nosso, não seu. Recarregue a página em alguns minutos; o Mapa continua disponível.'));
  }
  return card(...planContent(g, onToggleTask));
}
