// Prumo > Férias. Ousado: formulário simples (sozinho ou em família), divisão do orçamento, quanto guardar por mês e checklist completo.
// Desbravador: também monta o roteiro dia a dia com IA, para o tipo de viagem escolhido (carro, avião, ônibus, motorhome, navio).
// O plano e o checklist vêm do servidor (que usa o mesmo cálculo do pacote de domínio); aqui só desenhamos e marcamos os itens.
import { el, icon, toast } from './dom.js';
import { brl, todayISO } from './format.js';
import { moneyInput } from './money.js';
import { confirmDialog } from './confirm.js';
import { TRIP_KINDS, LODGINGS } from '../vendor/engine.js';

const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const dayBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const kindLabel = (id) => TRIP_KINDS.find((k) => k.id === id)?.label ?? id;
const field = (label, input, hint) => el('div', { class: 'field' }, el('label', { class: 'label', for: input.id }, label), input, hint ? el('p', { class: 'fine' }, hint) : null);
const select = (id, options, value) => el('select', { class: 'input', id }, ...options.map(([v, l]) => el('option', { value: String(v), ...(String(v) === String(value) ? { selected: true } : {}) }, l)));
const numbers = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [from + i, String(from + i)]);

export function viewFerias(ctx) {
  const root = el('div', { class: 'acc-stack trips' });
  const ai = ctx.has('trips_ai');

  async function showList() {
    root.replaceChildren(card(el('p', { class: 'muted', role: 'status' }, 'Carregando…')));
    let data;
    try {
      data = await ctx.api.getTrips();
    } catch {
      return root.replaceChildren(card(el('h2', {}, 'Não consegui carregar'), el('p', { class: 'muted' }, 'Confira a conexão e tente de novo.')));
    }
    const add = el('button', { class: 'btn btn-primary', type: 'button' }, icon('plus'), 'Planejar uma viagem');
    add.addEventListener('click', () => showForm(null));
    const rows = data.trips.map((t) => {
      const open = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Abrir');
      open.addEventListener('click', () => showTrip(t.id));
      return el('li', { class: 'wallet-row trip-row' },
        el('div', {}, el('strong', {}, t.name), el('p', { class: 'muted fine' }, `${t.destination} · ${dayBr(t.startDate)} a ${dayBr(t.endDate)} · ${kindLabel(t.kind)} · ${t.people} ${t.people === 1 ? 'pessoa' : 'pessoas'}${t.past ? ' · já aconteceu' : ''}`)),
        el('span', { class: 'fine muted' }, `Checklist ${t.checklist.done}/${t.checklist.total}${t.hasItinerary ? ' · roteiro pronto' : ''}`),
        open);
    });
    root.replaceChildren(
      card(
        el('h2', {}, 'Planejar férias'),
        el('p', { class: 'muted' }, ai
          ? 'Conte para onde vão, quando e com quem. O Prumo divide o orçamento, diz quanto guardar por mês, monta o checklist completo e, com a IA, escreve o roteiro dia a dia para o tipo de viagem que você escolher.'
          : 'Conte para onde vão, quando e com quem. O Prumo divide o orçamento, diz quanto guardar por mês e monta o checklist completo da viagem. No Desbravador, a IA também escreve o roteiro dia a dia.'),
        el('div', { class: 'button-row' }, add)),
      rows.length ? card(el('h3', {}, 'Suas viagens'), el('ul', { class: 'entries' }, ...rows)) : card(el('p', { class: 'muted' }, 'Nenhuma viagem ainda. Comece por "Planejar uma viagem".')),
    );
  }

  function showForm(existing) {
    const i = existing?.input ?? { name: '', destination: '', origin: '', startDate: '', endDate: '', kind: 'carro', adults: 2, children: 0, seniors: false, pets: false, lodging: 'hotel', international: false, budgetCents: null, notes: '' };
    const name = el('input', { class: 'input', id: 'tr-nome', type: 'text', maxlength: '60', placeholder: 'Ex.: Férias de janeiro', value: i.name });
    const dest = el('input', { class: 'input', id: 'tr-destino', type: 'text', maxlength: '80', placeholder: 'Ex.: Florianópolis', value: i.destination });
    const origin = el('input', { class: 'input', id: 'tr-origem', type: 'text', maxlength: '80', placeholder: 'Ex.: Uberlândia', value: i.origin });
    const start = el('input', { class: 'input', id: 'tr-ida', type: 'date', min: todayISO(), value: i.startDate });
    const end = el('input', { class: 'input', id: 'tr-volta', type: 'date', min: todayISO(), value: i.endDate });
    const kind = select('tr-tipo', TRIP_KINDS.map((k) => [k.id, k.label]), i.kind);
    const adults = select('tr-adultos', numbers(1, 12), i.adults);
    const children = select('tr-criancas', numbers(0, 12), i.children);
    const lodging = select('tr-hosp', LODGINGS.map((l) => [l.id, l.label]), i.lodging);
    const budget = moneyInput({ id: 'tr-orcamento', ariaLabel: 'Orçamento total da viagem', value: i.budgetCents, placeholder: 'Opcional' });
    const check = (id, label, on) => { const cb = el('input', { type: 'checkbox', id, ...(on ? { checked: true } : {}) }); return [cb, el('label', { class: 'check', for: id }, cb, el('span', {}, label))]; };
    const [seniors, seniorsRow] = check('tr-idosos', 'Vai alguém idoso ou com mobilidade reduzida', i.seniors);
    const [pets, petsRow] = check('tr-pets', 'Vão bichos de estimação', i.pets);
    const [intl, intlRow] = check('tr-exterior', 'É uma viagem ao exterior', i.international);
    const notes = el('textarea', { class: 'input', id: 'tr-obs', rows: '3', maxlength: '500', placeholder: 'Ex.: queremos praia calma e poucos passeios por dia' }, i.notes);
    const save = el('button', { class: 'btn btn-primary', type: 'submit' }, existing ? 'Salvar' : 'Criar a viagem');
    const back = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Voltar');
    back.addEventListener('click', () => (existing ? showTrip(existing.id) : showList()));
    const form = el('form', { class: 'entry-form form-std trip-form' },
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: name.id }, 'Nome da viagem'), name),
      field('Para onde', dest), field('De onde saem', origin, 'Ajuda o roteiro por IA a calcular o trajeto.'),
      field('Ida', start), field('Volta', end),
      field('Como vão viajar', kind),
      field('Onde vão ficar', lodging),
      field('Adultos', adults), field('Crianças', children),
      field('Orçamento total (R$)', budget.input, 'Opcional. Sem ele mostramos só a divisão em porcentagem.'),
      el('div', { class: 'field field-wide' }, seniorsRow, petsRow, intlRow),
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: notes.id }, 'Observações (opcional)'), notes),
      el('div', { class: 'button-row field-wide' }, save, back));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: name.value.trim(), destination: dest.value.trim(), origin: origin.value.trim(), startDate: start.value, endDate: end.value, kind: kind.value, adults: Number(adults.value), children: Number(children.value), seniors: seniors.checked, pets: pets.checked, lodging: lodging.value, international: intl.checked, budgetCents: budget.cents(), notes: notes.value.trim() };
      save.disabled = true;
      try {
        if (existing) {
          await ctx.api.updateTrip(existing.id, body);
          toast('Viagem atualizada.');
          showTrip(existing.id);
        } else {
          const r = await ctx.api.createTrip(body);
          toast('Viagem criada. O checklist já está pronto.');
          showTrip(r.id);
        }
      } catch (err) {
        save.disabled = false;
        toast(err?.status === 422 && err.message ? err.message : 'Não consegui salvar agora.');
      }
    });
    root.replaceChildren(card(el('h2', {}, existing ? 'Editar a viagem' : 'Nova viagem'), form));
  }

  async function showTrip(id) {
    root.replaceChildren(card(el('p', { class: 'muted', role: 'status' }, 'Carregando…')));
    let t;
    try {
      t = await ctx.api.getTrip(id);
    } catch {
      return showList();
    }
    const p = t.plan;
    const i = t.input;
    const back = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Minhas viagens');
    back.addEventListener('click', showList);
    const edit = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Editar');
    edit.addEventListener('click', () => showForm(t));
    const print = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Imprimir');
    print.addEventListener('click', () => window.print());
    const del = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Apagar');
    del.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: `Apagar a viagem "${i.name}"?`, text: 'O checklist e o roteiro dela são apagados. Os seus lançamentos não mudam.', confirmLabel: 'Apagar', danger: true }))) return;
      try { await ctx.api.deleteTrip(id); toast('Viagem apagada.'); showList(); } catch { toast('Não consegui apagar agora.'); }
    });

    const stat = (k, v) => el('div', { class: 'stat' }, el('dt', {}, k), el('dd', {}, v));
    const head = card(
      el('div', { class: 'button-row no-print' }, back, edit, print, del),
      el('h2', {}, i.name),
      el('p', { class: 'muted' }, `${i.destination}${i.origin ? `, saindo de ${i.origin}` : ''} · ${dayBr(i.startDate)} a ${dayBr(i.endDate)} · ${kindLabel(i.kind)}`),
      el('dl', { class: 'stats' },
        stat('Duração', `${p.days} ${p.days === 1 ? 'dia' : 'dias'} (${p.nights} ${p.nights === 1 ? 'noite' : 'noites'})`),
        stat('Pessoas', `${p.people}`),
        ...(p.perDayCents !== null ? [stat('Por dia', brl(p.perDayCents)), stat('Por pessoa', brl(p.perPersonCents))] : []),
        stat(t.past ? 'Situação' : 'Faltam', t.past ? 'viagem concluída' : p.daysUntil === 0 ? 'é hoje' : `${p.daysUntil} ${p.daysUntil === 1 ? 'dia' : 'dias'}`)),
      p.saving ? el('p', { class: 'note' }, icon('info'), el('span', {}, `Para chegar lá com o orçamento pronto, guarde ${brl(p.saving.perMonthCents)} por mês nos próximos ${p.saving.monthsLeft} ${p.saving.monthsLeft === 1 ? 'mês' : 'meses'}.`)) : null,
      t.past ? el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, 'Esta viagem já terminou. O plano mostrado é o de quando ela começou.')) : null,
    );

    const budget = card(
      el('h3', {}, 'Divisão sugerida do orçamento'),
      el('p', { class: 'fine muted' }, p.budget.some((l) => l.cents !== null) ? 'Uma divisão de partida. Ajuste ao que você já sabe: cada viagem é diferente.' : 'Informe o orçamento total (em Editar) para ver os valores. Esta é só a divisão em porcentagem.'),
      el('table', { class: 'cc-table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Onde vai o dinheiro'), el('th', { scope: 'col' }, '%'), el('th', { scope: 'col' }, 'Valor'))),
        el('tbody', {}, ...p.budget.map((l) => el('tr', {}, el('td', {}, el('strong', {}, l.label), el('span', { class: 'fine muted trip-hint' }, ` ${l.hint}`)), el('td', {}, `${l.pct}%`), el('td', {}, l.cents === null ? '—' : brl(l.cents)))))),
      p.tips.length ? el('ul', { class: 'tick-list left' }, ...p.tips.map((x) => el('li', {}, icon('info'), x))) : null,
    );

    // checklist: itens do plano + itens extras do roteiro por IA, agrupados
    const items = [...p.checklist, ...(t.itinerary?.extraChecklist ?? [])];
    const groups = [...new Set(items.map((x) => x.group))];
    const done = () => items.filter((x) => t.checked[x.id]).length;
    const progress = el('p', { class: 'fine', 'aria-live': 'polite' });
    const bar = el('span', {});
    const setProgress = () => { progress.textContent = `${done()} de ${items.length} itens prontos`; bar.style.width = `${Math.round((done() / Math.max(1, items.length)) * 100)}%`; };
    const checklist = card(
      el('h3', {}, 'Checklist da viagem'),
      el('div', { class: 'lis-meter', role: 'img', 'aria-label': 'Progresso do checklist' }, bar), progress,
      ...groups.map((g) => el('div', { class: 'trip-group' },
        el('h4', {}, g),
        el('ul', { class: 'checklist' }, ...items.filter((x) => x.group === g).map((x) => {
          const cb = el('input', { type: 'checkbox', id: `tk-${x.id}` });
          cb.checked = Boolean(t.checked[x.id]);
          cb.addEventListener('change', async () => {
            const was = Boolean(t.checked[x.id]);
            t.checked[x.id] = cb.checked;
            setProgress();
            try {
              await ctx.api.checkTripItem(id, x.id, cb.checked);
            } catch {
              t.checked[x.id] = was; cb.checked = was; setProgress();
              toast('Não consegui salvar a marcação.');
            }
          });
          return el('li', {}, el('div', { class: 'check' }, cb, el('label', { for: cb.id }, x.text)));
        })))),
    );
    setProgress();

    root.replaceChildren(...[head, budget, itineraryCard(t, id), checklist].filter(Boolean));
  }

  function itineraryCard(t, id) {
    if (!ai) {
      const go = el('button', { class: 'btn btn-primary', type: 'button' }, 'Ver o plano Desbravador', icon('arrow-right'));
      go.addEventListener('click', () => ctx.goTab('plano'));
      return card(el('h3', {}, 'Roteiro completo com IA'), el('div', { class: 'locked-box' }, icon('lock', 'icon icon-lock'), el('div', {}, el('strong', {}, 'No plano Desbravador'), el('p', { class: 'muted' }, 'A IA escreve o roteiro dia a dia para o tipo de viagem que você escolheu (carro, avião, ônibus, motorhome ou navio), com trajeto, paradas, ritmo para crianças e idosos e itens extras no checklist.'))), el('div', { class: 'button-row no-print' }, go));
    }
    const it = t.itinerary;
    const gen = el('button', { class: 'btn btn-primary no-print', type: 'button' }, it ? 'Gerar outro roteiro' : 'Montar o roteiro com IA');
    const status = el('p', { class: 'fine muted', role: 'status', 'aria-live': 'polite' }, it ? '' : `Leva cerca de um minuto. Você pode gerar ${t.ai.perDay} roteiros por dia (já usou ${t.ai.usedToday}).`);
    if (!t.ai.available) { gen.disabled = true; status.textContent = 'O roteiro com IA ainda não está ligado. O checklist e o orçamento continuam valendo.'; }
    if (t.plan.days > t.ai.maxDays) { gen.disabled = true; status.textContent = `O roteiro com IA vai até ${t.ai.maxDays} dias. Divida a viagem em duas.`; }
    if (t.past) { gen.disabled = true; status.textContent = 'Esta viagem já terminou.'; }
    gen.addEventListener('click', async () => {
      if (it && !(await confirmDialog({ title: 'Gerar outro roteiro?', text: 'O roteiro atual é substituído e as marcações dos itens extras dele saem.', confirmLabel: 'Gerar outro' }))) return;
      gen.disabled = true;
      status.textContent = 'Montando o roteiro… isso leva cerca de um minuto.';
      try {
        await ctx.api.generateTripItinerary(id);
        toast('Roteiro pronto.');
        showTrip(id);
      } catch (err) {
        gen.disabled = false;
        status.textContent = err?.message || 'Não consegui montar o roteiro agora. Tente de novo em instantes.';
      }
    });
    const days = it ? it.days.map((d) => el('article', { class: 'trip-day' },
      el('h4', {}, `Dia ${d.day}: ${d.title}`),
      el('dl', { class: 'trip-day-body' },
        el('dt', {}, 'Manhã'), el('dd', {}, d.morning), el('dt', {}, 'Tarde'), el('dd', {}, d.afternoon), el('dt', {}, 'Noite'), el('dd', {}, d.evening),
        d.stay ? el('dt', {}, 'Onde ficar') : null, d.stay ? el('dd', {}, d.stay) : null),
      d.tip ? el('p', { class: 'fine' }, `Dica: ${d.tip}`) : null)) : [];
    const section = (title, ...children) => el('div', { class: 'trip-group' }, el('h4', {}, title), ...children);
    return card(
      el('h3', {}, 'Roteiro completo com IA'),
      it ? section('Resumo do destino', el('p', {}, it.summary), it.bestSeason ? el('p', { class: 'muted' }, it.bestSeason) : null) : el('p', { class: 'muted' }, `A IA monta o plano completo para ${kindLabel(t.input.kind).toLowerCase()}: resumo do destino, roteiro dia a dia, onde comer e ficar, dicas de quem conhece e uma estimativa de custos próxima da realidade. Valores e lugares são sugestões: confirme antes de reservar.`),
      it?.routeNotes?.length ? el('ul', { class: 'tick-list left' }, ...it.routeNotes.map((x) => el('li', {}, icon('check'), x))) : null,
      it ? section('Roteiro dia a dia') : null,
      ...days,
      it?.food?.length ? section('Sugestões gastronômicas', el('ul', { class: 'official-links' }, ...it.food.map((f) => el('li', {}, el('strong', {}, f.name), el('span', { class: 'muted' }, ` ${f.kind}. `), f.why)))) : null,
      it?.lodging?.length ? section('Hospedagem recomendada', el('ul', { class: 'official-links' }, ...it.lodging.map((l) => el('li', {}, el('strong', {}, l.name), el('span', { class: 'muted' }, ` ${l.area}. `), l.why)))) : null,
      it?.insider?.length ? section('Dicas de quem conhece', el('ul', { class: 'tick-list left' }, ...it.insider.map((x) => el('li', {}, icon('info'), x)))) : null,
      it?.costs?.length ? section('Estimativa de custos', el('table', { class: 'cc-table' }, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Item'), el('th', { scope: 'col' }, 'Estimativa'))), el('tbody', {}, ...it.costs.map((c) => el('tr', {}, el('td', {}, c.item), el('td', {}, c.estimate)))))) : null,
      it?.warnings?.length ? el('div', { class: 'note note-amber' }, icon('alert'), el('div', {}, ...it.warnings.map((w) => el('p', {}, w)))) : null,
      el('div', { class: 'button-row' }, gen), status,
      it ? el('p', { class: 'fine muted' }, 'Roteiro, lugares e valores escritos por IA como sugestão e estimativa: confirme preços, horários, estradas e disponibilidade antes de reservar.') : null,
    );
  }

  showList();
  return root;
}
