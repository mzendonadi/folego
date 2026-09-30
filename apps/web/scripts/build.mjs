// Empacota tudo para publicação em apps/web/dist:
//  1) vendor: motor de cálculo (packages/domain) e gerador de QR → assets/vendor (entrada do passo 2)
//  2) app: assets/js/main.js e dependências num pacote com HASH no nome (cache infinito e sem versões velhas)
//  3) copia HTML, CSS, fontes, favicon, robots e config; reescreve index.html para o arquivo com hash
// O desenvolvimento local (apps/api, `npm run dev`) continua usando os módulos soltos de apps/web.
import { build } from 'esbuild';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.join(root, p);

// ---- 1) vendor ----
// Token de cada build: o pdf.js e o tesseract.js carregam worker/motor/idioma por CAMINHO (não por import),
// com nome de arquivo fixo — e o Cloudflare, aqui, já demonstrou cachear .js por horas mesmo com
// "Cache-Control: no-cache" do Nginx (D-032, mesmo motivo de main.js ter hash no nome). Um nome que muda a
// cada build garante que uma mudança (como a de hoje na CSP) chegue na hora, sem depender do cache expirar.
const vendorV = createHash('sha256').update(`${Date.now()}`).digest('hex').slice(0, 10);
// Some inteiro e refaz: como tudo aqui dentro é gerado, e o nome muda a cada build (__VENDOR_V__), sem
// isso as pastas tesseract-<versão antiga> e pdfworker-<versão antiga>.js iam só se acumular.
await rm(rel('assets/vendor'), { recursive: true, force: true, maxRetries: 8, retryDelay: 1000 });
await mkdir(rel('assets/vendor'), { recursive: true });
await build({
  entryPoints: {
    engine: path.resolve(root, '../../packages/domain/src/index.ts'),
    qr: rel('scripts/qr-entry.mjs'),
    pdf: rel('scripts/pdf-entry.mjs'),
    pdfread: rel('scripts/pdf-read-entry.mjs'),
    pdfworker: rel('node_modules/pdfjs-dist/build/pdf.worker.mjs'),
    ocr: rel('scripts/ocr-entry.mjs'),
  },
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outdir: rel('assets/vendor'),
  define: { __VENDOR_V__: JSON.stringify(vendorV) },
  logLevel: 'warning',
});

// Arquivos que o pdf.js e o tesseract.js carregam em runtime por CAMINHO (Worker, importScripts, fetch do
// .wasm e do pacote de idioma), não por import do JavaScript: o empacotador não os enxerga, então são só
// copiados. Isso também os mantém na mesma origem (nunca um CDN de terceiro), como a CSP exige.
// Nome/pasta levam __VENDOR_V__ (ver acima): pdf-read-entry.mjs e ocr-entry.mjs usam o mesmo valor.
async function copyVendorRuntime(dest) {
  const tesseractDir = `tesseract-${vendorV}`;
  await mkdir(path.join(dest, tesseractDir, 'core'), { recursive: true });
  await mkdir(path.join(dest, tesseractDir, 'lang'), { recursive: true });
  await copyFile(rel('assets/vendor/pdfworker.js'), path.join(dest, `pdfworker-${vendorV}.js`));
  await copyFile(rel('node_modules/tesseract.js/dist/worker.min.js'), path.join(dest, tesseractDir, 'worker.js'));
  // As três variantes do motor "só LSTM": o navegador escolhe sozinho a melhor que ele suporta
  // (SIMD relaxado > SIMD > nenhum), então precisamos ter as três hospedadas.
  for (const variant of ['tesseract-core-relaxedsimd-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-lstm']) {
    for (const ext of ['.wasm.js', '.wasm']) {
      await copyFile(rel(`node_modules/tesseract.js-core/${variant}${ext}`), path.join(dest, tesseractDir, 'core', `${variant}${ext}`));
    }
  }
  await copyFile(rel('assets/lang/por.traineddata.gz'), path.join(dest, tesseractDir, 'lang/por.traineddata.gz'));
}
await copyVendorRuntime(rel('assets/vendor'));

await mkdir(rel('assets/fonts'), { recursive: true });
for (const [pkg, file] of [
  ['@fontsource-variable/fraunces', 'fraunces-latin-wght-normal.woff2'],
  ['@fontsource-variable/fraunces', 'fraunces-latin-wght-italic.woff2'],
  ['@fontsource-variable/figtree', 'figtree-latin-wght-normal.woff2'],
]) {
  await copyFile(rel(`node_modules/${pkg}/files/${file}`), rel(`assets/fonts/${file}`));
}

// ---- 2) app com hash ----
const dist = rel('dist');
// maxRetries/retryDelay: no Windows, o antivírus às vezes segura um handle por um instante em arquivos
// grandes recém-criados (o .wasm do tesseract, por exemplo) e o rm dá EBUSY; o Node tenta de novo sozinho.
await rm(dist, { recursive: true, force: true, maxRetries: 8, retryDelay: 1000 });
await mkdir(path.join(dist, 'assets/app'), { recursive: true });

const result = await build({
  entryPoints: { main: rel('assets/js/main.js'), admin: rel('assets/js/admin/main.js') }, // site e backoffice (/gestao)
  bundle: true,
  splitting: true, // api-http e api-mock são carregados sob demanda
  format: 'esm',
  target: 'es2022',
  minify: true,
  outdir: path.join(dist, 'assets/app'),
  entryNames: '[name]-[hash]',
  chunkNames: 'chunk-[hash]',
  metafile: true,
  // config.js NÃO entra no pacote: o deploy o sobrescreve (API_BASE e DEV de produção).
  external: ['*/config.js'],
  logLevel: 'warning',
});

const outOf = (entry) => Object.entries(result.metafile.outputs).find(([, o]) => o.entryPoint === entry)?.[0];
const mainOut = outOf('assets/js/main.js');
const adminOut = outOf('assets/js/admin/main.js');
if (!mainOut || !adminOut) throw new Error('não achei a saída principal do esbuild');
const mainFile = path.basename(mainOut);
const adminFile = path.basename(adminOut);

// ---- 3) estáticos ----
await cp(rel('assets/fonts'), path.join(dist, 'assets/fonts'), { recursive: true });
await copyVendorRuntime(path.join(dist, 'assets/vendor')); // ver função acima: pdf.js e tesseract.js
await copyFile(rel('assets/favicon.svg'), path.join(dist, 'assets/favicon.svg'));
await copyFile(rel('assets/config.js'), path.join(dist, 'assets/config.js'));
await copyFile(rel('robots.txt'), path.join(dist, 'robots.txt'));

const css = await readFile(rel('assets/styles.css'));
const cssHash = createHash('sha256').update(css).digest('hex').slice(0, 10);
await writeFile(path.join(dist, 'assets/styles.css'), css);

let html = await readFile(rel('index.html'), 'utf8');
const before = html;
html = html.replace(/assets\/js\/main\.js(\?v=[^"]*)?/, `assets/app/${mainFile}`);
html = html.replace('assets/styles.css"', `assets/styles.css?v=${cssHash}"`);
if (html === before || !html.includes(`assets/app/${mainFile}`)) throw new Error('não consegui reescrever o index.html');
await writeFile(path.join(dist, 'index.html'), html);

// ---- backoffice: /gestao (noindex) com o pacote próprio, com hash no nome ----
const adminCss = await readFile(rel('assets/admin.css'));
const adminCssHash = createHash('sha256').update(adminCss).digest('hex').slice(0, 10);
await writeFile(path.join(dist, 'assets/admin.css'), adminCss);
let bo = await readFile(rel('gestao/index.html'), 'utf8');
bo = bo.replace('/assets/js/admin/main.js', `/assets/app/${adminFile}`).replace('/assets/styles.css"', `/assets/styles.css?v=${cssHash}"`).replace('/assets/admin.css"', `/assets/admin.css?v=${adminCssHash}"`);
if (!bo.includes(`/assets/app/${adminFile}`)) throw new Error('não consegui reescrever gestao/index.html');
await mkdir(path.join(dist, 'gestao'), { recursive: true });
await writeFile(path.join(dist, 'gestao/index.html'), bo);

console.log(`build ok · dist/assets/app/${mainFile} · admin ${adminFile} · styles.css?v=${cssHash}`);
