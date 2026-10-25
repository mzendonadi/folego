// Lançar rápido (aba Lançamentos): a pessoa escreve, fala ou fotografa o comprovante; o app entende valor, data e categoria,
// MOSTRA o que entendeu para ela conferir, e só então grava. Depois mostra o recibo: "Lancei R$ 45,00 em Mercado. No mês: R$ 638,40".
// Texto e voz são lidos aqui mesmo (nada vai a servidor de IA); a foto é lida por OCR no aparelho (a imagem nunca sai dele).
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';
import { catLabel, catList } from './account-categories.js';
import { parseMoneyBr, parseQuickEntry, parseReceiptText } from '../vendor/engine.js';

const todaySp = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const monthName = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' });
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

export function quickEntryCard(ctx) {
  const input = el('input', { class: 'input', id: 'lr-texto', type: 'text', maxlength: '300', autocomplete: 'off', placeholder: 'Ex.: almoço 45 no débito, recebi 1.200 de salário ontem', 'aria-label': 'Descreva o lançamento' });
  const go = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Entender');
  const photoInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, 'aria-label': 'Foto do comprovante' });
  const photoBtn = el('button', { class: 'btn btn-secondary', type: 'button', 'aria-label': 'Ler uma foto de comprovante' }, icon('list'), 'Foto');
  const micBtn = SpeechRec ? el('button', { class: 'btn btn-secondary', type: 'button', 'aria-label': 'Falar o lançamento' }, 'Falar') : null;
  const out = el('div', { class: 'quick-out', 'aria-live': 'polite' });
  const form = el('form', { class: 'quick-form' }, el('div', { class: 'quick-row' }, input, go), el('div', { class: 'quick-row quick-tools' }, photoBtn, micBtn, photoInput));
  const hint = el('p', { class: 'fine muted' }, SpeechRec ? 'Escreva, fale ou fotografe o comprovante. Você confere antes de gravar.' : 'Escreva ou fotografe o comprovante (no iPhone, use o microfone do teclado para falar). Você confere antes de gravar.');
  const box = el('section', { class: 'card d-section quick-card' }, el('h2', {}, 'Lançar rápido'), hint, form, out);

  if (ctx.lastReceipt) {
    out.replaceChildren(el('p', { class: 'note' }, icon('check'), el('span', {}, ctx.lastReceipt)));
    ctx.lastReceipt = null;
  }

  function showDraft(draft, from) {
    const spend = draft.amountCents < 0;
    const desc = el('input', { class: 'input', id: 'lr-desc', type: 'text', maxlength: '120', value: draft.note, 'aria-label': 'Descrição' });
    const val = el('input', { class: 'input', id: 'lr-valor', type: 'text', inputmode: 'decimal', value: (Math.abs(draft.amountCents) / 100).toFixed(2).replace('.', ','), 'aria-label': 'Valor em reais' });
    const date = el('input', { class: 'input', id: 'lr-data', type: 'date', value: draft.date, 'aria-label': 'Data' });
    const cats = catList(ctx);
    const cat = el('select', { class: 'input', id: 'lr-cat', 'aria-label': 'Categoria' }, ...cats.map((c) => el('option', { value: c }, catLabel(c))));
    cat.value = cats.includes(draft.category) ? draft.category : (cats.includes('outros') ? 'outros' : cats[0]);
    const ok = el('button', { class: 'btn btn-primary', type: 'submit' }, spend ? 'Lançar gasto' : 'Lançar entrada');
    const cancel = el('button', { class: 'btn btn-secondary', type: 'button' }, 'Cancelar');
    const draftForm = el(
      'form', { class: 'quick-draft entry-form' },
      el('p', { class: 'field field-wide' }, el('strong', {}, from === 'foto' ? 'Li o comprovante. Confira, a leitura de foto pode errar:' : 'Entendi assim:'), ` ${spend ? 'gasto' : 'entrada'}`),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'lr-valor' }, 'Valor (R$)'), val),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'lr-data' }, 'Data'), date),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'lr-cat' }, 'Categoria'), cat),
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'lr-desc' }, 'Descrição'), desc),
      el('div', { class: 'row-actions' }, ok, cancel),
    );
    cancel.addEventListener('click', () => out.replaceChildren());
    draftForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cents = Math.abs(parseMoneyBr(val.value) ?? 0);
      if (!cents) return toast('Confira o valor.');
      if (!date.value) return toast('Escolha a data.');
      ok.disabled = true;
      try {
        await ctx.api.addEntries([{ date: date.value, amountCents: spend ? -cents : cents, note: desc.value.trim() || (spend ? 'Gasto' : 'Entrada'), category: cat.value }]);
        const month = date.value.slice(0, 7);
        const m = await ctx.api.getMonth(month).catch(() => null);
        const total = m?.summary ? (spend ? m.summary.spendCents : m.summary.incomeCents) : null;
        ctx.lastReceipt = `Lancei ${spend ? '' : 'entrada de '}${brl(cents)}${spend ? ` em ${catLabel(cat.value)}` : ''}.${total !== null ? ` Em ${monthName(date.value)} ${spend ? 'você já gastou' : 'já entraram'} ${brl(total)}.` : ''}`;
        ctx.month = month;
        ctx.refresh();
      } catch {
        ok.disabled = false;
        toast('Não consegui lançar agora.');
      }
    });
    out.replaceChildren(draftForm);
    val.focus();
  }

  function understand(text) {
    const draft = parseQuickEntry(text, todaySp());
    if (!draft) {
      out.replaceChildren(el('p', { class: 'muted' }, 'Não achei o valor. Escreva junto o quanto foi, por exemplo: "mercado 120,50".'));
      return;
    }
    showDraft(draft, 'texto');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.trim()) understand(input.value);
  });

  photoBtn.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    photoBtn.disabled = true;
    const original = photoBtn.lastChild.textContent;
    photoBtn.lastChild.textContent = 'Lendo…';
    try {
      const { recognizeImage } = await import('../vendor/ocr.js');
      const text = await recognizeImage(file, (pct) => { photoBtn.lastChild.textContent = `Lendo ${pct}%`; });
      const draft = text ? parseReceiptText(text, todaySp()) : null;
      if (draft) showDraft(draft, 'foto');
      else out.replaceChildren(el('p', { class: 'muted' }, 'Não consegui achar o total nessa foto. Tente com mais luz e o papel esticado, ou escreva o valor acima.'));
    } catch {
      toast('Não consegui ler essa foto agora. Escreva o lançamento acima.');
    }
    photoBtn.disabled = false;
    photoBtn.lastChild.textContent = original;
    photoInput.value = '';
  });

  if (micBtn) {
    let rec = null;
    micBtn.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new SpeechRec();
      rec.lang = 'pt-BR';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      micBtn.textContent = 'Ouvindo…';
      rec.onresult = (ev) => {
        const said = ev.results?.[0]?.[0]?.transcript ?? '';
        if (said) { input.value = said; understand(said); }
      };
      rec.onerror = (ev) => toast(ev.error === 'not-allowed' ? 'Libere o microfone no navegador para falar.' : 'Não consegui ouvir. Tente de novo ou escreva.');
      rec.onend = () => { rec = null; micBtn.textContent = 'Falar'; };
      try { rec.start(); } catch { rec = null; micBtn.textContent = 'Falar'; }
    });
  }
  return box;
}
