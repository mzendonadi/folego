// Leitor de PDF (roda no NAVEGADOR: o arquivo nunca é enviado ao servidor).
// Empacotado por scripts/build.mjs em assets/vendor/pdfread.js; o worker vai em assets/vendor/pdfworker.js
// (mesma origem, exigido pela CSP script-src 'self'). Usado só para extrair TEXTO (getTextContent),
// nunca para renderizar página, então não precisa buscar fontes/CMaps externos.
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';

// Caminho fixo a partir da raiz do site (não relativo a import.meta.url): depois do empacotamento, este
// módulo é incluído dentro de um chunk com HASH em assets/app/, então um caminho relativo apontaria para
// lá, não para assets/vendor/ (onde build.mjs copia o worker). scripts/build.mjs mantém os dois em sincronia.
// __VENDOR_V__ muda a cada build (ver build.mjs): esse arquivo tem nome fixo, e o Cloudflare já demonstrou
// cachear .js por horas mesmo com o Nginx mandando não cachear (D-032); uma URL nova por build evita isso.
GlobalWorkerOptions.workerSrc = `/assets/vendor/pdfworker-${__VENDOR_V__}.js`;

const MAX_PAGES = 12;

/**
 * @param {ArrayBuffer} bytes
 * @returns {Promise<{ text: string, pages: number, truncated: boolean }>}
 */
export async function extractPdfText(bytes, maxPages = MAX_PAGES) {
  const task = getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false });
  const doc = await task.promise;
  const pages = Math.min(doc.numPages, maxPages);
  const parts = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    let lastY = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 2) {
        parts.push(line.trim());
        line = '';
      }
      line += item.str + (item.hasEOL ? '\n' : ' ');
      lastY = item.transform[5];
    }
    if (line.trim()) parts.push(line.trim());
    parts.push(''); // separa páginas
  }
  await task.destroy();
  const text = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, pages: doc.numPages, truncated: doc.numPages > maxPages };
}
