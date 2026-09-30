import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessPrescription } from '../src/prescription.ts';
import { resolveDebt } from '../src/rates.ts';
import { RULES } from '../src/config.ts';
import { AS_OF, debt } from './helpers.ts';

const assess = (partial: Parameters<typeof debt>[0]) => assessPrescription(resolveDebt(debt(partial), RULES), AS_OF, RULES);

test('mais de 5 anos desde o primeiro atraso: possível prescrição', () => {
  assert.equal(assess({ id: 'a', daysOverdue: 2000, firstDefaultOn: '2020-09-01' }).status, 'possible');
});

test('entre 4 e 5 anos: aproximando', () => {
  assert.equal(assess({ id: 'a', daysOverdue: 1500, firstDefaultOn: '2022-06-01' }).status, 'approaching');
});

test('menos de 4 anos: não prescrita', () => {
  assert.equal(assess({ id: 'a', daysOverdue: 900, firstDefaultOn: '2023-01-01' }).status, 'not_prescribed');
});

test('aluguel usa prazo de 3 anos', () => {
  assert.equal(assess({ id: 'r', kind: 'rent', daysOverdue: 1200, firstDefaultOn: '2023-01-01' }).status, 'possible');
});

test('sem data, usa dias em atraso e marca a origem como derivada', () => {
  const r = assess({ id: 'a', daysOverdue: 400 });
  assert.equal(r.status, 'not_prescribed');
  assert.equal(r.dateSource, 'derived');
});

test('sem atraso e sem data: não está em atraso', () => {
  assert.equal(assess({ id: 'a', daysOverdue: 0 }).status, 'not_in_default');
});
