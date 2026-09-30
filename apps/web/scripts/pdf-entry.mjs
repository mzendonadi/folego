// Gerador de PDF (roda no NAVEGADOR: os dados pessoais das cartas nunca vão ao servidor).
// Empacotado por scripts/build.mjs em assets/vendor/pdf.js e carregado só quando a pessoa pede o PDF.
// Layout de carta formal: cidade/data à direita, destinatário, assunto em negrito, parágrafos justificados,
// itens numerados com recuo, assinatura junta na mesma página, marca-d'água discreta e numeração por carta.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

const PAGE = [595.28, 841.89]; // A4 em pontos
const M_X = 76;
const M_TOP = 84;
const M_BOTTOM = 86;
const SIZE = 11.5;
const LEADING = 17;
const GAP = 9; // espaço entre parágrafos
const INK = rgb(0.1, 0.12, 0.11);
const MUTED = rgb(0.45, 0.49, 0.47);
const BRAND = rgb(0.16, 0.5, 0.38);
const MARK = rgb(0.16, 0.5, 0.38);

/** Fontes padrão do PDF só aceitam WinAnsi: troca o que não couber (setas, emojis…) por um equivalente simples. */
function sanitizer(font) {
  const cache = new Map();
  const ok = (ch) => {
    if (cache.has(ch)) return cache.get(ch);
    let good = true;
    try {
      font.encodeText(ch);
    } catch {
      good = false;
    }
    cache.set(ch, good);
    return good;
  };
  const swaps = { '→': '->', '≥': '>=', '≤': '<=', '…': '...', ' ': ' ', '​': '' };
  return (text) =>
    Array.from(text.normalize('NFC'))
      .map((ch) => (ok(ch) ? ch : (swaps[ch] ?? '?')))
      .join('');
}

/** Quebra um texto corrido em linhas de palavras (palavra maior que a linha é cortada por caractere). */
function layout(text, font, size, maxWidth, firstIndent = 0, restIndent = 0) {
  const lines = [];
  let words = [];
  let used = 0;
  let indent = firstIndent;
  const space = font.widthOfTextAtSize(' ', size);
  const push = () => {
    lines.push({ words, indent });
    words = [];
    used = 0;
    indent = restIndent;
  };
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    let word = raw;
    while (font.widthOfTextAtSize(word, size) > maxWidth - indent) {
      if (words.length) push();
      let cut = word.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > maxWidth - indent) cut--;
      words.push(word.slice(0, cut));
      push();
      word = word.slice(cut);
    }
    const w = font.widthOfTextAtSize(word, size);
    if (words.length && used + space + w > maxWidth - indent) push();
    used += (words.length ? space : 0) + w;
    words.push(word);
  }
  if (words.length) lines.push({ words, indent });
  return lines;
}

/** Interpreta o texto da carta em blocos com papel definido. */
function parseLetter(body) {
  const blocks = body.replace(/\r/g, '').trim().split(/\n{2,}/);
  let prev = '';
  return blocks.map((b, i) => {
    const r = classify(b, i, prev);
    prev = r.kind;
    return r;
  });
}

function classify(b, i, prev) {
  {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    if (prev === 'closing') return { kind: 'signature', lines };
    if (i === 0 && lines.length === 1 && /,/.test(lines[0]) && lines[0].length < 80) return { kind: 'place', lines };
    if (/^Assunto:/i.test(lines[0])) return { kind: 'subject', lines: [lines.join(' ')] };
    if (/^Atenciosamente,?$/i.test(lines[0])) return { kind: 'closing', lines };
    if (lines.length > 1 && lines.every((l) => /^(\d+[.)]|[-•])\s/.test(l))) return { kind: 'list', lines };
    if (/^(À|Ao|Aos|Às)\s/.test(lines[0])) return { kind: 'address', lines };
    return { kind: 'text', lines: [lines.join(' ')] };
  }
}

/** Marca-d'água: anel + "fôlego" na diagonal, bem clara, centrada na página. */
function watermark(page, bold, safe) {
  const size = 84;
  const label = safe('fôlego');
  const w = bold.widthOfTextAtSize(label, size);
  const h = size * 0.7;
  const ang = (32 * Math.PI) / 180;
  const cx = PAGE[0] / 2;
  const cy = PAGE[1] / 2;
  // ponto de origem do texto para que o CENTRO do texto caia em (cx, cy) depois de girar
  const x = cx - (w / 2) * Math.cos(ang) + (h / 2) * Math.sin(ang);
  const y = cy - (w / 2) * Math.sin(ang) - (h / 2) * Math.cos(ang);
  page.drawText(label, { x, y, size, font: bold, color: MARK, opacity: 0.075, rotate: degrees(32) });
  // anel do logotipo, acima do texto na mesma diagonal
  const ringR = 26;
  const back = w / 2 + ringR + 22;
  const rx = cx - back * Math.cos(ang);
  const ry = cy - back * Math.sin(ang);
  page.drawCircle({ x: rx, y: ry, size: ringR, borderColor: MARK, borderWidth: 6, borderOpacity: 0.075, opacity: 0 });
  page.drawCircle({ x: rx, y: ry, size: 9, color: MARK, opacity: 0.075 });
}

/**
 * @param docs [{ title, body }]: cada carta começa em página nova.
 * @returns Uint8Array com o PDF. Com mais de uma carta, a primeira página é um índice (não é para enviar).
 */
export async function buildPdf(docs, { cover = docs.length > 1 } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setCreator('Fôlego');
  pdf.setProducer('Fôlego (folego.online)');
  pdf.setTitle(docs.length === 1 ? docs[0].title : 'Cartas e defesas');
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const ui = await pdf.embedFont(StandardFonts.Helvetica);
  const uiBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const safe = sanitizer(font);
  const width = PAGE[0] - M_X * 2;
  const bottom = M_BOTTOM;

  const newPage = () => {
    const p = pdf.addPage(PAGE);
    watermark(p, uiBold, safe);
    return p;
  };

  if (cover) {
    const page = newPage();
    let y = PAGE[1] - M_TOP;
    page.drawText('Suas cartas e defesas', { x: M_X, y: y - 22, size: 24, font: uiBold, color: INK });
    y -= 40;
    page.drawText('Preparadas no Fôlego', { x: M_X, y: y - 12, size: 11, font: ui, color: BRAND });
    y -= 34;
    page.drawLine({ start: { x: M_X, y }, end: { x: PAGE[0] - M_X, y }, thickness: 0.6, color: MUTED });
    y -= 30;
    page.drawText('Neste arquivo', { x: M_X, y: y - 12, size: 12, font: uiBold, color: INK });
    y -= 30;
    docs.forEach((d, i) => {
      for (const line of layout(safe(`${i + 1}.  ${d.title}`), ui, 10.5, width, 0, 16)) {
        page.drawText(line.words.join(' '), { x: M_X + line.indent, y: y - 10.5, size: 10.5, font: ui, color: INK });
        y -= 16;
      }
      y -= 4;
    });
    y -= 14;
    page.drawText('Antes de enviar', { x: M_X, y: y - 12, size: 12, font: uiBold, color: INK });
    y -= 30;
    const tips = [
      'Complete o que ainda estiver entre colchetes [ ] e confira seus dados.',
      'Imprima só as páginas das cartas: esta página é apenas um índice.',
      'Guarde uma cópia de tudo e anote o protocolo de cada envio.',
      'Estes são modelos informativos. Confirme com um advogado ou com a Defensoria Pública se se aplicam ao seu caso.',
    ];
    for (const t of tips) {
      const lines = layout(safe(`•  ${t}`), ui, 10.5, width, 0, 14);
      for (const line of lines) {
        page.drawText(line.words.join(' '), { x: M_X + line.indent, y: y - 10.5, size: 10.5, font: ui, color: INK });
        y -= 15;
      }
      y -= 5;
    }
  }

  for (const doc of docs) {
    const first = pdf.getPageCount();
    let page = newPage();
    let y = PAGE[1] - M_TOP;

    const ensure = (need) => {
      if (y - need < bottom) {
        page = newPage();
        y = PAGE[1] - M_TOP;
      }
    };
    const drawLine = (line, f, opts = {}) => {
      const { justify = false, align = 'left' } = opts;
      const avail = width - line.indent;
      const words = line.words;
      const text = words.join(' ');
      let x = M_X + line.indent;
      if (align === 'right') x = PAGE[0] - M_X - f.widthOfTextAtSize(text, SIZE);
      if (justify && words.length > 1 && !line.last) {
        const natural = words.reduce((s, w) => s + f.widthOfTextAtSize(w, SIZE), 0);
        const gap = (avail - natural) / (words.length - 1);
        for (const w of words) {
          page.drawText(w, { x, y: y - SIZE, size: SIZE, font: f, color: INK });
          x += f.widthOfTextAtSize(w, SIZE) + gap;
        }
      } else {
        page.drawText(text, { x, y: y - SIZE, size: SIZE, font: f, color: INK });
      }
      y -= LEADING;
    };
    const flow = (text, f, o = {}) => {
      const lines = layout(safe(text), f, SIZE, width, o.first ?? 0, o.rest ?? 0);
      lines.forEach((l, i) => {
        l.last = i === lines.length - 1;
      });
      lines.forEach((l) => {
        ensure(LEADING);
        drawLine(l, f, o);
      });
    };

    for (const block of parseLetter(doc.body)) {
      if (block.kind === 'place') {
        flow(block.lines[0], font, { align: 'right' });
        y -= GAP * 2;
      } else if (block.kind === 'address') {
        block.lines.forEach((l, i) => flow(l, i === 0 ? bold : font));
        y -= GAP * 1.6;
      } else if (block.kind === 'subject') {
        flow(block.lines[0], bold);
        y -= GAP * 1.4;
      } else if (block.kind === 'list') {
        for (const l of block.lines) {
          const m = l.match(/^(\d+[.)]|[-•])\s+(.*)$/);
          const label = safe(m[1]);
          const lines = layout(safe(m[2]), font, SIZE, width - 22, 0, 0);
          lines.forEach((ln, i) => {
            ln.last = i === lines.length - 1;
            ln.indent = 22;
            ensure(LEADING);
            if (i === 0) page.drawText(label, { x: M_X + 4, y: y - SIZE, size: SIZE, font, color: INK });
            drawLine(ln, font, { justify: true });
          });
          y -= 3;
        }
        y -= GAP - 3;
      } else if (block.kind === 'closing') {
        // "Atenciosamente," e a assinatura ficam juntas na mesma página
        ensure(LEADING * 7);
        y -= GAP;
        flow(block.lines[0], font);
        y -= LEADING * 1.6;
      } else if (block.kind === 'signature') {
        block.lines.forEach((l, i) => flow(l, i === 0 ? bold : font));
      } else if (block.kind === 'text') {
        flow(block.lines[0], font, { justify: true });
        y -= GAP;
      }
    }
    const count = pdf.getPageCount() - first;
    for (let i = 0; i < count; i++) {
      const p = pdf.getPage(first + i);
      const label = safe(count > 1 ? `Página ${i + 1} de ${count}` : '');
      if (label) p.drawText(label, { x: PAGE[0] - M_X - ui.widthOfTextAtSize(label, 8), y: 44, size: 8, font: ui, color: MUTED });
      p.drawText('folego.online', { x: M_X, y: 44, size: 8, font: ui, color: MUTED, opacity: 0.8 });
    }
  }

  return pdf.save();
}
