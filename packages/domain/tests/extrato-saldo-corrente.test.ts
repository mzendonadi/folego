// Extrato em PDF com valor e saldo no fim de cada linha e crédito SEM sinal (formato de cooperativa): o sinal sai da corrente de saldos.
// Nomes e documentos inventados; as datas, os valores e a estrutura seguem um extrato real que lia tudo como saída.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePdfExtract } from '../src/index.ts';

const EXTRATO = [
  'Associado: EMPRESA EXEMPLO LTDA',
  'Cooperativa: 0001',
  'Conta: 12345-6',
  'Extrato (Período de 01/10/2026 a 31/10/2026)',
  'Data Descrição Documento Valor (R$) Saldo (R$)',
  'SALDO ANTERIOR 0,83',
  '05/10/2026 RECEBIMENTO PIX 11111111111 CLIENTE UM DA SILVA PIX_CRED 200,00 200,83',
  '05/10/2026 INTEGR.CAPITAL SUBSCRITO CAPITA -20,00 180,83',
  '05/10/2026 DEBITO CONVENIOS 11222333000144 PREFEITURA-G PREFEITURA-G -199,57 -18,74',
  '07/10/2026 JUROS UTILIZ.CH.ESPECIAL ENC036 -0,14 -18,88',
  '08/10/2026 TED 11222333000144 CLIENTE DOIS INSTALACOES 323826 9.305,00 9.286,12',
  '13/10/2026 INTEGR.CAPITAL SUBSCRITO CAPITA -16,00 9.270,12',
  '13/10/2026 PAGAMENTO PIX 22222222222 SOCIO EXEMPLO PIX_DEB -1.005,00 8.265,12',
  '15/10/2026 PAGAMENTO PIX 33333333333 PESSOA TRES PIX_DEB -7.000,00 1.265,12',
  '20/10/2026 LIQUIDACAO BOLETO 11222333000144 FORNECEDOR -625,00 640,12',
  '20/10/2026 DEBITO ARRECADACAO 00394460005887 DARFC0385 DARFC0385 -178,31 461,81',
  '20/10/2026 DEBITO ARRECADACAO DAS -558,29 -96,48',
  '23/10/2026 RECEBIMENTO PIX 22222222222 SOCIO EXEMPLO PIX_CRED 650,00 553,52',
  '26/10/2026 CESTA DE RELACIONAMENTO -42,90 510,62',
  '27/10/2026 LIQUIDACAO CONTRATO C21932590 -1.057,48 -546,86',
  'Fone 0800 000 0000',
].join('\n');

test('extrato com crédito sem sinal: créditos entram como entrada e o saldo final fecha com o do banco', () => {
  const r = parsePdfExtract(EXTRATO, new Date('2026-11-02T12:00:00Z'));
  assert.equal(r.entries.length, 14);
  const credits = r.entries.filter((e) => e.amountCents > 0).map((e) => e.amountCents);
  assert.deepEqual(credits, [20000, 930500, 65000]);
  assert.equal(r.entries.reduce((s, e) => s + e.amountCents, 0), -54686 - 83, 'soma = saldo final - saldo anterior');
  assert.equal(r.check?.ok, true);
  assert.deepEqual(r.check?.endBalance, { cents: -54686, on: '2026-10-27' });
});

test('extrato sem corrente de saldo continua lendo como antes (sem inventar sinal)', () => {
  const r = parsePdfExtract(['Data Descrição Valor (R$)', '05/10/2026 COMPRA MERCADO -45,90', '06/10/2026 SALARIO RECEBIDO 1.000,00'].join('\n'), new Date('2026-11-02T12:00:00Z'));
  assert.deepEqual(r.entries.map((e) => e.amountCents), [-4590, 100000]);
});
