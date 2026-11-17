// Estado de tela guardado enquanto a sessão estiver ativa (filtros, página e aba do /gestao e do /parceiro).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const handlers = { pagehide: [] };
globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
globalThis.window = { setTimeout, clearTimeout, addEventListener: (ev, fn) => { (handlers[ev] ??= []).push(fn); } };
globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };

const { persistentState, clearPersistentState } = await import('../assets/js/ui-state.js');
const flush = () => handlers.pagehide.forEach((fn) => fn()); // ao recarregar/sair da página tudo é gravado na hora

beforeEach(() => { store.clear(); handlers.pagehide.length = 0; });

test('guarda filtro, página e aba e devolve tudo na próxima abertura', () => {
  const a = persistentState('folego:teste', { days: 30 });
  a.days = 90;
  a.clientes = { tab: 'assinantes', filtro: 'pagaram', q: 'abc', page: 2 };
  a.clientes.page = 3; // mudança dentro de um bloco aninhado também grava
  flush();
  const b = persistentState('folego:teste', { days: 30 });
  assert.equal(b.days, 90);
  assert.deepEqual({ ...b.clientes }, { tab: 'assinantes', filtro: 'pagaram', q: 'abc', page: 3 });
});

test('campos temporários (como o celular de um contato) nunca ficam guardados', () => {
  const a = persistentState('folego:teste', { days: 30 }, { transient: ['waStart'] });
  a.waStart = { phone: '34998375296' };
  a.days = 7;
  flush();
  assert.ok(!store.get('folego:teste').includes('34998375296'));
  const b = persistentState('folego:teste', { days: 30 }, { transient: ['waStart'] });
  assert.equal(b.days, 7);
  assert.equal(b.waStart, undefined);
});

test('valor guardado de outro tipo ou conteúdo quebrado é ignorado (a tela nunca quebra)', () => {
  store.set('folego:teste', JSON.stringify({ days: 'muitos', outro: 5 }));
  assert.equal(persistentState('folego:teste', { days: 30 }).days, 30);
  store.set('folego:teste', '{não é json');
  assert.equal(persistentState('folego:teste', { days: 30 }).days, 30);
});

test('limpar esquece tudo (sair da conta ou sessão encerrada)', () => {
  const a = persistentState('folego:teste', { days: 30 });
  a.days = 365;
  flush();
  clearPersistentState('folego:teste');
  assert.equal(persistentState('folego:teste', { days: 30 }).days, 30);
});

test('um bloco recém-criado e alterado direto (sem passar pelo estado) também é gravado ao sair da página', () => {
  const a = persistentState('folego:teste', { days: 30 });
  const bloco = a.parcerias ?? (a.parcerias = { filtro: 'nao_enviados', page: 0 }); // a tela recebe o objeto cru na primeira vez
  bloco.filtro = 'enviados';
  bloco.page = 4;
  flush();
  const b = persistentState('folego:teste', { days: 30 });
  assert.deepEqual({ ...b.parcerias }, { filtro: 'enviados', page: 4 });
});
