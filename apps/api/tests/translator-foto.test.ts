// Tradutor de cobrança com texto vindo de FOTO (OCR no navegador): o texto sai sujo, longo e com caracteres estranhos.
// A leitura nunca pode falhar por isso: a API limpa e corta o texto e sempre devolve a prévia.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';

let db: Db;
let app: FastifyInstance;
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste' };

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  app = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), email: new MemorySender(), rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await db.close();
});

const base = 'Prezado cliente, identificamos débito em aberto referente ao contrato 12345 no valor de R$ 1.234,56 vencido em 10/05/2025. Regularize hoje com desconto de 80% e evite restrição no SPC e Serasa. ';
const send = (text: string) => app.inject({ method: 'POST', url: '/api/translations', headers: { 'x-folego': '1', 'content-type': 'application/json' }, payload: JSON.stringify({ text, acceptTerms: true }) });

const casos: Array<[string, string]> = [
  ['texto normal', base],
  ['foto de página inteira (mais de 4000 caracteres)', base.repeat(60)],
  ['foto enorme (mais de 30 mil caracteres)', base.repeat(300)],
  ['caractere nulo do OCR', `${base}\u0000 fim`],
  ['controles e caractere de substituição', `${base}\u0001\u0002\u000b� lixo`],
  ['surrogate solto', `${base}\ud800 x`],
  ['emoji e símbolos', `${base} 😀 ✔ ▪`],
  ['muito espaço e quebra de linha', `${base}\n\n\n\n     \t\t\n${base}`],
];
for (const [nome, texto] of casos) {
  test(`foto: ${nome}`, async () => {
    const res = await send(texto);
    assert.equal(res.statusCode, 201, res.body);
    const out = res.json();
    assert.ok(out.caseId);
    assert.ok(out.preview);
  });
}

test('texto vazio ou curto demais continua sendo recusado com mensagem clara', async () => {
  const res = await send('oi');
  assert.equal(res.statusCode, 400);
});
