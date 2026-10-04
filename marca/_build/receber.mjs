// Servidor local de uso único para gerar as imagens da marca: serve render.html e grava os PNG que o navegador desenha.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../png');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/salvar/')) {
    const name = path.basename(decodeURIComponent(req.url.slice(8)));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const dataUrl = Buffer.concat(chunks).toString();
      fs.writeFileSync(path.join(out, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
      res.end('ok');
    });
    return;
  }
  const file = path.join(here, req.url === '/' ? 'render.html' : path.basename(req.url));
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('nao'); }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
  res.end(fs.readFileSync(file));
}).listen(3200, () => console.log('pronto em http://localhost:3200'));
