// "Maiores gastos" sem linhas repetidas e detecção do Resumo Executivo vazio das Estratégias. Dados inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTopSpend, spendKey } from '../src/reports.ts';
import { summaryRows } from '../src/strategies.ts';

const r = (id: string, d: string, note: string, cents: number, category = 'outros') => ({ id, d, note, category, cents: String(cents) });

test('maiores gastos: a mesma despesa escrita de jeitos parecidos aparece uma vez só, com total, quantidade e datas', () => {
  const top = groupTopSpend([
    r('1', '2026-08-07', 'DEBITO EMPRESTIMO CNR', 336_428, 'dividas'),
    r('2', '2026-09-24', 'GOOGLE *ADS220270622 (500,00 EURO)', 331_443),
    r('3', '2026-10-26', 'Juros do parcelamento da fatura 10/2026', 301_412, 'dividas'),
    r('4', '2026-08-10', 'PAGAMENTO DE BOLETO OUTROS BANCOS BANCO C6 S.A.', 287_066, 'financiamento'),
    r('5', '2026-09-10', 'PAGAMENTO DE BOLETO OUTROS BANCOS BANCO C6 S.A.', 287_066, 'financiamento'),
    r('6', '2026-10-09', 'Pagamento de boleto outros bancos Banco C6 S.a.', 286_931, 'financiamento'),
    r('7', '2026-08-01', 'GOOGLE *ADS220270622 (250,43 EURO)', 162_940),
    r('8', '2026-10-09', 'Pagamento de boleto outros bancos leduc - Instituto De', 148_145, 'faculdade'),
    r('9', '2026-08-10', 'PAGAMENTO DE BOLETO OUTROS BANCOS IEDUC - INSTITUTO DE EDUC', 148_145, 'faculdade'),
  ]);
  const keys = top.map((x) => spendKey(x.note));
  assert.equal(new Set(keys).size, keys.length, 'nenhuma linha repetida');
  assert.equal(top.length, 5, 'C6, Google, Ieduc, empréstimo e juros do parcelamento');
  const c6 = top.find((x) => /banco c6/i.test(x.note))!;
  assert.equal(c6.count, 3);
  assert.equal(c6.cents, 287_066 + 287_066 + 286_931);
  assert.deepEqual(c6.dates, ['2026-10-09', '2026-09-10', '2026-08-10'], 'datas do mais novo para o mais antigo');
  assert.equal(top[0]!.id, '4', 'ordenado pelo total: o grupo do C6 vem primeiro e carrega o título do maior lançamento');
  const google = top.find((x) => /google/i.test(x.note))!;
  assert.equal(google.count, 2, 'o "(500,00 EURO)" e o "(250,43 EURO)" são a mesma cobrança');
  assert.equal(google.cents, 331_443 + 162_940);
  const ieduc = top.find((x) => /ieduc|leduc/i.test(x.note))!;
  assert.equal(ieduc.count, 2, 'o mesmo texto cortado em pontos diferentes e com "I" lido como "l"');
});

test('maiores gastos: despesas diferentes continuam separadas e o limite vale', () => {
  const rows = Array.from({ length: 14 }, (_, i) => r(String(i), '2026-10-01', `Loja numero ${i} ${'x'.repeat(i + 1)}`, 10_000 + i));
  assert.equal(groupTopSpend(rows).length, 10);
  assert.equal(groupTopSpend([r('a', '2026-10-01', 'Padaria Sol', 1_000), r('b', '2026-10-02', 'Padaria Lua', 2_000)]).length, 2);
});

test('resumo executivo: só o cabeçalho (resposta cortada) conta como vazio; com linhas, conta as linhas', () => {
  const corpo = '### 1. Diagnóstico\ntexto\n\n---\n\n### 5. Resumo Executivo\n';
  const cabecalho = '| Ação imediata | Resultado esperado | Prioridade |\n|---|---|---|\n';
  assert.equal(summaryRows(`${corpo}${cabecalho}`), 0, 'cortada no cabeçalho');
  assert.equal(summaryRows(`${corpo}| Ação imediata | Resultado esperado | Prioridade |`), 0, 'sem nem a separação');
  assert.equal(summaryRows('### 4. Alocação\ntexto'), 0, 'sem a seção 5');
  assert.equal(summaryRows(`${corpo}${cabecalho}| Quitar o cheque especial | Economiza juros | Alto |\n| Reserva de emergência | Mais segurança | Médio |\n`), 2);
});
