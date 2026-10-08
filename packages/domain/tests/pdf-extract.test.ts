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
  assert.deepEqual(parsePdfExtract('', NOW), { entries: [], skipped: 0, check: null });
  assert.equal(parsePdfExtract('Apenas um texto qualquer\nsem datas', NOW).entries.length, 0);
});

const HOJE = new Date('2026-10-08T12:00:00Z'); // depois do extrato de setembro/2026
// Extrato em várias linhas por lançamento (data só uma vez por dia, valor em outra linha, sinal no fim): o formato que
// um leitor de "uma linha por lançamento" perde quase inteiro. Valores e nomes inventados.
const EXTRATO_VARIAS_LINHAS = [
  'EXTRATO CONSOLIDADO',
  'setembro/2026',
  'Extrato_Modelo - 27/11/2024',
  'Resumo - setembro/2026',
  '(=) Saldo de Conta Corrente em 31/08 500,00-',
  '(+) Total de Créditos 1.800,00',
  '(-) Total de Débitos 1.139,70',
  'Conta Corrente',
  'Movimentação',
  'Data Descrição Nº Documento Movimento (R$) Saldo (R$)',
  'SALDO EM 31/08 500,00-',
  '01/09 TARIFA PACOTE SERVICOS',
  'PERIODO: 01/08 A 31/08/26',
  '- 38,70-',
  'JUROS SALDO UTILIZ ATE LIMITE',
  'PERIODO: 01/08 A 31/08/26',
  '- 100,00- 638,70-',
  '02/09 PIX RECEBIDO',
  'FULANO DE TAL',
  '- 1.500,00',
  'PIX ENVIADO',
  'CICLANO SOUZA',
  '- 200,00- 661,30',
  '03/09 PIX ENVIADO Beltrano Silva - 60,00- 601,30',
  'COMPRA CARTAO DEB MC',
  '03/09 Loja Exemplo',
  '520861 41,00-',
  'PIX RECEBIDO',
  'EMPRESA EXEMPLO LTDA',
  '442932 300,00 860,30',
  'EXTRATO CONSOLIDADO',
  'setembro/2026',
  'Pagina: 3/5',
  'Data Descrição Nº Documento Movimento (R$) Saldo (R$)',
  '04/09 PAGAMENTO DE BOLETO',
  'CONCESSIONARIA EXEMPLO',
  '- 700,00- 160,30',
  'SALDO EM 30/09 160,30',
  'Saldos por Período',
  'Comprovantes de Pagamento',
  '09/09 INTERNET BANKING PIX CICLANO SOUZA 200,00',
];

test('PDF em várias linhas por lançamento (estilo Santander): lê tudo, usa o ano do cabeçalho e ignora tabelas repetidas', () => {
  const { entries, skipped } = parsePdfExtract(EXTRATO_VARIAS_LINHAS.join('\n'), HOJE);
  assert.equal(skipped, 0);
  assert.deepEqual(entries.map((e) => [e.date, e.amountCents]), [
    ['2026-09-01', -3870], ['2026-09-01', -10000], ['2026-09-02', 150000], ['2026-09-02', -20000],
    ['2026-09-03', -6000], ['2026-09-03', -4100], ['2026-09-03', 30000], ['2026-09-04', -70000],
  ]);
  assert.match(entries[1]!.note, /^JUROS SALDO UTILIZ/, '"saldo" no meio da descrição não faz da linha um saldo');
  assert.ok(entries.every((e) => !/PERIODO: 01\/08 A 31\/08\/26.*PERIODO/.test(e.note)));
});

test('PDF: a conferência com o saldo e com os totais do extrato fecha ao centavo', () => {
  const { check } = parsePdfExtract(EXTRATO_VARIAS_LINHAS.join('\n'), HOJE);
  assert.deepEqual(check, { ok: true, source: 'saldo', expectedCents: 66030, parsedCents: 66030 });
});

test('PDF: se uma linha ficar de fora, a conferência acusa a diferença (é o aviso de "não confie nesta leitura")', () => {
  const semUma = EXTRATO_VARIAS_LINHAS.filter((l) => l !== '- 100,00- 638,70-');
  const { entries, check } = parsePdfExtract(semUma.join('\n'), HOJE);
  assert.ok(entries.length < 8);
  assert.equal(check?.ok, false);
  assert.equal(check!.expectedCents - check!.parsedCents, -10000, 'a diferença é exatamente o valor que faltou');
});

test('PDF: descrição que começa com data mas nunca ganha valor conta como linha não reconhecida', () => {
  const { entries, skipped } = parsePdfExtract(['Data Descrição Valor', '10/03/2026 COMPRA SEM VALOR', 'rodapé qualquer', '11/03/2026 PIX ENVIADO -5,00'].join('\n'), NOW);
  assert.equal(entries.length, 1);
  assert.equal(skipped, 1);
});
