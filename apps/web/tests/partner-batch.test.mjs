import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchesBySize, MAX_BATCH_BYTES } from '../assets/js/partner-batch.js';

const row = (i, extras = 0) => ({ cpf: String(10000000000 + i), name: `PESSOA ${i}`, phones: ['21999990000'], extra: Object.fromEntries(Array.from({ length: extras }, (_, k) => [`C${k}`, 'x'.repeat(60)])) });
const bytes = (batch) => new TextEncoder().encode(JSON.stringify({ rows: batch })).length;

// O nginx corta qualquer corpo acima de 64 KB nas rotas da API: foi isso que fez a importação falhar com 987 contatos num lote de 200.
test('cada lote cabe com folga abaixo de 64 KB, mesmo com linhas pesadas', () => {
  const light = Array.from({ length: 987 }, (_, i) => row(i));
  const heavy = Array.from({ length: 300 }, (_, i) => row(i, 40));
  for (const list of [light, heavy]) {
    const batches = batchesBySize(list);
    assert.equal(batches.flat().length, list.length, 'nenhum contato se perde');
    for (const b of batches) assert.ok(bytes(b) < 64 * 1024, `lote de ${b.length} linhas com ${bytes(b)} bytes`);
  }
});

test('uma linha sozinha maior que o teto ainda segue (em lote próprio) e a ordem é mantida', () => {
  const list = [row(1), row(2, 400), row(3)];
  const batches = batchesBySize(list, 2000);
  assert.deepEqual(batches.flat().map((r) => r.cpf), list.map((r) => r.cpf));
  assert.ok(batches.some((b) => b.length === 1 && b[0].cpf === list[1].cpf));
  assert.deepEqual(batchesBySize([]), []);
  assert.ok(MAX_BATCH_BYTES < 64 * 1024);
});
