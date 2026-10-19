import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import { opportunities, stateOf } from '../src/admin/oportunidades.ts';
import type { Ctx } from '../src/services.ts';

test('oportunidades: a consulta roda no esquema real e devolve tudo zerado sem envios', async () => {
  const db = await createPgliteDb();
  await ensureSchema(db);
  const ctx = { db, config: loadConfig({ NODE_ENV: 'test' }) } as unknown as Ctx;
  const r = await opportunities(ctx);
  assert.deepEqual(r.counts, { total: 0, pendente: 0, tentando: 0, enviado: 0, falhou: 0, contatado: 0, contratado: 0, recusado: 0, sem_parceiro: 0 });
  assert.deepEqual(r.items, []);
  assert.equal(r.truncated, false);
});

test('oportunidades: o estado do envio ao parceiro em português', () => {
  assert.equal(stateOf('queued', 0), 'pendente');
  assert.equal(stateOf('queued', 2), 'tentando');
  assert.equal(stateOf('failed', 2), 'tentando', 'falhou mas ainda vai tentar de novo sozinho');
  assert.equal(stateOf('failed', 5), 'falhou');
  assert.equal(stateOf('delivered', 1), 'enviado');
  assert.equal(stateOf('contacted', 1), 'contatado');
  assert.equal(stateOf('converted', 1), 'contratado');
  assert.equal(stateOf('rejected', 0), 'recusado');
});
