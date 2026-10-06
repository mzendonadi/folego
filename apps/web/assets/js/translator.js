// Tradutor de cobrança: cole a mensagem, veja a leitura rápida (grátis) e libere a explicação completa por Pix.
import { el, icon, toast, copyText } from './dom.js';
import { brl } from './format.js';
import { CATALOG, daysOf } from './catalog.js';
import { accessBanner } from './access-banner.js';

const RISK = {
  high: { tone: 'critical', label: 'Risco alto' },
  attention: { tone: 'attention', label: 'Atenção' },
  low: { tone: 'ok', label: 'Poucos sinais de risco' },
};

const list = (items, cls = 'bullets') => el('ul', { class: cls }, ...items.map((t) => el('li', {}, t)));
const card = (...children) => el('section', { class: 'card d-section' }, ...children);
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR');

/** @param ctx { api, onBuy(caseId, codes), state } */
export function renderTranslator(root, ctx) {
  const { api, state } = ctx;

  /** redo = { orderId, result }: refazendo uma tradução já paga (mesmo prazo, sem pagar de novo). */
  function drawInput(prefill = '', redo = null) {
    const area = el('textarea', { class: 'input', id: 'tr-text', rows: '8', maxlength: '4000', placeholder: 'Cole aqui a mensagem, o e-mail ou o texto da cobrança…', 'aria-describedby': 'tr-help' });
    area.value = prefill;
    const idle = redo ? 'Refazer com este texto' : 'Traduzir esta cobrança';
    const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, idle, icon('arrow-right'));
    const back = redo ? el('button', { class: 'btn btn-quiet', type: 'button' }, 'Voltar à minha tradução') : null;
    back?.addEventListener('click', () => drawResult(redo.result, redo.orderId));

    // Importar de um PDF: o arquivo é lido no navegador (pdf.js) e nunca sai dele; só o texto extraído fica no campo.
    const pdfInput = el('input', { type: 'file', accept: 'application/pdf', id: 'tr-pdf', hidden: true });
    const pdfBtn = el('button', { class: 'btn btn-secondary btn-sm no-print', type: 'button' }, icon('list'), 'Importar PDF');
    pdfBtn.addEventListener('click', () => pdfInput.click());
    pdfInput.addEventListener('change', async () => {
      const file = pdfInput.files?.[0];
      if (!file) return;
      pdfBtn.disabled = true;
      pdfBtn.textContent = 'Lendo o PDF…';
      try {
        const { extractPdfText } = await import('../vendor/pdfread.js');
        const { text, truncated } = await extractPdfText(await file.arrayBuffer());
        if (!text.trim()) {
          toast('Não encontrei texto nesse PDF. Se for um PDF escaneado (imagem), cole o texto manualmente.');
        } else {
          area.value = area.value.trim() ? `${area.value.trim()}\n\n${text}` : text;
          area.dispatchEvent(new Event('input', { bubbles: true }));
          toast(truncated ? 'PDF importado (só as primeiras páginas). Confira o texto antes de traduzir.' : 'PDF importado. Confira o texto antes de traduzir.');
          area.focus();
        }
      } catch (error) {
        console.error(error);
        toast('Não consegui ler esse PDF. Tente colar o texto manualmente.');
      }
      pdfBtn.disabled = false;
      pdfBtn.textContent = 'Importar PDF';
      pdfInput.value = '';
    });

    // Tirar foto (ou escolher uma imagem já salva): OCR local (tesseract.js), a imagem nunca sai do navegador.
    // A leitura de foto erra (foco, luz, papel amassado), então o texto vem SEMPRE para conferência antes de
    // traduzir — nunca é enviado direto. É por isso que também vale colar direto do WhatsApp/e-mail quando dá.
    const photoInput = el('input', { type: 'file', accept: 'image/*', capture: 'environment', id: 'tr-photo', hidden: true });
    const photoBtn = el('button', { class: 'btn btn-secondary btn-sm no-print', type: 'button' }, icon('list'), 'Tirar foto ou escolher imagem');
    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      photoBtn.disabled = true;
      const original = photoBtn.textContent;
      photoBtn.textContent = 'Lendo a foto…';
      try {
        const { recognizeImage } = await import('../vendor/ocr.js');
        const text = await recognizeImage(file, (pct) => {
          photoBtn.textContent = `Lendo a foto… ${pct}%`;
        });
        if (!text) {
          toast('Não consegui ler nada nessa foto. Tente com mais luz e o documento sem dobras, ou digite manualmente.');
        } else {
          area.value = area.value.trim() ? `${area.value.trim()}\n\n${text}` : text;
          area.dispatchEvent(new Event('input', { bubbles: true }));
          toast('Foto lida. A leitura de foto erra às vezes — confira e corrija o texto antes de traduzir.');
          area.focus();
        }
      } catch (error) {
        console.error(error);
        toast('Não consegui ler essa foto agora. Tente digitar manualmente.');
      }
      photoBtn.disabled = false;
      photoBtn.textContent = original;
      photoInput.value = '';
    });
    const photoHint = el('p', { class: 'fine tr-photo-hint' }, icon('info'), ' A leitura de foto é experimental e pode errar palavras — sempre confira o texto abaixo antes de traduzir. Copiar e colar direto do WhatsApp ou e-mail costuma sair mais certo.');

    const form = el(
      'form', { class: 'tool-form' },
      el(
        'div', { class: 'field' },
        el('label', { class: 'label', for: 'tr-text' }, 'Texto da cobrança'),
        area,
        el('div', { class: 'button-row no-print' }, pdfInput, pdfBtn, photoInput, photoBtn),
        photoHint,
        el('p', { class: 'fine', id: 'tr-help' }, 'Não guardamos o texto que você cola: só o resultado da leitura. Evite colar CPF, senhas ou números de cartão.'),
      ),
      el('div', { class: 'button-row' }, btn, back),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (area.value.trim().length < 8) return toast('Cole um texto um pouco maior para eu conseguir ler.');
      btn.disabled = true;
      btn.textContent = redo ? 'Refazendo…' : 'Lendo…';
      if (redo) {
        try {
          await api.redoTranslation(redo.orderId, area.value);
          drawResult(await api.getTranslation(redo.orderId), redo.orderId);
          window.scrollTo({ top: 0 });
          toast('Pronto: a tradução foi refeita com o texto novo.');
        } catch (error) {
          btn.disabled = false;
          btn.textContent = idle;
          toast(error?.status === 403 || error?.status === 429 ? error.message : 'Não consegui refazer agora. Tente de novo.');
        }
        return;
      }
      try {
        const { caseId, preview } = await api.createTranslation(area.value);
        state.translatorCaseId = caseId;
        drawPreview(preview);
      } catch (error) {
        console.error(error);
        btn.disabled = false;
        btn.textContent = idle;
        toast(error?.status === 429 ? 'Muitas tentativas seguidas. Espere um minutinho.' : 'Não consegui ler agora. Tente de novo.');
      }
    });
    root.replaceChildren(
      card(
        ...(redo
          ? [accessBanner({ accessUntil: redo.result.accessUntil, what: 'tradutor' }), el('h2', {}, 'Refazer com outro texto'), el('p', { class: 'section-sub' }, 'Cole a nova cobrança. A tradução anterior é substituída pelo novo resultado; o prazo continua o mesmo.')]
          : [el('h2', {}, 'O que essa cobrança quer dizer?'), el('p', { class: 'section-sub' }, `Cole a mensagem que você recebeu. A leitura rápida é grátis; a explicação completa, com o que fazer e uma resposta pronta, custa pouco. Depois de pagar, você tem ${daysOf('collection_translator')} dias para ler quantas cobranças quiser.`)]),
        form,
      ),
    );
  }

  function drawPreview(p) {
    const risk = RISK[p.risk];
    const buy = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, `Liberar a explicação completa · ${brl(CATALOG.collection_translator.cents)}`, icon('arrow-right'));
    buy.addEventListener('click', () => ctx.onBuy(state.translatorCaseId, ['collection_translator']));
    const again = el('button', { class: 'btn btn-quiet', type: 'button' }, 'Ler outro texto');
    again.addEventListener('click', () => drawInput());
    root.replaceChildren(
      card(
        el('p', { class: 'eyebrow' }, 'Leitura rápida'),
        el('h2', {}, p.title),
        el('p', {}, el('span', { class: `pill tone-${risk.tone}` }, risk.label)),
        el('p', { class: 'section-sub' }, p.teaser),
        el('ul', { class: 'discover-list' },
          el('li', {}, icon('lock', 'icon icon-lock'), el('span', {}, p.flagCount > 0 ? `${p.flagCount} ${p.flagCount === 1 ? 'sinal de alerta encontrado' : 'sinais de alerta encontrados'}, com a explicação de cada um` : 'O que você deve conferir antes de qualquer resposta')),
          el('li', {}, icon('lock', 'icon icon-lock'), el('span', {}, p.amountsFound > 0 ? 'Os valores e datas que a mensagem cita, explicados' : 'O que significa cada parte da mensagem')),
          el('li', {}, icon('lock', 'icon icon-lock'), el('span', {}, 'O que fazer agora e o que nunca fazer')),
          el('li', {}, icon('lock', 'icon icon-lock'), el('span', {}, 'Uma mensagem pronta para responder e pedir tudo por escrito')),
        ),
        el('div', { class: 'button-row' }, buy, again),
        el('p', { class: 'fine' }, 'Pagamento único por Pix. Nada é cobrado se você não gostar.'),
      ),
    );
  }

  function drawResult({ analysis: a, accessUntil }, orderId) {
    const risk = RISK[a.risk];
    const numbers = [
      ...a.facts.amountsCents.map((c) => `Valor citado: ${brl(c)}. Peça o demonstrativo para saber quanto é principal e quanto é juros e multa.`),
      ...a.facts.dates.map((d) => `Data citada: ${fmtDate(d)}. Confira se é a do vencimento e se bate com o seu contrato ou fatura.`),
      ...a.facts.deadlines.map((d) => `Prazo exigido: ${d}. Pressão de prazo curto é técnica de cobrança e de golpe: você pode conferir antes de responder.`),
    ];
    const copyReply = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('copy'), 'Copiar mensagem');
    copyReply.addEventListener('click', async () => toast((await copyText(a.reply)) ? 'Mensagem copiada.' : 'Não consegui copiar. Selecione o texto e copie manualmente.'));
    const linkBtn = el('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, icon('lock'), 'Guardar link para abrir em outro aparelho');
    const linkOut = el('div', { class: 'access-out' });
    linkBtn.addEventListener('click', async () => {
      try {
        const { token } = await api.createAccessLink(orderId);
        const url = `${location.origin}/acesso#${token}`;
        const input = el('input', { class: 'input pix-code', type: 'text', readonly: true, value: url, 'aria-label': 'Seu link de acesso' });
        const copy = el('button', { class: 'btn btn-primary', type: 'button' }, icon('copy'), 'Copiar link');
        copy.addEventListener('click', async () => toast((await copyText(url)) ? 'Link copiado.' : 'Não consegui copiar.'));
        linkOut.replaceChildren(el('div', { class: 'pix-code-row' }, input, copy));
      } catch {
        toast('Não consegui gerar o link agora.');
      }
    });
    root.replaceChildren(
      ...[
      accessBanner({ accessUntil, what: 'tradutor', onRedo: () => { drawInput('', { orderId, result: { analysis: a, accessUntil } }); window.scrollTo({ top: 0 }); }, redoLabel: 'Traduzir outra cobrança' }),
      card(
        el('p', { class: 'eyebrow' }, 'Sua tradução'),
        el('h2', {}, a.title),
        el('p', {}, el('span', { class: `pill tone-${risk.tone}` }, risk.label)),
        el('p', {}, a.meaning),
      ),
      a.flags.length > 0
        ? card(el('h2', {}, 'Sinais que encontramos'), ...a.flags.map((f) => el('div', { class: 'note note-amber' }, icon('alert'), el('div', {}, el('strong', {}, f.title), el('p', {}, f.why)))))
        : card(el('h2', {}, 'Sinais que encontramos'), el('p', {}, 'Nenhum sinal forte de golpe. Isso não garante que a cobrança esteja correta: confira sempre.')),
      numbers.length > 0 ? card(el('h2', {}, 'O que a mensagem cita'), list(numbers)) : null,
      card(el('h2', {}, 'O que fazer agora'), list(a.doNow)),
      card(el('h2', {}, 'O que não fazer'), list(a.dontDo)),
      card(el('h2', {}, 'Mensagem pronta para responder'), el('pre', { class: 'letter' }, a.reply), el('div', { class: 'button-row' }, copyReply)),
      card(el('h2', {}, 'Seus direitos'), list(a.rights), el('p', { class: 'fine' }, 'Informação geral, não substitui orientação de advogado ou da Defensoria Pública.')),
      card(el('p', { class: 'muted' }, `Sua tradução fica disponível até ${new Date(accessUntil).toLocaleDateString('pt-BR')}.`), linkBtn, linkOut),
      ].filter(Boolean),
    );
  }

  return { drawInput, drawPreview, drawResult };
}
