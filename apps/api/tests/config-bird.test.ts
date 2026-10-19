import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.ts';

const base = { NODE_ENV: 'test', BIRD_API_KEY: 'bk_0123456789012345678901', BIRD_WHATSAPP_FROM: '+5511913792370' };

test('Bird: variáveis vazias (como o docker-compose entrega) caem nos padrões, sem endereço em branco', () => {
  const c = loadConfig({ ...base, BIRD_BASE_URL: '', BIRD_TEMPLATE_LANGUAGE: '  ' });
  assert.equal(c.bird?.baseUrl, 'https://us1.platform.bird.com', 'chave sem região reconhecida usa o endereço dos EUA');
  assert.equal(loadConfig({ ...base, BIRD_API_KEY: 'bk_us1_0123456789012345678901', BIRD_BASE_URL: '' }).bird?.baseUrl, 'https://us1.platform.bird.com');
  assert.equal(c.bird?.language, 'pt-BR');
  assert.equal(loadConfig({ ...base, BIRD_API_KEY: 'bk_eu1_0123456789012345678901', BIRD_BASE_URL: '' }).bird?.baseUrl, 'https://eu1.platform.bird.com');
});

test('Bird: chave que não começa com bk_ é da plataforma clássica (api.bird.com, workspace e canal do Fôlego)', () => {
  const c = loadConfig({ ...base, BIRD_API_KEY: 'GZ0123456789abcdefghijklmnop', BIRD_BASE_URL: '' });
  assert.equal(c.bird?.classic, true);
  assert.equal(c.bird?.baseUrl, 'https://api.bird.com');
  assert.equal(c.bird?.workspaceId, '55788597-4cb1-494a-b5fe-ee8fbc4e08a3');
  assert.equal(c.bird?.channelId, '83640587-85a2-54c5-b047-7bfab72d26ad');
  assert.equal(loadConfig(base).bird?.classic, false, 'chave bk_ segue na plataforma nova');
});

test('Bird: endereço informado é respeitado (sem barra no fim)', () => {
  assert.equal(loadConfig({ ...base, BIRD_BASE_URL: 'https://api.exemplo.test/' }).bird?.baseUrl, 'https://api.exemplo.test');
});
