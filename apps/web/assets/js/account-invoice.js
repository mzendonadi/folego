// Prumo > Cartões > Importar fatura (PDF). A fatura é lida no aparelho; aqui a pessoa confere o que foi lido antes de qualquer coisa ser salva.
// Identifica o cartão pelos 4 últimos dígitos, oferece cadastrar cartão novo, atualiza limite e dias do cartão com o que o banco informa
// e explica o que aconteceu com a fatura anterior (paga, parcial ou sem pagamento), sem misturar com o extrato da conta.
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';
import { moneyInput } from './money.js';
import { parseInvoiceDocument, detectDocumentKind, cardFromInvoice, matchInvoiceCard, invoiceCardChanges, invoiceImportBody } from '../vendor/engine.js';

const dayBr = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const monthName = (ym) => cap(new Date(`${ym}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' }));
const BRAND = { visa: 'Visa', mastercard: 'Mastercard', elo: 'Elo', amex: 'Amex', hipercard: 'Hipercard', outra: 'Outra bandeira' };
const dayOptions = Array.from({ length: 31 }, (_, i) => i + 1);

/** O que mudou entre o cartão cadastrado e o que a fatura informa, em palavras e como corpo do pedido. */
function cardChanges(c, doc) {
  const patch = invoiceCardChanges(c, doc);
  const list = [];
  if (patch.limitCents !== undefined) list.push(`limite ${brl(c.limitCents)} → ${brl(patch.limitCents)}`);
  if (patch.closingDay !== undefined) list.push(`fechamento dia ${c.closingDay} → dia ${patch.closingDay}`);
  if (patch.dueDay !== undefined) list.push(`vencimento dia ${c.dueDay} → dia ${patch.dueDay}`);
  if (patch.last4 !== undefined) list.push(`final ${patch.last4}`);
  return { list, patch };
}

function diagnosis(doc) {
  const prev = doc.previousKey ? monthName(doc.previousKey) : 'anterior';
  const pay = doc.payments[0];
  const dueTxt = doc.invoice.dueOn ? `, vence em ${dayBr(doc.invoice.dueOn)}` : '';
  const total = doc.invoice.totalCents !== null ? brl(doc.invoice.totalCents) : null;
  switch (doc.previous.status) {
    case 'quitada':
      return { tone: 'note-green', ico: 'check', text: `${pay ? `O pagamento de ${brl(pay.amountCents)} em ${dayBr(pay.date)} quitou a fatura de ${prev}. ` : `A fatura de ${prev} foi paga por inteiro. `}${total ? `Esta fatura (${total}) só tem compras novas${dueTxt}.` : ''}` };
    case 'parcial':
      return { tone: 'note-amber', ico: 'alert', text: `A fatura de ${prev} foi paga só em parte${pay ? ` (${brl(pay.amountCents)} em ${dayBr(pay.date)})` : ''}. Sobraram ${brl(doc.previous.leftCents)}, que o banco leva para esta fatura com juros (rotativo ou parcelamento).${total ? ` Total desta fatura: ${total}${dueTxt}.` : ''} Em "E se eu pagar só parte?" você vê quanto isso custa.` };
    case 'sem_pagamento':
      return { tone: 'note-amber', ico: 'alert', text: `Esta fatura não mostra pagamento da fatura de ${prev}${doc.invoice.previousCents ? ` (${brl(doc.invoice.previousCents)})` : ''}. Se você pagou fora do prazo, importe a fatura seguinte para eu conferir.` };
    default:
      return null;
  }
}

function selectDays(id, label, value) {
  return el('select', { class: 'input', id, 'aria-label': label }, ...dayOptions.map((d) => el('option', { value: String(d), ...(d === value ? { selected: true } : {}) }, String(d))));
}

/** Formulário de cartão novo já preenchido com o que a fatura trouxe. */
function newCardForm(ctx, doc, onCreated) {
  const want = cardFromInvoice(doc);
  const name = el('input', { class: 'input', id: 'inv-nome', type: 'text', maxlength: '40', value: want.name });
  const last4 = el('input', { class: 'input', id: 'inv-final', type: 'text', inputmode: 'numeric', maxlength: '4', value: want.last4 ?? '' });
  const limit = moneyInput({ id: 'inv-limite', ariaLabel: 'Limite do cartão', value: want.limitCents || null });
  const closing = selectDays('inv-fecha', 'Dia do fechamento', want.closingDay);
  const due = selectDays('inv-vence', 'Dia do vencimento', want.dueDay);
  const brand = el('select', { class: 'input', id: 'inv-bandeira', 'aria-label': 'Bandeira' }, ...Object.entries(BRAND).map(([v, l]) => el('option', { value: v, ...(v === want.brand ? { selected: true } : {}) }, l)));
  const save = el('button', { class: 'btn btn-primary', type: 'button' }, icon('plus'), 'Cadastrar este cartão');
  const field = (label, input, id) => el('div', { class: 'field' }, el('label', { class: 'label', for: id }, label), input);
  save.addEventListener('click', async () => {
    if (name.value.trim().length < 2) return toast('Dê um nome ao cartão.');
    if (last4.value.trim() && !/^\d{4}$/.test(last4.value.trim())) return toast('Informe só os 4 últimos dígitos.');
    save.disabled = true;
    try {
      const made = await ctx.api.createCard({ name: name.value.trim(), brand: brand.value, last4: last4.value.trim() || null, limitCents: limit.cents() ?? 0, closingDay: Number(closing.value), dueDay: Number(due.value) });
      toast('Cartão cadastrado.');
      onCreated({ id: made.id, name: name.value.trim(), last4: last4.value.trim() || null, limitCents: limit.cents() ?? 0, closingDay: Number(closing.value), dueDay: Number(due.value) });
    } catch (err) {
      save.disabled = false;
      toast(err?.status === 403 || err?.status === 422 ? (err.message || 'Seu plano não comporta mais cartões.') : 'Não consegui cadastrar agora.');
    }
  });
  return el('div', { class: 'import-newcard' },
    el('p', { class: 'note note-amber' }, icon('info'), el('span', {}, `Este cartão ainda não está cadastrado${doc.card.last4s.length ? ` (finais ${doc.card.last4s.join(', ')})` : ''}. Confira os dados que li da fatura e cadastre. As próximas faturas dele entram no cartão certo e são comparadas com o extrato do banco.`)),
    el('div', { class: 'entry-form cc-form form-std' },
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: name.id }, 'Nome do cartão'), name),
      field('Bandeira', brand, brand.id), field('Final', last4, last4.id), field('Limite (R$)', limit.input, 'inv-limite'), field('Fecha no dia', closing, closing.id), field('Vence no dia', due, due.id), save));
}

/**
 * Painel de importação. `card` é o cartão do painel (importar dentro de um cartão) ou null (importar de qualquer lugar: o cartão é identificado pela fatura).
 */
export function invoiceImportPanel(ctx, card = null) {
  const k = card ? card.id.slice(0, 6) : 'novo';
  const input = el('input', { type: 'file', accept: '.pdf,application/pdf', hidden: true, 'aria-label': 'Fatura do cartão em PDF' });
  const pick = el('button', { class: 'btn btn-secondary', type: 'button' }, icon('list'), 'Escolher a fatura em PDF');
  pick.addEventListener('click', () => input.click());
  const box = el('div', { class: 'import-preview', hidden: true });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    toast('Lendo a fatura no seu aparelho…');
    let doc;
    let kind;
    try {
      const { extractPdfText } = await import('../vendor/pdfread.js');
      const { text } = await extractPdfText(await file.arrayBuffer(), 24);
      kind = detectDocumentKind(text);
      doc = parseInvoiceDocument(text, new Date());
    } catch {
      return toast('Não consegui ler esse PDF. Se ele for uma foto ou estiver protegido, baixe a fatura de novo no app do banco.');
    }
    if (kind === 'extrato') return toast('Esse PDF parece um extrato de conta, não uma fatura de cartão. Importe-o em Lançamentos.');
    if (doc.entries.length === 0) return toast('Não achei compras nesse PDF. Confira se é a fatura do cartão (e não o comprovante de pagamento).');
    render(doc);
  });

  function render(doc) {
    const cards = ctx.cards?.cards ?? [];
    let target = card;
    let mismatch = null;
    if (!target) {
      target = matchInvoiceCard(cards, doc);
    } else if (target.last4 && doc.card.last4s.length && !doc.card.last4s.includes(target.last4)) {
      const other = matchInvoiceCard(cards.filter((c) => c.id !== target.id), doc);
      mismatch = other ? `Esta fatura parece ser do cartão ${other.name}${other.last4 ? ` (final ${other.last4})` : ''}, não de ${target.name}. Importe-a no cartão certo.` : `Os finais desta fatura (${doc.card.last4s.join(', ')}) não são o do cartão ${target.name} (final ${target.last4}).`;
    }

    const parts = [];
    const dg = diagnosis(doc);
    parts.push(el('p', { class: 'fine' }, `Li ${doc.entries.length} compras${doc.payments.length ? `, ${doc.payments.length} pagamento(s) da fatura anterior` : ''}${doc.refunds.length ? ` e ${doc.refunds.length} estorno(s)` : ''}${doc.skipped ? ` (${doc.skipped} linhas não reconhecidas)` : ''}${doc.invoice.dueOn ? `. Vencimento: ${dayBr(doc.invoice.dueOn)}` : ''}. Desmarque o que não quiser.`));
    if (dg) parts.push(el('p', { class: `note ${dg.tone}` }, icon(dg.ico), el('span', {}, dg.text)));
    if (mismatch) parts.push(el('p', { class: 'note note-amber' }, icon('alert'), el('span', {}, mismatch)));
    parts.push(doc.check
      ? el('p', { class: `note ${doc.check.ok ? 'note-green' : 'note-amber'}` }, icon(doc.check.ok ? 'check' : 'alert'), el('span', {}, doc.check.ok ? `A soma bate com a fatura (${brl(doc.check.expectedCents)}).` : `A fatura diz ${brl(doc.check.expectedCents)} e eu li ${brl(doc.check.parsedCents)}. A diferença pode ser juros ou encargos. Confira as linhas antes de importar.`))
      : el('p', { class: 'fine' }, 'O PDF não traz um total para conferir a soma. Confira as linhas antes de importar.'));
    if (doc.byCard.length > 1) parts.push(el('p', { class: 'fine' }, `Por cartão físico: ${doc.byCard.map((b) => `final ${b.last4 ?? '?'} ${brl(b.totalCents)}`).join(' · ')}.`));

    const area = el('div', { class: 'import-flow' });
    parts.push(area);
    box.replaceChildren(...parts);
    box.hidden = false;
    if (mismatch) return;

    const showImport = (c) => {
      const picks = doc.entries.map((e) => ({ e, on: true }));
      const total = el('strong', {});
      const sum = () => { total.textContent = brl(picks.filter((p) => p.on).reduce((s, p) => s + p.e.amountCents, 0)); };
      const checks = picks.map((p, i) => {
        const cb = el('input', { type: 'checkbox', checked: true, id: `imp-${k}-${i}`, 'aria-label': `Importar ${p.e.note}` });
        cb.addEventListener('change', () => { p.on = cb.checked; sum(); });
        return cb;
      });
      sum();
      const ch = cardChanges(c, doc);
      const upd = ch.list.length ? el('input', { type: 'checkbox', checked: true, id: `imp-upd-${k}` }) : null;
      const go = el('button', { class: 'btn btn-primary', type: 'button' }, `Importar para ${c.name}`);
      go.addEventListener('click', async () => {
        go.disabled = true;
        try {
          const skip = new Set(picks.flatMap((p, i) => (p.on ? [] : [i])));
          const patch = upd?.checked ? ch.patch : (ch.patch.availableCents !== undefined ? { availableCents: ch.patch.availableCents } : undefined);
          const r = await ctx.api.importCardInvoice(c.id, invoiceImportBody(doc, { skip, card: patch }));
          const bits = [`${r.added} compras importadas`];
          if (r.adopted) bits.push(`${r.adopted} que estavam soltas no extrato agora são do cartão`);
          if (r.transfers) bits.push(`${r.transfers} pagamento(s) da fatura ligado(s) ao extrato (não contam como gasto)`);
          if (r.duplicates) bits.push(`${r.duplicates} repetidas ignoradas`);
          toast(`${bits.join(', ')}.`);
          ctx.refresh();
        } catch {
          go.disabled = false;
          toast('Não consegui importar agora.');
        }
      });
      area.replaceChildren(...[
        upd ? el('label', { class: 'check', for: upd.id }, upd, el('span', {}, `Atualizar o cadastro do cartão com o que a fatura informa: ${ch.list.join('; ')}.`)) : null,
        el('ul', { class: 'entries import-list' }, ...picks.map((p, i) => el('li', { class: 'wallet-row' },
          el('label', { class: 'check', for: checks[i].id }, checks[i], el('span', {}, el('strong', {}, p.e.note), el('span', { class: 'muted fine' }, ` ${dayBr(p.e.date)}${p.e.installmentNo ? ` · parcela ${p.e.installmentNo}/${p.e.installmentTotal}` : ''}`))),
          el('strong', { class: 'entry-amount neg' }, brl(p.e.amountCents)), el('span', {})))),
        doc.refunds.length ? el('p', { class: 'fine' }, `Estornos que abatem esta fatura: ${doc.refunds.map((x) => `${x.note} ${brl(x.amountCents)}`).join('; ')}.`) : null,
        el('div', { class: 'button-row' }, go, el('span', { class: 'fine' }, 'Marcadas: ', total)),
      ].filter(Boolean));
    };

    if (target) showImport(target);
    else area.replaceChildren(newCardForm(ctx, doc, (made) => showImport(made)));
  }

  return el('div', { class: 'cc-panel-body' },
    el('p', { class: 'muted' }, card
      ? 'Baixe a fatura em PDF no app do banco e escolha o arquivo. Ele é lido aqui, no seu aparelho: o PDF não é enviado. Compras parceladas criam as parcelas que faltam, o pagamento da fatura anterior é ligado ao extrato da conta e o que já estiver lançado é ignorado.'
      : 'Escolha a fatura em PDF de qualquer cartão. Eu identifico o cartão pelos últimos dígitos; se ele ainda não estiver cadastrado, ofereço cadastrar. O arquivo é lido aqui, no seu aparelho: o PDF não é enviado.'),
    pick, input, box);
}
