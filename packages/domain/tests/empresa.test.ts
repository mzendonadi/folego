// Empresa (PJ): regras dos movimentos com o sócio, leitura do texto e limites por plano. Dados inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIZ_MOVEMENTS, businessLimits, categorizeBiz, detectBizMovement, looksLikeCompany, movementRule, planHas } from '../src/index.ts';

test('planos: Ousado tem a empresa básica; Desbravador tem a completa; Controle não tem', () => {
  assert.equal(planHas('controle', 'business'), false);
  assert.equal(planHas('ousado', 'business'), true);
  assert.equal(planHas('ousado', 'business_pro'), false);
  assert.equal(planHas('desbravador', 'business'), true);
  assert.equal(planHas('desbravador', 'business_pro'), true);
  assert.deepEqual(businessLimits(false), { wallets: 1, cards: 1 });
  assert.ok(businessLimits(true).wallets >= 10 && businessLimits(true).cards >= 10);
});

test('movimentos: pró-labore e lucros são renda de quem recebe; aporte e retirada são só transferência', () => {
  for (const m of BIZ_MOVEMENTS) {
    const r = movementRule(m);
    assert.equal(r.bizSign, -r.pfSign, `${m}: o que sai de um lado entra do outro`);
  }
  assert.deepEqual(['pro_labore', 'lucros'].map((m) => movementRule(m as 'pro_labore' | 'lucros').pfIsIncome), [true, true]);
  assert.deepEqual(['aporte', 'retirada'].map((m) => movementRule(m as 'aporte' | 'retirada').pfIsIncome), [false, false]);
  assert.equal(movementRule('aporte').pfSign, -1, 'aporte sai do bolso do sócio');
  assert.equal(movementRule('retirada').pfSign, 1, 'retirada entra no bolso do sócio');
});

test('texto: reconhece pró-labore, lucros, aporte e retirada; nome de empresa só sugere', () => {
  assert.equal(detectBizMovement('Pró-labore Minha Empresa'), 'pro_labore');
  assert.equal(detectBizMovement('PRO LABORE'), 'pro_labore');
  assert.equal(detectBizMovement('Distribuição de lucros out/26'), 'lucros');
  assert.equal(detectBizMovement('Aporte na empresa'), 'aporte');
  assert.equal(detectBizMovement('Empréstimo do sócio'), 'aporte');
  assert.equal(detectBizMovement('Retirada do sócio'), 'retirada');
  assert.equal(detectBizMovement('Mercado do bairro'), null);
  assert.equal(looksLikeCompany('PIX Servicos Exemplo LTDA'), true);
  assert.equal(looksLikeCompany('Padaria da Maria'), false);
});

test('categoria da empresa: entrada vira receita; o texto reconhece imposto, anúncio, software e o resto vira outros', () => {
  assert.equal(categorizeBiz('Qualquer coisa', 100_000), 'receita');
  assert.equal(categorizeBiz('DAS Simples Nacional', -40_000), 'impostos');
  assert.equal(categorizeBiz('GOOGLE *ADS2202 (500,00 EURO)', -331_443), 'marketing');
  assert.equal(categorizeBiz('Assinatura Notion', -5_000), 'software');
  assert.equal(categorizeBiz('Aluguel do coworking', -150_000), 'aluguel');
  assert.equal(categorizeBiz('Pró-labore', -300_000), 'pro_labore');
  assert.equal(categorizeBiz('Coisa sem pista', -1_000), 'outros');
});
