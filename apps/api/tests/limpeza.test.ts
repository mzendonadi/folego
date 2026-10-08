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
  // Cenário de produção: visitante com sessão, caso preso a ela, contato guardado e conta demo ligada.
  const sess = await db.query<{ id: string }>(`INSERT INTO app.sessions(token_hash, expires_at) VALUES ('\x04'::bytea, now() + interval '1 day') RETURNING id`);
  await db.query(`INSERT INTO app.cases(session_id, purge_after, contact_email_enc, contact_phone_enc, ads_consent) VALUES ($1, now() + interval '7 days', '\x05'::bytea, '\x06'::bytea, true)`, [sess.rows[0]!.id]);
  await db.query(`UPDATE app.demo_accounts SET active = true`);
  const sql = readFileSync(new URL('../../../deploy/ops/limpar-teste.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  const s = await db.query<{ n: string }>(`SELECT count(*)::text n FROM app.settings WHERE key = 'algo'`);
  assert.equal(s.rows[0]!.n, '1');
  const c = await db.query<{ n: string }>(`SELECT count(*)::text n FROM app.sessions WHERE admin_user_id IS NULL`);
  assert.equal(c.rows[0]!.n, '0');
  const cases = await db.query<{ n: string }>(`SELECT count(*)::text n FROM app.cases`);
  assert.equal(cases.rows[0]!.n, '0');
  const demo = await db.query<{ n: string }>(`SELECT count(*)::text n FROM app.demo_accounts WHERE active`);
  assert.equal(demo.rows[0]!.n, '0', 'contas demo ficam desligadas');
  await db.close();
});
