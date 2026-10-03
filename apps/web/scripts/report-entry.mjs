// Relatório "Meus dados" em PDF (roda no NAVEGADOR: os dados da conta vêm da API e o PDF é montado aqui, sem ir a terceiros).
// Empacotado por scripts/build.mjs em assets/vendor/report.js e carregado só quando a pessoa pede o PDF.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE = [595.28, 841.89]; // A4 retrato
const MX = 42;
const TOP = 56;
const BOTTOM = 52;
const INK = rgb(0.1, 0.12, 0.11);
const MUTED = rgb(0.4, 0.44, 0.42);
const BRAND = rgb(0.06, 0.36, 0.27);
const TINT = rgb(0.9, 0.95, 0.92);
const LINE = rgb(0.82, 0.85, 0.83);

const brl = (cents) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
  return (text) => Array.from(String(text ?? '').normalize('NFC')).map((ch) => (ok(ch) ? ch : ch === '→' ? '->' : '?')).join('');
}

/** @param report { email, plan, generatedAt, summary:[{label,value}], sheets:[{name,headers,rows,moneyCols}] } */
export async function buildReportPdf(report) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Prumo — meus dados');
  pdf.setAuthor('Fôlego');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = sanitizer(font);
  const width = PAGE[0] - MX * 2;
  let page = pdf.addPage(PAGE);
  let y = PAGE[1] - TOP;

  const ensure = (h) => {
    if (y - h < BOTTOM) {
      page = pdf.addPage(PAGE);
      y = PAGE[1] - TOP;
    }
  };
  const fit = (text, f, size, max) => {
    let t = clean(text);
    if (f.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && f.widthOfTextAtSize(`${t}...`, size) > max) t = t.slice(0, -1);
    return `${t}...`;
  };
  const text = (t, x, size, f = font, color = INK) => page.drawText(clean(t), { x, y, size, font: f, color });

  // Cabeçalho
  text('Prumo', MX, 22, bold, BRAND);
  y -= 18;
  text('Meus dados · o app de finanças do Fôlego', MX, 10, font, MUTED);
  y -= 22;
  text(`Conta: ${report.email}  ·  Plano ${report.plan}`, MX, 10.5);
  y -= 14;
  text(`Gerado em ${new Date(report.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, MX, 9.5, font, MUTED);
  y -= 24;

  // Resumo
  ensure(26 + report.summary.length * 16);
  text('Resumo', MX, 13, bold, BRAND);
  y -= 18;
  for (const s of report.summary) {
    text(s.label, MX, 10, font, MUTED);
    text(s.value, MX + 190, 10.5, bold);
    y -= 15;
  }
  y -= 10;

  for (const sheet of report.sheets) {
    if (sheet.rows.length === 0) continue;
    const money = new Set(sheet.moneyCols ?? []);
    const cols = sheet.headers.length;
    const colW = width / cols;
    const rowH = 15;
    ensure(34 + rowH * 2);
    text(sheet.name, MX, 13, bold, BRAND);
    y -= 8;
    const drawHead = () => {
      page.drawRectangle({ x: MX, y: y - rowH + 3, width, height: rowH, color: TINT });
      sheet.headers.forEach((h, i) => page.drawText(fit(h, bold, 8.5, colW - 8), { x: MX + i * colW + 4, y: y - rowH + 7, size: 8.5, font: bold, color: INK }));
      y -= rowH;
    };
    y -= 6;
    drawHead();
    for (const row of sheet.rows) {
      if (y - rowH < BOTTOM) {
        ensure(9999);
        text(`${sheet.name} (continuação)`, MX, 11, bold, BRAND);
        y -= 14;
        drawHead();
      }
      row.forEach((v, i) => {
        const label = v === null || v === '' ? '' : typeof v === 'number' ? (money.has(i) ? brl(v) : String(v)) : String(v);
        const f = font;
        const w = f.widthOfTextAtSize(clean(label), 8.5);
        const x = typeof v === 'number' ? MX + (i + 1) * colW - 4 - Math.min(w, colW - 8) : MX + i * colW + 4;
        page.drawText(fit(label, f, 8.5, colW - 8), { x, y: y - rowH + 7, size: 8.5, font: f, color: INK });
      });
      page.drawLine({ start: { x: MX, y: y - rowH + 3 }, end: { x: MX + width, y: y - rowH + 3 }, thickness: 0.4, color: LINE });
      y -= rowH;
    }
    y -= 18;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(clean(`Prumo · Fôlego · página ${i + 1} de ${pages.length}`), { x: MX, y: 28, size: 8, font, color: MUTED }));
  return pdf.save();
}
