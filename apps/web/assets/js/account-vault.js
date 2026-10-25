// Cofre (aba "Cofre"): contrato da renegociação, acordo, boleto, comprovante e extrato num só lugar, com busca e aviso de vencimento.
// O PDF é lido aqui no aparelho só para extrair o texto da busca; o arquivo vai criptografado para o servidor.
import { el, icon, toast } from './dom.js';
import { brl } from './format.js';
import { moneyInput } from './money.js';
import { confirmDialog } from './confirm.js';

const KIND = { acordo: 'Acordo', contrato: 'Contrato', boleto: 'Boleto', comprovante: 'Comprovante', extrato: 'Extrato', outro: 'Outro' };
const MAX_BYTES = 5 * 1024 * 1024;
const card = (...c) => el('section', { class: 'card d-section' }, ...c.filter(Boolean));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const daysTo = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86_400_000);
const dueText = (iso) => {
  const d = daysTo(iso);
  const when = d === 0 ? 'vence hoje' : d === 1 ? 'vence amanhã' : d > 1 ? `vence em ${d} dias` : `venceu há ${-d} dia${d === -1 ? '' : 's'}`;
  return `${new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')} · ${when}`;
};

const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export function viewCofre(ctx) {
  const readOnly = ctx.acc?.access === 'consulta';
  const v = ctx.vault ?? { docs: [], limit: 60, count: 0 };

  // ---- adicionar ----
  let form = null;
  if (!readOnly) {
    const kind = el('select', { class: 'input', id: 'cf-tipo', 'aria-label': 'Tipo do documento' }, ...Object.entries(KIND).map(([k, l]) => el('option', { value: k }, l)));
    const title = el('input', { class: 'input', id: 'cf-titulo', type: 'text', maxlength: '120', required: true, placeholder: 'Ex.: Acordo com o Banco Exemplo' });
    const creditor = el('input', { class: 'input', id: 'cf-credor', type: 'text', maxlength: '120', placeholder: 'Quem cobra (opcional)' });
    const amount = moneyInput({ id: 'cf-valor', ariaLabel: 'Valor (opcional)' });
    const due = el('input', { class: 'input', id: 'cf-venc', type: 'date', 'aria-label': 'Vencimento (opcional)' });
    const notes = el('textarea', { class: 'input', id: 'cf-notas', rows: '3', maxlength: '2000', placeholder: 'Anotações: parcelas, desconto combinado, número do protocolo…' });
    const file = el('input', { class: 'input', id: 'cf-arquivo', type: 'file', accept: 'application/pdf,image/jpeg,image/png,image/webp', 'aria-label': 'Arquivo (PDF ou foto, até 5 MB)' });
    const save = el('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), 'Guardar no cofre');
    form = el(
      'form', { class: 'entry-form' },
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'cf-tipo' }, 'Tipo'), kind),
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'cf-titulo' }, 'Título'), title),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'cf-credor' }, 'Credor'), creditor),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'cf-valor' }, 'Valor (R$)'), amount.input),
      el('div', { class: 'field' }, el('label', { class: 'label', for: 'cf-venc' }, 'Vencimento (avisamos antes)'), due),
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'cf-arquivo' }, 'Arquivo (PDF ou foto, até 5 MB)'), file),
      el('div', { class: 'field field-wide' }, el('label', { class: 'label', for: 'cf-notas' }, 'Anotações'), notes),
      save,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = file.files?.[0];
      if (f && f.size > MAX_BYTES) return toast('O arquivo passa de 5 MB.');
      save.disabled = true;
      try {
        const body = { kind: kind.value, title: title.value.trim(), ...(creditor.value.trim() ? { creditor: creditor.value.trim() } : {}), ...(notes.value.trim() ? { notes: notes.value.trim() } : {}), ...(amount.cents() ? { amountCents: amount.cents() } : {}), ...(due.value ? { dueOn: due.value } : {}) };
        if (f) {
          body.file = { name: f.name.slice(0, 120), mime: f.type, data: await toBase64(f) };
          if (f.type === 'application/pdf') {
            try {
              const { extractPdfText } = await import('../vendor/pdfread.js');
              const { text } = await extractPdfText(await f.arrayBuffer(), 20);
              if (text) body.text = text.slice(0, 20_000);
            } catch { /* PDF só de imagem ou protegido: guarda sem o texto de busca */ }
          }
        }
        await ctx.api.addVaultDoc(body);
        toast('Guardado no cofre.');
        ctx.refresh();
      } catch (err) {
        save.disabled = false;
        toast(err?.message || 'Não consegui guardar agora.');
      }
    });
  }

  // ---- lista e busca ----
  const list = el('div', {});
  const search = el('input', { class: 'input', id: 'cf-busca', type: 'search', placeholder: 'Buscar por título, credor, anotação ou texto do PDF', 'aria-label': 'Buscar no cofre' });
  function draw(docs) {
    list.replaceChildren(docs.length === 0
      ? el('div', { class: 'empty' }, el('strong', {}, v.count === 0 ? 'Seu cofre está vazio' : 'Nada encontrado'), el('p', { class: 'muted' }, v.count === 0 ? 'Guarde aqui o acordo, o boleto e o comprovante: tudo no mesmo lugar, com aviso antes de vencer.' : 'Tente outras palavras.'))
      : el('ul', { class: 'entries vault-list' }, ...docs.map((d) => {
        const actions = [];
        if (d.hasFile) {
          const open = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Abrir');
          open.addEventListener('click', async () => {
            open.disabled = true;
            try {
              const blob = await ctx.api.downloadVaultFile(d.id);
              const url = URL.createObjectURL(blob);
              const a = el('a', { href: url, download: `${d.title}.${d.mime === 'application/pdf' ? 'pdf' : d.mime === 'image/png' ? 'png' : d.mime === 'image/webp' ? 'webp' : 'jpg'}`, target: '_blank', rel: 'noopener' });
              document.body.append(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
            } catch { toast('Não consegui abrir o arquivo agora.'); }
            open.disabled = false;
          });
          actions.push(open);
        }
        if (!readOnly) {
          const dueIn = el('input', { class: 'input input-sm', type: 'date', value: d.dueOn ?? '', 'aria-label': `Vencimento de ${d.title}` });
          dueIn.addEventListener('change', async () => {
            try { await ctx.api.updateVaultDoc(d.id, { dueOn: dueIn.value || null }); toast(dueIn.value ? 'Vencimento salvo.' : 'Vencimento removido.'); ctx.refresh(); } catch { toast('Não consegui salvar agora.'); }
          });
          const del = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Apagar');
          del.addEventListener('click', async () => {
            if (!(await confirmDialog({ title: `Apagar "${d.title}"?`, text: 'O documento e o arquivo são apagados do cofre de vez.', confirmLabel: 'Apagar', danger: true }))) return;
            try { await ctx.api.deleteVaultDoc(d.id); ctx.refresh(); } catch { toast('Não consegui apagar agora.'); }
          });
          actions.push(dueIn, del);
        }
        const late = d.dueOn && daysTo(d.dueOn) < 0;
        return el('li', { class: 'entry vault-row' },
          el('span', { class: 'entry-note' }, el('strong', {}, d.title), el('span', { class: 'muted' }, ` · ${KIND[d.kind] ?? d.kind}${d.creditor ? ` · ${d.creditor}` : ''}${d.amountCents ? ` · ${brl(d.amountCents)}` : ''}`),
            d.dueOn ? el('span', { class: late ? 'neg' : 'muted', style: 'display:block' }, dueText(d.dueOn)) : null,
            d.notes ? el('span', { class: 'fine muted', style: 'display:block' }, d.notes) : null),
          el('span', { class: 'row-actions' }, ...actions));
      })));
  }
  draw(v.docs);
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try { draw((await ctx.api.getVault(search.value.trim())).docs); } catch { toast('Não consegui buscar agora.'); }
    }, 300);
  });

  return el('div', { class: 'acc-stack' },
    readOnly ? el('p', { class: 'note' }, icon('info'), el('span', {}, 'Seu acesso é só de consulta: você pode ver e abrir os documentos, mas quem guarda e apaga é o titular.')) : null,
    form ? card(el('h2', {}, 'Guardar documento'), el('p', { class: 'muted' }, 'Contrato da renegociação, acordo, boleto, comprovante de pagamento. Fica criptografado e só você (e quem divide a conta) abre. Se tiver vencimento, avisamos antes.'), form) : null,
    card(el('h2', {}, `Seu cofre (${v.count} de ${v.limit})`), search, list),
  );
}
