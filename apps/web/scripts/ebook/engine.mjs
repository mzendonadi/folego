// Motor de diagramação do eBook do Fôlego (pdf-lib). Recebe blocos de conteúdo e devolve um PDF A4 com arte vetorial:
// capa, aberturas de capítulo em página cheia, caixas de destaque, tabelas, listas, cabeçalho/rodapé e sumário com páginas.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

export const C = {
  ink: rgb(0.075, 0.13, 0.11),
  body: rgb(0.16, 0.2, 0.19),
  muted: rgb(0.42, 0.47, 0.45),
  green: rgb(0.043, 0.29, 0.227),
  green2: rgb(0.1, 0.42, 0.33),
  mint: rgb(0.86, 0.94, 0.9),
  mint2: rgb(0.7, 0.86, 0.78),
  sand: rgb(0.965, 0.945, 0.9),
  sand2: rgb(0.92, 0.89, 0.82),
  gold: rgb(0.78, 0.6, 0.18),
  rose: rgb(0.78, 0.36, 0.3),
  sky: rgb(0.78, 0.89, 0.94),
  white: rgb(1, 1, 1),
  line: rgb(0.82, 0.84, 0.8),
};

const PW = 595.28;
const PH = 841.89;
const MX = 62;
const MT = 78;
const MB = 70;
const TW = PW - MX * 2;

export async function createBook({ title, author }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setAuthor(author);
  pdf.setSubject('Finanças pessoais, calma e liberdade');
  pdf.setLanguage('pt-BR');
  const f = {
    reg: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    ital: await pdf.embedFont(StandardFonts.HelveticaOblique),
    serif: await pdf.embedFont(StandardFonts.TimesRoman),
    serifB: await pdf.embedFont(StandardFonts.TimesRomanBold),
    serifI: await pdf.embedFont(StandardFonts.TimesRomanItalic),
  };
  const ok = new Map();
  const clean = (t) =>
    Array.from(String(t).normalize('NFC'))
      .map((ch) => {
        if (!ok.has(ch)) {
          let good = true;
          try {
            f.reg.encodeText(ch);
          } catch {
            good = false;
          }
          ok.set(ch, good);
        }
        if (ok.get(ch)) return ch;
        return { '→': '->', '≈': '~', '≥': '>=', '≤': '<=', '…': '...', '✓': 'v', '★': '*', '✔': 'v' }[ch] ?? '';
      })
      .join('');

  const st = { page: null, y: 0, chapter: '', pageNo: 0, toc: [], numbered: true, theme: 'light' };

  // ---------- arte ----------
  const mark = (page, cx, cy, r, color = C.green, dot = color) => {
    page.drawCircle({ x: cx, y: cy, size: r, borderColor: color, borderWidth: r * 0.2, color: undefined });
    page.drawCircle({ x: cx, y: cy, size: r * 0.42, color: dot });
    // abertura do "fôlego": um pequeno recorte na borda do anel
    page.drawCircle({ x: cx + r * 0.86, y: cy + r * 0.5, size: r * 0.22, color: st.theme === 'dark' ? C.green : C.white });
  };
  const rings = (page, cx, cy, count, step, color, width = 0.8, opacity = 0.5) => {
    for (let i = 1; i <= count; i += 1) page.drawCircle({ x: cx, y: cy, size: i * step, borderColor: color, borderWidth: width, borderOpacity: opacity });
  };
  const wave = (page, x0, y0, w, amp, color, thick = 1.2, phase = 0, opacity = 0.6) => {
    const steps = 48;
    let prev = null;
    for (let i = 0; i <= steps; i += 1) {
      const x = x0 + (w * i) / steps;
      const y = y0 + Math.sin((i / steps) * Math.PI * 4 + phase) * amp;
      if (prev) page.drawLine({ start: prev, end: { x, y }, thickness: thick, color, opacity });
      prev = { x, y };
    }
  };

  const newPage = (bg = null) => {
    st.page = pdf.addPage([PW, PH]);
    st.pageNo += 1;
    st.y = PH - MT;
    if (bg) st.page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: bg });
    return st.page;
  };
  const chrome = () => {
    if (!st.numbered) return;
    const p = st.page;
    p.drawText(clean('fôlego · respira, organiza, avança'), { x: MX, y: PH - 40, size: 8, font: f.reg, color: C.muted });
    if (st.chapter) p.drawText(clean(st.chapter), { x: PW - MX - f.reg.widthOfTextAtSize(clean(st.chapter), 8), y: PH - 40, size: 8, font: f.reg, color: C.muted });
    p.drawLine({ start: { x: MX, y: PH - 48 }, end: { x: PW - MX, y: PH - 48 }, thickness: 0.4, color: C.line });
    p.drawLine({ start: { x: MX, y: 48 }, end: { x: PW - MX, y: 48 }, thickness: 0.4, color: C.line });
    const n = String(st.pageNo);
    p.drawText(n, { x: PW / 2 - f.reg.widthOfTextAtSize(n, 9) / 2, y: 32, size: 9, font: f.bold, color: C.green });
    mark(p, MX + 4, 36, 4.2, C.green2);
  };
  const flow = (need) => {
    if (st.y - need < MB) {
      newPage();
      chrome();
    }
  };

  // ---------- texto com **negrito** e _itálico_ ----------
  const tokens = (text, base) => {
    const out = [];
    const parts = String(text).split(/(\*\*[^*]+\*\*|_[^_]+_)/g).filter((s) => s !== '');
    for (const part of parts) {
      let font = base.reg;
      let t = part;
      if (part.startsWith('**')) {
        font = base.bold;
        t = part.slice(2, -2);
      } else if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
        font = base.ital;
        t = part.slice(1, -1);
      }
      for (const w of t.split(/(\s+)/).filter(Boolean)) out.push({ w: clean(w), font, space: /^\s+$/.test(w) });
    }
    return out;
  };
  const wrap = (text, size, width, fonts = { reg: f.reg, bold: f.bold, ital: f.ital }) => {
    const lines = [];
    let line = [];
    let used = 0;
    for (const tk of tokens(text, fonts)) {
      const wd = tk.font.widthOfTextAtSize(tk.w, size);
      if (tk.space) {
        if (line.length) {
          line.push({ ...tk, w: ' ' });
          used += tk.font.widthOfTextAtSize(' ', size);
        }
        continue;
      }
      if (used + wd > width && line.length) {
        while (line.length && line[line.length - 1].w === ' ') line.pop();
        lines.push(line);
        line = [];
        used = 0;
      }
      line.push(tk);
      used += wd;
    }
    while (line.length && line[line.length - 1].w === ' ') line.pop();
    if (line.length) lines.push(line);
    return lines;
  };
  const drawLines = (lines, x, size, lead, color, fonts) => {
    for (const ln of lines) {
      let cx = x;
      for (const tk of ln) {
        st.page.drawText(tk.w, { x: cx, y: st.y - size, size, font: tk.font, color });
        cx += tk.font.widthOfTextAtSize(tk.w, size);
      }
      st.y -= lead;
    }
  };

  // ---------- blocos ----------
  const api = {
    pdf,
    fonts: f,
    get pageNo() {
      return st.pageNo;
    },
    cover({ kicker, title: t, subtitle, author: a }) {
      st.numbered = false;
      st.theme = 'dark';
      const p = newPage(C.green);
      rings(p, PW * 0.78, PH * 0.66, 9, 34, C.green2, 1, 0.9);
      rings(p, PW * 0.78, PH * 0.66, 3, 12, C.mint2, 0.6, 0.35);
      wave(p, 0, 190, PW, 16, C.mint2, 1.4, 0, 0.5);
      wave(p, 0, 165, PW, 12, C.green2, 1.2, 1.4, 0.8);
      wave(p, 0, 140, PW, 9, C.gold, 1.1, 2.6, 0.55);
      mark(p, MX + 18, PH - MT - 8, 18, C.white, C.gold);
      p.drawText('fôlego', { x: MX + 46, y: PH - MT - 16, size: 26, font: f.serifB, color: C.white });
      p.drawText(clean(kicker.toUpperCase()), { x: MX, y: PH * 0.58, size: 10.5, font: f.bold, color: C.gold });
      let y = PH * 0.58 - 40;
      for (const ln of t) {
        p.drawText(clean(ln), { x: MX, y, size: 50, font: f.serifB, color: C.white });
        y -= 56;
      }
      st.y = y - 4;
      st.page = p;
      for (const ln of wrap(subtitle, 15, 380, { reg: f.serif, bold: f.serifB, ital: f.serifI })) {
        let cx = MX;
        for (const tk of ln) {
          p.drawText(tk.w, { x: cx, y: st.y, size: 15, font: tk.font, color: C.mint });
          cx += tk.font.widthOfTextAtSize(tk.w, 15);
        }
        st.y -= 21;
      }
      p.drawText(clean(a), { x: MX, y: 78, size: 10, font: f.reg, color: C.mint2 });
      p.drawText('folego.online', { x: PW - MX - f.reg.widthOfTextAtSize('folego.online', 10), y: 78, size: 10, font: f.bold, color: C.white });
      st.theme = 'light';
    },
    page(bg = null) {
      newPage(bg);
      chrome();
    },
    /** Abertura de capítulo em página cheia, com arte própria por capítulo. */
    chapter({ num, title: t, subtitle, epigraph, art = 0 }) {
      st.numbered = false;
      st.theme = 'dark';
      const p = newPage(C.green);
      const seeds = [
        () => { rings(p, PW - 70, PH - 150, 8, 30, C.green2, 1, 0.9); },
        () => { wave(p, 0, PH - 200, PW, 24, C.green2, 1.4, 0.4, 0.9); wave(p, 0, PH - 230, PW, 18, C.mint2, 1, 1.6, 0.4); wave(p, 0, PH - 260, PW, 12, C.gold, 1, 2.8, 0.5); },
        () => { for (let i = 0; i < 9; i += 1) p.drawRectangle({ x: PW - 40 - i * 46, y: PH - 330, width: 30, height: 40 + i * 24, color: C.green2, opacity: 0.8 }); },
        () => { for (let i = 0; i < 7; i += 1) rings(p, 90 + i * 70, PH - 180 - (i % 2) * 40, 3, 14 + i * 2, C.green2, 0.9, 0.9); },
      ];
      seeds[art % seeds.length]();
      const big = String(num).padStart(2, '0');
      p.drawText(big, { x: MX, y: PH - 400, size: 150, font: f.serifB, color: C.green2 });
      p.drawText(clean(`CAPÍTULO ${num}`), { x: MX, y: PH - 440, size: 11, font: f.bold, color: C.gold });
      let y = PH - 490;
      for (const ln of wrap(t, 36, TW, { reg: f.serifB, bold: f.serifB, ital: f.serifI })) {
        let cx = MX;
        for (const tk of ln) {
          p.drawText(tk.w, { x: cx, y, size: 36, font: f.serifB, color: C.white });
          cx += f.serifB.widthOfTextAtSize(tk.w, 36);
        }
        y -= 42;
      }
      y -= 8;
      for (const ln of wrap(subtitle, 14, 400, { reg: f.serif, bold: f.serifB, ital: f.serifI })) {
        let cx = MX;
        for (const tk of ln) {
          p.drawText(tk.w, { x: cx, y, size: 14, font: tk.font, color: C.mint });
          cx += tk.font.widthOfTextAtSize(tk.w, 14);
        }
        y -= 20;
      }
      if (epigraph) {
        p.drawLine({ start: { x: MX, y: 140 }, end: { x: MX + 40, y: 140 }, thickness: 2, color: C.gold });
        let ey = 120;
        for (const ln of wrap(epigraph, 11, 380, { reg: f.serifI, bold: f.serifB, ital: f.serifI })) {
          let cx = MX;
          for (const tk of ln) {
            p.drawText(tk.w, { x: cx, y: ey, size: 11, font: f.serifI, color: C.mint2 });
            cx += f.serifI.widthOfTextAtSize(tk.w, 11);
          }
          ey -= 15;
        }
      }
      mark(p, PW - MX - 10, 62, 10, C.mint2, C.gold);
      st.theme = 'light';
      st.numbered = true;
      st.chapter = `${num}. ${t}`;
      st.toc.push({ num, title: t, page: st.pageNo });
      newPage();
      chrome();
    },
    h2(text) {
      flow(52);
      st.y -= 10;
      st.page.drawRectangle({ x: MX, y: st.y - 4, width: 5, height: 20, color: C.gold });
      st.page.drawText(clean(text), { x: MX + 14, y: st.y, size: 16, font: f.serifB, color: C.green });
      st.y -= 28;
    },
    h3(text) {
      flow(36);
      st.page.drawText(clean(text), { x: MX, y: st.y - 11, size: 11.5, font: f.bold, color: C.green2 });
      st.y -= 22;
    },
    p(text) {
      const lines = wrap(text, 10.8, TW);
      for (const ln of lines) {
        flow(17);
        drawLines([ln], MX, 10.8, 16.2, C.body);
      }
      st.y -= 6;
    },
    lead(text) {
      const fonts = { reg: f.serifI, bold: f.serifB, ital: f.serifI };
      const lines = wrap(text, 14, TW - 20, fonts);
      flow(lines.length * 21 + 12);
      st.page.drawRectangle({ x: MX, y: st.y - lines.length * 21 + 12, width: 3, height: lines.length * 21 - 4, color: C.gold });
      for (const ln of lines) {
        let cx = MX + 16;
        for (const tk of ln) {
          st.page.drawText(tk.w, { x: cx, y: st.y - 14, size: 14, font: f.serifI, color: C.green });
          cx += f.serifI.widthOfTextAtSize(tk.w, 14);
        }
        st.y -= 21;
      }
      st.y -= 16;
    },
    ul(items, { ordered = false } = {}) {
      items.forEach((it, i) => {
        const lines = wrap(it, 10.8, TW - 22);
        flow(lines.length * 16 + 4);
        const top = st.y;
        if (ordered) {
          st.page.drawCircle({ x: MX + 7, y: top - 7, size: 8, color: C.mint });
          const n = String(i + 1);
          st.page.drawText(n, { x: MX + 7 - f.bold.widthOfTextAtSize(n, 8.5) / 2, y: top - 10, size: 8.5, font: f.bold, color: C.green });
        } else st.page.drawCircle({ x: MX + 6, y: top - 7.5, size: 2.6, color: C.gold });
        drawLines(lines, MX + 22, 10.8, 16.2, C.body);
        st.y -= 3;
      });
      st.y -= 5;
    },
    /** Caixa de destaque. kind: dica | atencao | exemplo | exercicio | conta | historia */
    box(kind, title, content) {
      const style = {
        dica: { bg: C.mint, bar: C.green2, label: 'DICA DO FÔLEGO' },
        atencao: { bg: rgb(0.99, 0.93, 0.89), bar: C.rose, label: 'ATENÇÃO' },
        exemplo: { bg: C.sand, bar: C.gold, label: 'NA PRÁTICA' },
        exercicio: { bg: C.sky, bar: rgb(0.2, 0.45, 0.6), label: 'MÃO NA MASSA' },
        conta: { bg: rgb(0.93, 0.95, 0.9), bar: C.green, label: 'FAZENDO A CONTA' },
        historia: { bg: C.sand2, bar: C.gold, label: 'HISTÓRIA COMUM' },
      }[kind];
      const items = Array.isArray(content) ? content : [content];
      const inner = TW - 36;
      const rowsOut = [];
      for (const it of items) {
        const bullet = it.startsWith('- ');
        const lines = wrap(bullet ? it.slice(2) : it, 10.3, inner - (bullet ? 14 : 0));
        lines.forEach((ln, i) => rowsOut.push({ ln, bullet, first: i === 0, gap: i === lines.length - 1 ? 4 : 0 }));
      }
      // Paginação por simulação: a caixa pode continuar na página seguinte, com fundo em cada pedaço.
      const HEAD = 46;
      if (st.y - MB < HEAD + 48) {
        newPage();
        chrome();
      }
      const segs = [];
      let cur = { rows: [], h: HEAD };
      let room = st.y - MB;
      for (const r of rowsOut) {
        const need = 15 + r.gap;
        if (cur.h + need + 10 > room) {
          cur.h += 10;
          segs.push(cur);
          room = PH - MT - MB;
          cur = { rows: [], h: 16 };
        }
        cur.rows.push(r);
        cur.h += need;
      }
      cur.h += 10;
      segs.push(cur);
      segs.forEach((seg, si) => {
        if (si > 0) {
          newPage();
          chrome();
        }
        const top = st.y;
        st.page.drawRectangle({ x: MX, y: top - seg.h, width: TW, height: seg.h, color: style.bg });
        st.page.drawRectangle({ x: MX, y: top - seg.h, width: 4.5, height: seg.h, color: style.bar });
        let y = top;
        if (si === 0) {
          st.page.drawText(clean(style.label), { x: MX + 18, y: top - 20, size: 7.8, font: f.bold, color: style.bar });
          st.page.drawText(clean(title), { x: MX + 18, y: top - 36, size: 12, font: f.serifB, color: C.ink });
          y = top - 46;
        } else {
          st.page.drawText(clean(`${title} (continuação)`), { x: MX + 18, y: top - 14, size: 8, font: f.bold, color: style.bar });
          y = top - 20;
        }
        st.y = y;
        for (const r of seg.rows) {
          if (r.bullet && r.first) st.page.drawCircle({ x: MX + 22, y: st.y - 7, size: 2, color: style.bar });
          drawLines([r.ln], MX + 18 + (r.bullet ? 14 : 0), 10.3, 15, C.body);
          st.y -= r.gap;
        }
        st.y = top - seg.h - 12;
      });
    },
    table({ head, rows, widths, align = [], note }) {
      const total = widths.reduce((a, b) => a + b, 0);
      const w = widths.map((x) => (x / total) * TW);
      const rowH = 20;
      const need = rowH * (rows.length + 1) + 16;
      flow(Math.min(need, 300));
      const draw = (cells, y, bold, fill) => {
        if (fill) st.page.drawRectangle({ x: MX, y: y - rowH + 5, width: TW, height: rowH, color: fill });
        let x = MX;
        cells.forEach((c, i) => {
          const font = bold ? f.bold : f.reg;
          let txt = clean(c);
          while (font.widthOfTextAtSize(txt, 9.2) > w[i] - 12 && txt.length > 2) txt = txt.slice(0, -1);
          const tw = font.widthOfTextAtSize(txt, 9.2);
          const px = align[i] === 'r' ? x + w[i] - 8 - tw : x + 8;
          st.page.drawText(txt, { x: px, y: y - rowH + 11, size: 9.2, font, color: bold ? C.white : C.body });
          x += w[i];
        });
      };
      draw(head, st.y, true, C.green);
      st.y -= rowH;
      rows.forEach((r, i) => {
        if (st.y - rowH < MB) {
          newPage();
          chrome();
          draw(head, st.y, true, C.green);
          st.y -= rowH;
        }
        draw(r, st.y, false, i % 2 === 0 ? C.sand : null);
        st.y -= rowH;
      });
      st.page.drawLine({ start: { x: MX, y: st.y + 5 }, end: { x: MX + TW, y: st.y + 5 }, thickness: 0.6, color: C.green });
      st.y -= 8;
      if (note) {
        for (const ln of wrap(note, 8.8, TW, { reg: f.ital, bold: f.bold, ital: f.ital })) {
          flow(13);
          drawLines([ln], MX, 8.8, 12.5, C.muted);
        }
      }
      st.y -= 8;
    },
    quote(text, who) {
      const lines = wrap(text, 15, TW - 40, { reg: f.serifI, bold: f.serifB, ital: f.serifI });
      flow(lines.length * 22 + 40);
      st.y -= 6;
      st.page.drawText('"', { x: MX, y: st.y - 28, size: 54, font: f.serifB, color: C.mint2 });
      for (const ln of lines) {
        let cx = MX + 34;
        for (const tk of ln) {
          st.page.drawText(tk.w, { x: cx, y: st.y - 16, size: 15, font: f.serifI, color: C.green });
          cx += f.serifI.widthOfTextAtSize(tk.w, 15);
        }
        st.y -= 22;
      }
      if (who) {
        st.page.drawText(clean(`— ${who}`), { x: MX + 34, y: st.y - 12, size: 9.5, font: f.bold, color: C.muted });
        st.y -= 20;
      }
      st.y -= 10;
    },
    /** Checklist com quadradinhos para marcar. */
    checklist(title, items) {
      flow(40 + items.length * 20);
      st.page.drawText(clean(title), { x: MX, y: st.y - 12, size: 12, font: f.serifB, color: C.green });
      st.y -= 28;
      for (const it of items) {
        const lines = wrap(it, 10.5, TW - 30);
        flow(lines.length * 15 + 8);
        st.page.drawRectangle({ x: MX, y: st.y - 11, width: 11, height: 11, borderColor: C.green2, borderWidth: 1 });
        drawLines(lines, MX + 22, 10.5, 15, C.body);
        st.y -= 4;
      }
      st.y -= 8;
    },
    space(n = 10) {
      st.y -= n;
    },
    /** Faixa decorativa (respiro visual) com ondas e uma frase. */
    breath(text) {
      flow(120);
      const top = st.y;
      st.page.drawRectangle({ x: MX, y: top - 96, width: TW, height: 96, color: C.green });
      wave(st.page, MX, top - 74, TW, 5, C.green2, 1.1, 0.3, 0.9);
      wave(st.page, MX, top - 82, TW, 4, C.mint2, 0.8, 1.9, 0.4);
      const lines = wrap(text, 14.5, TW - 60, { reg: f.serifI, bold: f.serifB, ital: f.serifI });
      let y = top - 30;
      for (const ln of lines) {
        let cx = MX + 30;
        for (const tk of ln) {
          st.page.drawText(tk.w, { x: cx, y, size: 14.5, font: f.serifI, color: C.white });
          cx += f.serifI.widthOfTextAtSize(tk.w, 14.5);
        }
        y -= 20;
      }
      st.y = top - 96 - 16;
    },
    /** Página de sumário gerada depois (precisa saber as páginas dos capítulos). */
    reserveToc() {
      st.numbered = true;
      st.chapter = 'Sumário';
      newPage();
      chrome();
      st.tocPage = st.page;
      st.tocIndex = pdf.getPageCount() - 1;
    },
    fillToc(entries = st.toc) {
      const p = st.tocPage;
      let y = PH - 100;
      p.drawText('Sumário', { x: MX, y, size: 28, font: f.serifB, color: C.green });
      y -= 18;
      p.drawText(clean('Respire fundo. Cada capítulo cabe em uma sentada.'), { x: MX, y, size: 10.5, font: f.serifI, color: C.muted });
      y -= 36;
      for (const e of entries) {
        p.drawText(String(e.num).padStart(2, '0'), { x: MX, y, size: 16, font: f.serifB, color: C.gold });
        p.drawText(clean(e.title), { x: MX + 40, y, size: 12.5, font: f.bold, color: C.ink });
        const pg = String(e.page);
        const wpg = f.bold.widthOfTextAtSize(pg, 12);
        p.drawText(pg, { x: PW - MX - wpg, y, size: 12, font: f.bold, color: C.green });
        const tw = f.bold.widthOfTextAtSize(clean(e.title), 12.5);
        for (let x = MX + 48 + tw; x < PW - MX - wpg - 10; x += 5) p.drawCircle({ x, y: y + 3, size: 0.6, color: C.line });
        y -= 28;
      }
    },
    back({ lines, url }) {
      st.numbered = false;
      st.theme = 'dark';
      const p = newPage(C.green);
      rings(p, PW / 2, PH / 2 + 60, 7, 30, C.green2, 1, 0.9);
      mark(p, PW / 2, PH / 2 + 60, 26, C.white, C.gold);
      let y = PH / 2 - 110;
      for (const ln of lines) {
        const w = f.serifI.widthOfTextAtSize(clean(ln), 16);
        p.drawText(clean(ln), { x: PW / 2 - w / 2, y, size: 16, font: f.serifI, color: C.mint });
        y -= 24;
      }
      const w = f.bold.widthOfTextAtSize(url, 13);
      p.drawText(url, { x: PW / 2 - w / 2, y: y - 18, size: 13, font: f.bold, color: C.gold });
      st.theme = 'light';
    },
    async save() {
      return pdf.save();
    },
    degrees,
  };
  return api;
}
