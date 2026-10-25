import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickEntry, parseReceiptText } from '../src/quick.ts';

const today = '2026-10-24';
const q = (s: string) => parseQuickEntry(s, today);

test('lançar rápido: frases do dia a dia viram gasto com valor, descrição e categoria', () => {
  assert.deepEqual(q('almoço 45 no débito'), { date: today, amountCents: -4500, note: 'Almoço no débito', category: 'mercado' });
  assert.deepEqual(q('gastei 62 na farmácia'), { date: today, amountCents: -6200, note: 'Farmácia', category: 'saude' });
  assert.deepEqual(q('Paguei R$ 1.234,56 de aluguel'), { date: today, amountCents: -123_456, note: 'Aluguel', category: 'moradia' });
  assert.deepEqual(q('uber 18,90'), { date: today, amountCents: -1890, note: 'Uber', category: 'transporte' });
  assert.equal(q('mercado 250 reais')?.amountCents, -25_000);
  assert.equal(q('café 4.50')?.amountCents, -450, 'ponto com dois dígitos é centavos');
  assert.equal(q('curso 1.200')?.amountCents, -120_000, 'ponto com três dígitos é milhar');
});

test('lançar rápido: entrada, datas faladas e parcelas', () => {
  const sal = q('recebi 3.500 de salário ontem')!;
  assert.equal(sal.amountCents, 350_000);
  assert.equal(sal.date, '2026-10-23');
  assert.equal(sal.category, 'renda');
  assert.equal(q('pizza 80 anteontem')?.date, '2026-10-22');
  assert.equal(q('luz 180 dia 10')?.date, '2026-10-10');
  assert.equal(q('luz 180 dia 28')?.date, '2026-09-28', 'dia que ainda não chegou neste mês é do mês passado');
  assert.equal(q('internet 99,90 em 12/10')?.date, '2026-10-12');
  assert.equal(q('internet 99,90 em 12/10')?.note, 'Internet', 'sobra de "em" no fim é tirada');
  assert.equal(q('geladeira 3x 400')?.amountCents, -40_000, '"3x" é parcela, não o valor');
  assert.equal(q('tênis R$ 300 em 3 vezes')?.amountCents, -30_000, 'o valor marcado com R$ vence');
});

test('lançar rápido: sem valor não inventa nada', () => {
  assert.equal(q(''), null);
  assert.equal(q('fui ao mercado'), null);
  assert.equal(q('hoje'), null);
  assert.equal(q('dia 10'), null, 'o dia não é valor');
  assert.equal(q('0'), null);
});

test('comprovante lido por OCR: pega o total, a data e o estabelecimento', () => {
  const cupom = [
    'SUPERMERCADO BOM PREÇO LTDA', 'CNPJ 12.345.678/0001-90', 'Rua das Flores, 100', 'CUPOM FISCAL', '24/10/2026 18:32',
    'ARROZ 5KG          22,90', 'FEIJAO 1KG          8,50', 'SUBTOTAL            31,40', 'DESCONTO             1,40', 'VALOR TOTAL R$      30,00',
  ].join('\n');
  const r = parseReceiptText(cupom, today)!;
  assert.equal(r.amountCents, -3000);
  assert.equal(r.date, '2026-10-24');
  assert.equal(r.note, 'Supermercado bom preço ltda');
  assert.equal(r.category, 'mercado');
  assert.equal(parseReceiptText('foto escura sem nada legível', today), null);
  assert.equal(parseReceiptText('POSTO SHELL\nTOTAL A PAGAR 210,00\n10/01/2099', today)!.date, today, 'data no futuro é ignorada');
});
