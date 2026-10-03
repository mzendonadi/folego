import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPgliteDb, ensureSchema } from '../src/db.ts';

// O script de limpeza de produção (deploy/ops/limpar-teste.sql) precisa funcionar no esquema real e preservar a configuração.
test('limpar-teste.sql apaga clientes e mantém configuração e dono', async () => {
  const db = await createPgliteDb();
  await ensureSchema(db);
  await db.query(`INSERT INTO app.settings(key, value) VALUES ('algo', '{}'::jsonb)`);
  await db.query(`INSERT INTO app.subscribers(email_hash, email_enc) VALUES ('\x01'::bytea, '\x02'::bytea)`).catch(async () => {
    await db.query(`INSERT INTO app.sessions(token_hash, expires_at) VALUES ('\x03'::bytea, now() + interval '1 day')`);
  });
  const sql = readFileSync(new URL('../../../deploy/ops/limpar-teste.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  const s = await db.query<{ n: string }>(`SELECT count(*)::text n FROM app.settings WHERE key = 'algo'`);
  assert.equal(s.rows[0]!.n, '1');
  const c = await db.query<{ n: string }>(`SELECT count(*)::text n FROM app.sessions WHERE admin_user_id IS NULL`);
  assert.equal(c.rows[0]!.n, '0');
  await db.close();
});
