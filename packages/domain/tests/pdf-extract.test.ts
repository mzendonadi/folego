import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePdfExtract } from '../src/account.ts';

const NOW = new Date('2026-04-10T12:00:00Z');

test('PDF de conta corrente: valores com sinal, D/C e coluna de saldo (usa o 1º valor, ignora o saldo)', () => {
  const text = [
    'Banco Exemplo - Extrato conta corrente',
    'Período 01/03/2026 a 31/03/2026',
    '01/03/2026 SALDO ANTERIOR 1.000,00',
    '02/03/2026 PIX RECEBIDO JOAO SILVA 250,00 C 1.250,00',
    '03/03/2026 COMPRA DEBITO SUPERMERCADO BOM PRECO -87,35 1.162,65',
    '05/03/2026 PAGAMENTO BOLETO ENERGIA 120,40 D',
    '31/03/2026 SALDO FINAL 900,00',
  ].join('\n');
  const { entries, skipped } = parsePdfExtract(text, NOW);
  assert.equal(skipped, 0);
  assert.deepEqual(entries.map((e) => [e.date, e.amountCents]), [['2026-03-02', 25000], ['2026-03-03', -8735], ['2026-03-05', -12040]]);
  assert.match(entries[0]!.note, /PIX RECEBIDO JOAO SILVA/);
});

test('PDF de fatura sem sinal e sem ano: "12 MAR" vira gasto; estorno vira entrada; o ano vem do extrato ou de agora', () => {
  const text = ['Fatura do cartão', '12 MAR Mercado Livre R$ 45,90', '13 MAR Estorno de compra R$ 10,00', '14 mar Padaria Central R$ 8,50'].join('\n');
  const { entries } = parsePdfExtract(text, NOW);
  assert.deepEqual(entries.map((e) => [e.date, e.amountCents]), [['2026-03-12', -4590], ['2026-03-13', 1000], ['2026-03-14', -850]]);
});

test('PDF com data curta (dd/mm), "-" no fim, parênteses e duas datas no começo', () => {
  const text = ['15/03 SUPERMERCADO X 45,90-', '16/03 17/03 TARIFA MENSAL (29,90)', '18/03 SALARIO EMPRESA LTDA 3.500,00 CR'].join('\n');
  const { entries } = parsePdfExtract(text, NOW);
  assert.deepEqual(entries.map((e) => [e.date, e.amountCents]), [['2026-03-15', -4590], ['2026-03-16', -2990], ['2026-03-18', 350000]]);
});

test('PDF: CPF, CNPJ e números de conta não ficam na descrição; linhas de ruído são ignoradas', () => {
  const text = [
    'Cliente: MARIA  CPF 123.456.789-09  Agência 1234 Conta 98765432-1',
    '20/03/2026 PIX ENVIADO MARIA CPF 123.456.789-09 conta 123456789 -50,00',
    '21/03/2026 Pagamento CNPJ 12.345.678/0001-90 Loja -10,00',
    'Página 1 de 3',
    '22/03/2026 DESCRICAO SEM VALOR',
  ].join('\n');
  const { entries, skipped } = parsePdfExtract(text, NOW);
  assert.equal(entries.length, 2);
  assert.ok(!/\d{6,}|\d{3}\.\d{3}\.\d{3}-\d{2}/.test(entries.map((e) => e.note).join(' ')));
  assert.equal(skipped, 1, 'a linha com data e sem valor é contada como não reconhecida');
});

test('PDF: data impossível e dezembro lido em janeiro (ano anterior)', () => {
  const { entries } = parsePdfExtract(['31/02/2026 ALGO -10,00', '20/12 COMPRA -30,00'].join('\n'), new Date('2026-01-10T12:00:00Z'));
  assert.deepEqual(entries.map((e) => [e.date, e.amountCents]), [['2025-12-20', -3000]]);
});

test('PDF vazio ou sem lançamentos devolve lista vazia', () => {
  assert.deepEqual(parsePdfExtract('', NOW), { entries: [], skipped: 0 });
  assert.equal(parsePdfExtract('Apenas um texto qualquer\nsem datas', NOW).entries.length, 0);
});
