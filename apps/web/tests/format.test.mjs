import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldToCents, maskMoneyLive, centsToField } from '../assets/js/format.js';

// QA F-01: quem digita "1700" quer R$ 1.700,00, não R$ 17,00.
test('número sem vírgula é em reais', () => {
  assert.equal(fieldToCents('1700'), 170000);
  assert.equal(fieldToCents('5000'), 500000);
  assert.equal(fieldToCents('0'), 0);
  assert.equal(fieldToCents('1.700'), 170000);
  assert.equal(fieldToCents('3200'), 320000);
});

test('com vírgula, vêm os centavos', () => {
  assert.equal(fieldToCents('1700,5'), 170050);
  assert.equal(fieldToCents('1.700,50'), 170050);
  assert.equal(fieldToCents('1700,'), 170000);
  assert.equal(fieldToCents('0,99'), 99);
  assert.equal(fieldToCents('12,345'), 1234); // só 2 casas
});

test('ponto como decimal (15.5) e milhar (1.500)', () => {
  assert.equal(fieldToCents('15.5'), 1550);
  assert.equal(fieldToCents('1.500'), 150000);
  assert.equal(fieldToCents('1.234.567'), 123456700);
});

test('vazio e lixo viram null; teto de 9 dígitos de reais', () => {
  assert.equal(fieldToCents(''), null);
  assert.equal(fieldToCents('abc'), null);
  assert.equal(fieldToCents('99999999999999'), 99999999900);
});

test('máscara ao vivo preserva o que está sendo digitado', () => {
  assert.equal(maskMoneyLive('1700'), '1.700');
  assert.equal(maskMoneyLive('1700,'), '1.700,');
  assert.equal(maskMoneyLive('1700,5'), '1.700,5');
  assert.equal(maskMoneyLive('1700,567'), '1.700,56');
  assert.equal(maskMoneyLive(',5'), '0,5');
  assert.equal(maskMoneyLive('007'), '7');
  assert.equal(maskMoneyLive('abc'), '');
});

test('idempotência: fechar o campo mantém o valor', () => {
  for (const c of [0, 99, 170000, 170050, 123456789]) assert.equal(fieldToCents(centsToField(c)), c);
});
