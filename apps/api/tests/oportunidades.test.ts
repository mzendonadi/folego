import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import { opportunities } from '../src/admin/oportunidades.ts';
import type { Ctx } from '../src/services.ts';

test('oportunidades: a consulta roda no esquema real e devolve contagens zeradas sem diagnósticos', async () => {
  const db = await createPgliteDb();
  await ensureSchema(db);
  const ctx = { db, config: loadConfig({ NODE_ENV: 'test' }) } as unknown as Ctx;
  const r = await opportunities(ctx);
  assert.deepEqual(r.counts, { diagnosticos: 0, prioritarios: 0, prioritariosComCelular: 0, semMapa: 0, semMapaComCelular: 0, parceiroSemMapa: 0, comCelular: 0 });
  assert.deepEqual(r.items, []);
  assert.equal(r.truncated, false);
});
