import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.ts';

const base = { NODE_ENV: 'test', BIRD_API_KEY: 'bk_0123456789012345678901', BIRD_WHATSAPP_FROM: '+5511913792370' };

test('Bird: variáveis vazias (como o docker-compose entrega) caem nos padrões, sem endereço em branco', () => {
  const c = loadConfig({ ...base, BIRD_BASE_URL: '', BIRD_TEMPLATE_LANGUAGE: '  ' });
  assert.equal(c.bird?.baseUrl, 'https://platform.bird.com');
  assert.equal(c.bird?.language, 'pt-BR');
  assert.equal(loadConfig({ ...base, BIRD_API_KEY: 'bk_eu1_0123456789012345678901', BIRD_BASE_URL: '' }).bird?.baseUrl, 'https://eu1.platform.bird.com');
});

test('Bird: endereço informado é respeitado (sem barra no fim)', () => {
  assert.equal(loadConfig({ ...base, BIRD_BASE_URL: 'https://api.exemplo.test/' }).bird?.baseUrl, 'https://api.exemplo.test');
});
