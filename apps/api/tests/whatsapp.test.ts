// WhatsApp do portal do parceiro: webhook assinado, janela de 24 h, permissão (opt-in), saída por "SAIR", modelos, disparo, teto, agente de IA (gancho) e isolamento.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { processWhatsAppQueue, inQuietHours, isOptOut, waPhone, phoneKey, renderTemplate, templateSlots, validSignature, WaError } from '../src/whatsapp.ts';
import type { SalesAgent, WaTransport } from '../src/whatsapp.ts';

const ADMIN = 'token-do-administrador-com-32-caracteres!';
const APP_SECRET = 'segredo-do-app-da-meta-123456';
let db: Db;
let app: FastifyInstance;
let appAi: FastifyInstance;
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', leadsEnabled: true, partnerAdminToken: ADMIN };

const sent: { kind: string; to: string; text?: string; name?: string; params?: string[] }[] = [];
let failNext: WaError | null = null;
let counter = 0;
const fake: WaTransport = {
  async sendText(_c, to, text) {
    if (failNext) { const e = failNext; failNext = null; throw e; }
    sent.push({ kind: 'text', to, text });
    return { id: `wamid.${(counter += 1)}` };
  },
  async sendTemplate(_c, to, tpl) {
    sent.push({ kind: 'template', to, name: tpl.name, params: tpl.params });
    return { id: `wamid.${(counter += 1)}` };
  },
  async profile() { return { displayPhone: '+55 41 99999-0000', verifiedName: 'Euro Teste' }; },
};
const agent: SalesAgent = {
  name: 'teste',
  async reply(input) { return { text: `Olá ${input.contact.name ?? ''}, posso ajudar com o consignado.`, handoff: false }; },
};

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  await db.query(`DELETE FROM app.partner_campaigns`);
  await db.query(`DELETE FROM app.partner_users`);
  await db.query(`DELETE FROM app.partners`);
  app = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), whatsapp: fake, rateLimits: 'relaxed' });
  appAi = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), whatsapp: fake, salesAgent: agent, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await appAi.close();
  await db.close();
});

async function call(server: FastifyInstance, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
  const res = await server.inject({ method, url, headers: { 'x-folego': '1', ...(opts.body !== undefined || opts.raw !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers }, payload: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
  let json: any = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
  return { status: res.statusCode, json, text: res.body };
}

async function newPartner(email: string, cnpj: string) {
  const c = await call(app, 'POST', '/api/admin/partners', { headers: { 'x-admin-token': ADMIN }, body: { legalName: `Parceiro ${email}`, cnpj, category: 'consignado', email, campaign: { name: 'Campanha portal', consentCategory: 'consignado', pricePerLeadCents: 0, dailyCap: 20 } } });
  assert.equal(c.status, 201);
  const l = await call(app, 'POST', '/api/partner/login', { body: { email, password: c.json.password } });
  return { id: c.json.partnerId as string, auth: { authorization: `Bearer ${l.json.token}` } };
}

const inbound = (phoneNumberId: string, from: string, text: string, id: string, name = 'Maria Souza') => ({
  entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, contacts: [{ profile: { name } }], messages: [{ id, from, type: 'text', text: { body: text } }] } }] }],
});
const statusEvent = (phoneNumberId: string, waId: string, status: string) => ({ entry: [{ changes: [{ value: { metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: waId, status }] } }] }] });
const hook = (server: FastifyInstance, partnerId: string, body: unknown, secret = APP_SECRET) => {
  const raw = JSON.stringify(body);
  return call(server, 'POST', `/webhooks/whatsapp/${partnerId}`, { raw, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` } });
};
const work = () => processWhatsAppQueue({ db, config, gateway: new FakeGateway('x'), whatsapp: fake });

let P: { id: string; auth: { authorization: string } };
let verifyToken = '';
const NUM = '1099887766';

test('funções puras: telefone, janela, silêncio, saída, modelos e assinatura', () => {
  assert.equal(waPhone('(41) 99999-0000'), '5541999990000');
  assert.equal(waPhone('+55 41 3333-4444'), '554133334444');
  assert.equal(waPhone('123'), null);
  const secret = 's';
  assert.equal(phoneKey(secret, 'p', '5541999990000'), phoneKey(secret, 'p', '554199990000'), 'com ou sem o 9 é a mesma pessoa');
  assert.notEqual(phoneKey(secret, 'p', '5541999990000'), phoneKey(secret, 'q', '5541999990000'), 'a chave é por parceiro');
  assert.equal(inQuietHours(22, 20, 8), true);
  assert.equal(inQuietHours(7, 20, 8), true);
  assert.equal(inQuietHours(12, 20, 8), false);
  assert.equal(inQuietHours(12, 9, 9), false);
  for (const w of ['SAIR', 'sair', 'Parar', 'não quero mais', 'NAO QUERO', 'stop']) assert.ok(isOptOut(w), w);
  for (const w of ['quero saber mais', 'sim', 'pode sair do prazo?', 'oi']) assert.ok(!isOptOut(w), w);
  assert.equal(renderTemplate('Olá {{1}}, sua margem é {{2}}.', ['Ana', 'R$ 1.500']), 'Olá Ana, sua margem é R$ 1.500.');
  assert.equal(templateSlots('Olá {{1}} e {{3}}'), 3);
  assert.equal(validSignature('k', '{"a":1}', `sha256=${createHmac('sha256', 'k').update('{"a":1}').digest('hex')}`), true);
  assert.equal(validSignature('k', '{"a":2}', `sha256=${createHmac('sha256', 'k').update('{"a":1}').digest('hex')}`), false);
  assert.equal(validSignature('k', 'x', undefined), false);
});

test('conexão: salva credenciais criptografadas, não devolve segredos, confere com a Meta e valida o webhook', async () => {
  P = await newPartner('wa@parceiro.test', '11222333000181');
  assert.equal((await call(app, 'GET', '/api/partner/wa/account', { headers: P.auth })).json.connected, false);
  assert.equal((await call(app, 'PUT', '/api/partner/wa/account', { headers: P.auth, body: { phoneNumberId: NUM } })).status, 422, 'falta token e segredo');
  const saved = await call(app, 'PUT', '/api/partner/wa/account', { headers: P.auth, body: { phoneNumberId: NUM, token: 'EAAG-token-permanente-de-teste-1234567890', appSecret: APP_SECRET, quietStart: 0, quietEnd: 0, dailyCap: 3 } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.connected, true);
  assert.ok(!JSON.stringify(saved.json).includes('EAAG'), 'o token nunca volta para a tela');
  assert.ok(!JSON.stringify(saved.json).includes(APP_SECRET));
  verifyToken = saved.json.verifyToken;
  assert.match(saved.json.webhookUrl, new RegExp(`/webhooks/whatsapp/${P.id}$`));
  const raw = await db.query<{ token_enc: Buffer }>(`SELECT token_enc FROM app.wa_accounts WHERE partner_id = $1`, [P.id]);
  assert.ok(!raw.rows[0]!.token_enc.toString('utf8').includes('EAAG'));
  const conf = await call(app, 'POST', '/api/partner/wa/account/test', { headers: P.auth });
  assert.equal(conf.json.verifiedName, 'Euro Teste');

  // verificação do webhook (GET da Meta)
  const ok = await call(app, 'GET', `/webhooks/whatsapp/${P.id}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=12345`);
  assert.equal(ok.status, 200);
  assert.equal(ok.text, '12345');
  assert.equal((await call(app, 'GET', `/webhooks/whatsapp/${P.id}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`)).status, 403);

  // outro parceiro não pode usar o mesmo número
  const other = await newPartner('wa2@parceiro.test', '11444777000161');
  const dup = await call(app, 'PUT', '/api/partner/wa/account', { headers: other.auth, body: { phoneNumberId: NUM, token: 'EAAG-outro-token-de-teste-1234567890', appSecret: 'outro-segredo-123456789' } });
  assert.equal(dup.status, 409);
});

test('recebimento: webhook sem assinatura válida é recusado; mensagem vira conversa, não duplica e liga ao contato da base', async () => {
  // contato da base com telefone: a conversa deve se ligar a ele
  const imp = await call(app, 'POST', '/api/partner/imports', { headers: P.auth, body: { filename: 'x.xlsx', layout: 'cabecalho', total: 1, waOptin: false } });
  const cpf = '52998224725';
  await call(app, 'POST', `/api/partner/imports/${imp.json.importId}/rows`, { headers: P.auth, body: { rows: [{ cpf, name: 'MARIA SOUZA', phones: ['41999990000'], emails: [], address: {}, bank: {}, extra: {} }] } });
  await call(app, 'POST', `/api/partner/imports/${imp.json.importId}/finish`, { headers: P.auth, body: {} });
  const before = (await call(app, 'GET', `/api/partner/contacts?q=${cpf}`, { headers: P.auth })).json.items[0];
  assert.equal((await call(app, 'GET', `/api/partner/contacts/${before.id}`, { headers: P.auth })).json.waOptin, 'desconhecido');

  const body = inbound(NUM, '554199990000', 'Oi, quero saber do consignado', 'wamid.IN1'); // sem o 9: mesma pessoa
  assert.equal((await hook(app, P.id, body, 'segredo-errado')).status, 401);
  assert.equal((await call(app, 'POST', `/webhooks/whatsapp/${P.id}`, { raw: JSON.stringify(body) })).status, 401, 'sem assinatura');
  assert.equal((await hook(app, P.id, body)).status, 200);
  assert.equal((await hook(app, P.id, body)).status, 200, 'a Meta reenvia: não duplica');

  const list = await call(app, 'GET', '/api/partner/wa/threads', { headers: P.auth });
  assert.equal(list.json.items.length, 1);
  assert.equal(list.json.unread, 1);
  const t = list.json.items[0];
  assert.equal(t.name, 'Maria Souza');
  assert.equal(t.origin, 'base');
  assert.equal(t.windowOpen, true);
  const detail = await call(app, 'GET', `/api/partner/wa/threads/${t.id}`, { headers: P.auth });
  assert.equal(detail.json.messages.length, 1);
  assert.equal(detail.json.messages[0].text, 'Oi, quero saber do consignado');
  assert.equal(detail.json.waOptin, 'sim', 'quem escreve primeiro permitiu a conversa');
  assert.equal((await call(app, 'GET', '/api/partner/wa/threads', { headers: P.auth })).json.unread, 0, 'abrir a conversa marca como lida');
  // o texto não fica em claro no banco
  const raw = await db.query<{ body_enc: Buffer }>(`SELECT body_enc FROM app.wa_messages LIMIT 1`);
  assert.ok(!raw.rows[0]!.body_enc.toString('utf8').includes('consignado'));
});

test('atendimento: texto dentro da janela de 24 h sai; fora dela, só modelo aprovado; status da Meta avança', async () => {
  const t = (await call(app, 'GET', '/api/partner/wa/threads', { headers: P.auth })).json.items[0];
  const r = await call(app, 'POST', `/api/partner/wa/threads/${t.id}/messages`, { headers: P.auth, body: { text: 'Olá, Maria! Vou simular para você.' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(sent.at(-1), { kind: 'text', to: '554199990000', text: 'Olá, Maria! Vou simular para você.' });
  const wa = await db.query<{ wa_id: string }>(`SELECT wa_id FROM app.wa_messages WHERE direction = 'out' AND kind = 'text' ORDER BY created_at DESC LIMIT 1`);
  await hook(app, P.id, statusEvent(NUM, wa.rows[0]!.wa_id, 'read'));
  await hook(app, P.id, statusEvent(NUM, wa.rows[0]!.wa_id, 'delivered')); // chegou fora de ordem: não volta atrás
  const d = await call(app, 'GET', `/api/partner/wa/threads/${t.id}`, { headers: P.auth });
  assert.equal(d.json.messages.at(-1).status, 'lida');

  // fecha a janela (última mensagem do contato há 25 h)
  await db.query(`UPDATE app.wa_threads SET last_inbound_at = now() - interval '25 hours' WHERE id = $1`, [t.id]);
  const closed = await call(app, 'POST', `/api/partner/wa/threads/${t.id}/messages`, { headers: P.auth, body: { text: 'Ainda aí?' } });
  assert.equal(closed.status, 409);
  assert.equal(closed.json.error, 'window_closed');

  // modelo: precisa ser aprovado pela Meta
  const tpl = await call(app, 'POST', '/api/partner/wa/templates', { headers: P.auth, body: { name: 'retorno_consignado', category: 'MARKETING', body: 'Olá {{1}}, aqui é da Euro Multiplan. Posso simular seu consignado?' } });
  assert.equal(tpl.status, 201);
  assert.equal((await call(app, 'POST', '/api/partner/wa/templates', { headers: P.auth, body: { name: 'retorno_consignado', category: 'MARKETING', body: 'repetido aqui' } })).status, 409);
  assert.equal((await call(app, 'POST', '/api/partner/wa/templates', { headers: P.auth, body: { name: 'Nome Ruim', category: 'MARKETING', body: 'texto qualquer' } })).status, 400);
  const notYet = await call(app, 'POST', `/api/partner/wa/threads/${t.id}/messages`, { headers: P.auth, body: { templateId: tpl.json.id, vars: ['Maria'] } });
  assert.equal(notYet.json.error, 'template_not_approved');
  await call(app, 'PATCH', `/api/partner/wa/templates/${tpl.json.id}`, { headers: P.auth, body: { status: 'aprovado' } });
  assert.equal((await call(app, 'POST', `/api/partner/wa/threads/${t.id}/messages`, { headers: P.auth, body: { templateId: tpl.json.id, vars: [] } })).json.error, 'missing_vars');
  assert.equal((await call(app, 'POST', `/api/partner/wa/threads/${t.id}/messages`, { headers: P.auth, body: { templateId: tpl.json.id, vars: ['Maria'] } })).status, 200);
  assert.deepEqual(sent.at(-1), { kind: 'template', to: '554199990000', name: 'retorno_consignado', params: ['Maria'] });
});

test('saída: "SAIR" encerra os envios, confirma e bloqueia modelo e texto', async () => {
  const t = (await call(app, 'GET', '/api/partner/wa/threads', { headers: P.auth })).json.items[0];
  await hook(app, P.id, inbound(NUM, '554199990000', 'SAIR', 'wamid.IN2'));
  await work();
  assert.match(sent.at(-1)!.text ?? '', /não receberá mais mensagens/);
  const d = await call(app, 'GET', `/api/partner/wa/threads/${t.id}`, { headers: P.auth });
  assert.equal(d.json.optedOut, true);
  assert.equal(d.json.waOptin, 'nao');
  assert.equal((await call(app, 'POST', `/api/partner/wa/threads/${t.id}/messages`, { headers: P.auth, body: { text: 'Volta!' } })).json.error, 'opted_out');
  const tpl = (await call(app, 'GET', '/api/partner/wa/templates', { headers: P.auth })).json.templates[0];
  assert.equal((await call(app, 'POST', `/api/partner/wa/threads/${t.id}/messages`, { headers: P.auth, body: { templateId: tpl.id, vars: ['Maria'] } })).json.error, 'opted_out');
});

test('disparo: só quem tem permissão, respeita o teto diário, não insiste e dá para cancelar; falha permanente não repete', async () => {
  const tpl = (await call(app, 'GET', '/api/partner/wa/templates', { headers: P.auth })).json.templates[0];
  const cpfs = ['11144477735', '39053344705', '16899535009', '11122233396', '45317828791'];
  const imp = await call(app, 'POST', '/api/partner/imports', { headers: P.auth, body: { filename: 'optin.xlsx', layout: 'cabecalho', total: 5, waOptin: true } });
  const rows = cpfs.map((cpf, i) => ({ cpf, name: `CLIENTE NUMERO ${i}`, phones: [`4198800000${i}`], emails: [], availableMarginCents: 100000 + i, address: {}, bank: {}, extra: {} }));
  await call(app, 'POST', `/api/partner/imports/${imp.json.importId}/rows`, { headers: P.auth, body: { rows } });
  await call(app, 'POST', `/api/partner/imports/${imp.json.importId}/finish`, { headers: P.auth, body: {} });
  // um sem permissão (importado sem declarar autorização)
  const imp2 = await call(app, 'POST', '/api/partner/imports', { headers: P.auth, body: { filename: 'sem.xlsx', layout: 'cabecalho', total: 1 } });
  await call(app, 'POST', `/api/partner/imports/${imp2.json.importId}/rows`, { headers: P.auth, body: { rows: [{ cpf: '71428793860', name: 'SEM PERMISSAO', phones: ['41977770000'], emails: [], address: {}, bank: {}, extra: {} }] } });
  await call(app, 'POST', `/api/partner/imports/${imp2.json.importId}/finish`, { headers: P.auth, body: {} });

  const form = { name: 'Retorno de outubro', templateId: tpl.id, vars: ['{nome}'], source: 'base', filter: {} };
  const prev = await call(app, 'POST', '/api/partner/wa/broadcasts/preview', { headers: P.auth, body: form });
  assert.equal(prev.json.eligible, 5, 'a pessoa que disse SAIR e a sem permissão ficam de fora');
  assert.ok(prev.json.withoutPermission >= 1);
  sent.length = 0;
  const made = await call(app, 'POST', '/api/partner/wa/broadcasts', { headers: P.auth, body: form });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.json.queued, 5);
  assert.equal(await work(), 2, 'teto diário de 3 modelos, 1 já usado hoje no atendimento');
  assert.equal(sent.filter((s) => s.kind === 'template').length, 2);
  assert.deepEqual(sent.map((s) => s.params?.[0]).sort(), ['Cliente', 'Cliente']);
  assert.equal(await work(), 0, 'no mesmo dia o resto espera');
  const again = await call(app, 'POST', '/api/partner/wa/broadcasts', { headers: P.auth, body: { ...form, name: 'De novo' } });
  assert.equal(again.status, 201);
  assert.equal(again.json.queued, 0, 'quem já tem modelo enviado ou na fila nos últimos 3 dias não recebe de novo');
  const list = (await call(app, 'GET', '/api/partner/wa/broadcasts', { headers: P.auth })).json.broadcasts.find((b: any) => b.id === made.json.id);
  assert.equal(list.sent + list.delivered + list.read, 2);
  assert.equal(list.queue, 3);
  assert.equal((await call(app, 'POST', `/api/partner/wa/broadcasts/${made.json.id}/cancel`, { headers: P.auth, body: {} })).json.canceled, 3);

  // falha permanente (ex.: número sem WhatsApp) não fica repetindo
  failNext = new WaError('Número sem WhatsApp', 400, 131026);
  const t = (await call(app, 'GET', '/api/partner/wa/threads?q=cliente', { headers: P.auth })).json.items[0];
  await db.query(`UPDATE app.wa_threads SET last_inbound_at = now() WHERE id = $1`, [t.id]);
  await call(app, 'POST', `/api/partner/wa/threads/${t.id}/messages`, { headers: P.auth, body: { text: 'teste de falha' } });
  const last = await call(app, 'GET', `/api/partner/wa/threads/${t.id}`, { headers: P.auth });
  assert.equal(last.json.messages.at(-1).status, 'falhou');
  assert.match(last.json.messages.at(-1).error, /sem WhatsApp/);
});

test('começar conversa: pelo contato da base, com modelo, só com permissão', async () => {
  const sem = (await call(app, 'GET', '/api/partner/contacts?q=SEM%20PERMISSAO', { headers: P.auth })).json.items[0];
  const tpl = (await call(app, 'GET', '/api/partner/wa/templates', { headers: P.auth })).json.templates[0];
  const bloqueado = await call(app, 'POST', '/api/partner/wa/start', { headers: P.auth, body: { contactId: sem.id, templateId: tpl.id, vars: ['{nome}'] } });
  assert.equal(bloqueado.json.error, 'no_optin');
  await call(app, 'PATCH', `/api/partner/contacts/${sem.id}`, { headers: P.auth, body: { waOptin: 'sim' } });
  sent.length = 0;
  await db.query(`UPDATE app.wa_accounts SET daily_cap = 50 WHERE partner_id = $1`, [P.id]);
  const ok = await call(app, 'POST', '/api/partner/wa/start', { headers: P.auth, body: { contactId: sem.id, templateId: tpl.id, vars: ['{nome}'] } });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(sent.at(-1), { kind: 'template', to: '5541977770000', name: 'retorno_consignado', params: ['Sem'] });
});

test('isolamento: outro parceiro não vê conversas, modelos nem dados do primeiro; sem conexão avisa', async () => {
  const other = await newPartner('wa3@parceiro.test', '11555666000102');
  assert.equal((await call(app, 'GET', '/api/partner/wa/threads', { headers: other.auth })).json.items.length, 0);
  assert.equal((await call(app, 'GET', '/api/partner/wa/templates', { headers: other.auth })).json.templates.length, 0);
  const t = (await call(app, 'GET', '/api/partner/wa/threads', { headers: P.auth })).json.items[0];
  assert.equal((await call(app, 'GET', `/api/partner/wa/threads/${t.id}`, { headers: other.auth })).status, 404);
  assert.equal((await call(app, 'POST', `/api/partner/wa/threads/${t.id}/messages`, { headers: other.auth, body: { text: 'oi' } })).json.error, 'wa_not_connected');
  assert.equal((await call(app, 'GET', '/api/partner/wa/threads')).status, 401);
  assert.equal((await call(app, 'POST', `/webhooks/whatsapp/${other.id}`, { raw: '{}', headers: { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` } })).status, 404, 'sem conta conectada');
});

test('agente de IA (gancho): desligado por padrão, só liga quando instalado; responde com aviso, passa para humano e tem limite', async () => {
  // sem agente instalado neste servidor
  assert.equal((await call(app, 'PUT', '/api/partner/wa/agent', { headers: P.auth, body: { enabled: true } })).json.error, 'agent_unavailable');
  assert.equal((await call(app, 'GET', '/api/partner/wa/account', { headers: P.auth })).json.agentAvailable, false);

  // servidor com agente instalado
  assert.equal((await call(appAi, 'PUT', '/api/partner/wa/agent', { headers: P.auth, body: { enabled: true, maxRepliesPerHour: 2, disclosure: 'Sou o assistente virtual da Euro.' } })).status, 200);
  const newNum = '5541966660000';
  await hook(appAi, P.id, inbound(NUM, newNum, 'Oi', 'wamid.AI0', 'Joana'));
  const t = (await call(appAi, 'GET', '/api/partner/wa/threads?q=joana', { headers: P.auth })).json.items[0];
  assert.equal(t.mode, 'humano', 'a conversa só vai para a IA se a pessoa mandar');
  assert.equal((await call(appAi, 'PATCH', `/api/partner/wa/threads/${t.id}`, { headers: P.auth, body: { mode: 'ia' } })).status, 200);
  sent.length = 0;
  await hook(appAi, P.id, inbound(NUM, newNum, 'Quero um consignado de 20 mil', 'wamid.AI1', 'Joana'));
  await processWhatsAppQueue({ db, config, gateway: new FakeGateway('x'), whatsapp: fake, salesAgent: agent });
  assert.equal(sent.length, 1);
  assert.match(sent[0]!.text!, /^Sou o assistente virtual da Euro\.\n\nOlá Joana/);
  await hook(appAi, P.id, inbound(NUM, newNum, 'E o prazo?', 'wamid.AI2', 'Joana'));
  await processWhatsAppQueue({ db, config, gateway: new FakeGateway('x'), whatsapp: fake, salesAgent: agent });
  assert.equal(sent.length, 2);
  assert.ok(!sent[1]!.text!.startsWith('Sou o assistente'), 'o aviso vai só na primeira resposta');
  // terceira em menos de 1 h: passa para uma pessoa
  await hook(appAi, P.id, inbound(NUM, newNum, 'Pode ser 84 meses?', 'wamid.AI3', 'Joana'));
  assert.equal((await call(appAi, 'GET', `/api/partner/wa/threads/${t.id}`, { headers: P.auth })).json.mode, 'humano');
  // palavra de passagem
  await call(appAi, 'PATCH', `/api/partner/wa/threads/${t.id}`, { headers: P.auth, body: { mode: 'ia' } });
  await hook(appAi, P.id, inbound(NUM, newNum, 'quero falar com um atendente', 'wamid.AI4', 'Joana'));
  assert.equal((await call(appAi, 'GET', `/api/partner/wa/threads/${t.id}`, { headers: P.auth })).json.mode, 'humano');
  // quando uma pessoa responde, a IA sai
  await call(appAi, 'PATCH', `/api/partner/wa/threads/${t.id}`, { headers: P.auth, body: { mode: 'ia' } });
  await call(appAi, 'POST', `/api/partner/wa/threads/${t.id}/messages`, { headers: P.auth, body: { text: 'Aqui é a Julhana, vou assumir.' } });
  assert.equal((await call(appAi, 'GET', `/api/partner/wa/threads/${t.id}`, { headers: P.auth })).json.mode, 'humano');
});
