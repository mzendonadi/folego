// Extrato em blocos (data completa, descrição, "valor saldo", outra parte) com títulos de dia no meio. Dados inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePdfExtract } from '../src/account.ts';
import { cardPaymentHint } from '../src/invoice.ts';

const EXTRATO = `
EXTRATO DE CONTA
Agência: 0001 | Conta: 12.345678.9
Período: 01/10/2026 a 20/10/2026
Titular: Fulano
Saldo inicial
-R$ 100,00
Entradas
R$ 1.500,00
Saídas
R$ 1.065,50
Saldo final
R$ 334,50
DETALHE DOS MOVIMENTOS
Data Descrição Valor Saldo
Terça, 20 de outubro de 2026
20/10/2026
Pix enviado
-R$ 50,00   R$ 334,50
Maria Exemplo
20/10/2026
Pagamento cartao credito bce
-R$ 700,00   R$ 384,50
Banco Exemplo (br)
Segunda, 19 de outubro de 2026
19/10/2026
Pix recebido
R$ 1.500,00   R$ 1.084,50
Empresa Exemplo
1/2
DETALHE DOS MOVIMENTOS
Data Descrição Valor Saldo
05/10/2026
Tarifa mensalidade pacote servicos
-R$ 15,50   -R$ 415,50
Setembro / 2026
05/10/2026
Compra cartao deb mc
-R$ 300,00   -R$ 400,00
Mercado Central
`;

test('extrato em blocos: cada lançamento fica na data dele, com descrição e outra parte, e a soma bate com os saldos', () => {
  const r = parsePdfExtract(EXTRATO);
  assert.equal(r.entries.length, 5);
  assert.deepEqual(r.entries.map((e) => [e.date, e.amountCents, e.note]), [
    ['2026-10-05', -30_000, 'Compra cartao deb mc Mercado Central'],
    ['2026-10-05', -1_550, 'Tarifa mensalidade pacote servicos Setembro / 2026'],
    ['2026-10-19', 150_000, 'Pix recebido Empresa Exemplo'],
    ['2026-10-20', -70_000, 'Pagamento cartao credito bce Banco Exemplo (br)'],
    ['2026-10-20', -5_000, 'Pix enviado Maria Exemplo'],
  ]);
  assert.deepEqual(r.check, { ok: true, source: 'saldo', expectedCents: 43_450, parsedCents: 43_450 });
  assert.equal(r.skipped, 0);
});

test('extrato em blocos: título de dia e rodapé de página nunca viram texto de lançamento; saldo que não fecha avisa', () => {
  const r = parsePdfExtract(EXTRATO);
  assert.ok(r.entries.every((e) => !/outubro de 2026|DETALHE|^\d+\/\d+$/i.test(e.note)));
  const errado = parsePdfExtract(EXTRATO.replace('-R$ 50,00   R$ 334,50', '-R$ 51,00   R$ 334,50'));
  assert.equal(errado.check?.ok, false);
});

test('pagamento de fatura: "pagamento cartao credito" no extrato é reconhecido como pagamento de fatura', () => {
  assert.equal(cardPaymentHint('Pagamento cartao credito bce Banco Exemplo (br)'), 'forte');
  assert.equal(cardPaymentHint('Pagamento de boleto Sul America'), null);
});
