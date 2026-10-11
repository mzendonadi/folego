// Servidor local de uso único: serve reels.html e grava em marca/reels os PNG que o navegador desenha (logo com fundo transparente).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../reels');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/salvar/')) {
    const name = path.basename(decodeURIComponent(req.url.slice(8)));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.writeFileSync(path.join(out, name), Buffer.from(Buffer.concat(chunks).toString().split(',')[1], 'base64'));
      res.end('ok');
    });
    return;
  }
  const file = path.join(here, req.url === '/' ? 'reels.html' : path.basename(req.url));
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('nao'); }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
  res.end(fs.readFileSync(file));
}).listen(3201, () => console.log('pronto em http://localhost:3201'));
