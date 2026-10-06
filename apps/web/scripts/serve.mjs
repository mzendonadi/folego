// Servidor estático mínimo para desenvolvimento. Rota /__dev/axe.js só existe aqui (auditoria de acessibilidade).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file;
    if (url.pathname === '/__dev/axe.js') file = path.join(root, 'node_modules/axe-core/axe.min.js');
    else {
      let clean = decodeURIComponent(url.pathname);
      // Endereços limpos do site (/conta, /pagamento...) entregam o index.html, como o servidor real.
      if (/^\/(diagnostico|processando|resultado|pagamento|mapa|complemento|ferramentas|tradutor|guia|parceiros|conta|descadastrar|acesso)(\/.*)?$/.test(clean)) clean = '/';
      else if (/^\/gestao\/.+/.test(clean)) clean = '/gestao/';
      file = path.resolve(root, `.${clean === '/' ? '/index.html' : clean}`);
      if (!file.startsWith(root) || file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}scripts${path.sep}`)) {
        res.writeHead(404).end('not found');
        return;
      }
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('não encontrado');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
