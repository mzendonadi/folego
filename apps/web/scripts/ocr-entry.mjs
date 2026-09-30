// Leitura de foto (OCR) para o Tradutor de Cobrança: roda inteiramente no NAVEGADOR (tesseract.js + WASM),
// a imagem nunca é enviada ao servidor. Tudo (worker, motor e o pacote de português) é hospedado por nós em
// assets/vendor/tesseract — nunca busca nada de CDN — para caber na CSP (script-src/connect-src 'self') e
// para não depender de um serviço de terceiro. O texto extraído é só um RASCUNHO: a pessoa sempre confere/edita
// antes de traduzir, porque leitura automática de foto erra (iluminação, foco, papel amassado).
import { createWorker } from 'tesseract.js';

// Caminho fixo a partir da raiz do site, não relativo a import.meta.url: depois do empacotamento este módulo
// vai dentro de um pedaço com HASH em assets/app/, então um caminho relativo apontaria para lá, não para
// assets/vendor/ (onde build.mjs copia estes arquivos). Mesmo motivo do pdf-read-entry.mjs.
// O nome da pasta muda a cada build (ver __VENDOR_V__ em build.mjs): esses arquivos têm nome fixo, e o
// Cloudflare já demonstrou cachear .js por horas mesmo com o Nginx mandando não cachear (D-032); uma pasta
// nova por build evita servir uma cópia velha, do mesmo jeito que assets/app/main-HASH.js já faz.
const BASE = `/assets/vendor/tesseract-${__VENDOR_V__}/`;

/**
 * @param {File|Blob} image
 * @param {(pct: number) => void} [onProgress] 0–100
 * @returns {Promise<string>}
 */
export async function recognizeImage(image, onProgress) {
  const worker = await createWorker('por', undefined, {
    workerPath: `${BASE}worker.js`,
    corePath: `${BASE}core/`,
    langPath: `${BASE}lang/`,
    workerBlobURL: false, // blob: violaria a CSP script-src 'self'; carrega o worker direto pela URL
    gzip: true,
    logger: (m) => {
      if (onProgress && m.status === 'recognizing text') onProgress(Math.round((m.progress ?? 0) * 100));
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return (data.text ?? '').trim();
  } finally {
    await worker.terminate();
  }
}
