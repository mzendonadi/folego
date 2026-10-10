// Portal do parceiro (Euro Multiplan & Fôlego): importação de planilhas sem duplicar, contatos do Fôlego, contratos e comissão em %.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { deliverPendingLeads } from '../src/leads.ts';
import { buildXlsx } from '../src/xlsx.ts';
import * as partners from '../src/admin/partners.ts';
import { cleanCpf, planSheet, readXlsx, SIAPE_LAYOUT } from '../src/engine.ts';

const ADMIN = 'token-do-administrador-com-32-caracteres!';
let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
let seeded: { partners: number; leads: unknown; campaign: { commission_bps: number; webhook_url: string | null } | undefined };
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', leadsEnabled: true, partnerAdminToken: ADMIN };
const ctx = () => ({ db, config, gateway });

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  // Antes de limpar: a migração tem de ter cadastrado a Euro, ativa, e ligado os parceiros.
  const p = await db.query(`SELECT 1 FROM app.partners WHERE cnpj = '09242004000150' AND status = 'active'`);
  const l = await db.query<{ value: unknown }>(`SELECT value FROM app.settings WHERE key = 'leadsEnabled'`);
  const c = await db.query<{ commission_bps: number; webhook_url: string | null }>(`SELECT c.commission_bps, c.webhook_url FROM app.partner_campaigns c JOIN app.partners p ON p.id = c.partner_id WHERE p.cnpj = '09242004000150'`);
  seeded = { partners: p.rows.length, leads: l.rows[0]?.value, campaign: c.rows[0] };
  await db.query(`DELETE FROM app.partner_campaigns`);
  await db.query(`DELETE FROM app.partner_users`);
  await db.query(`DELETE FROM app.partners`);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await db.close();
});

function client() {
  let cookie = '';
  return async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.inject({
      method, url,
      headers: { 'x-folego': '1', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...opts.headers },
      payload: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}

async function paidCase(key: string) {
  const c = client();
  const created = await c('POST', '/api/cases', { body: { profile: { netIncomeCents: 450_000, fixedExpensesCents: 180_000, employmentType: 'clt', ageBand: '35-44', uf: 'SP' }, debts: [{ creditorName: 'Cartão X', kind: 'credit_card', balanceCents: 900_000, monthlyPaymentCents: 90_000, daysOverdue: 0 }, { creditorName: 'Loja Y', kind: 'store_credit', balanceCents: 120_000, monthlyPaymentCents: 10_000, daysOverdue: 60 }], acceptTerms: true } });
  const order = await c('POST', '/api/orders', { body: { caseId: created.json.caseId, products: ['recovery_map'] }, headers: { 'idempotency-key': `${key}-order-0001` } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [order.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': config.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
  return { c, caseId: created.json.caseId as string };
}

/** CPF válido a partir de 9 dígitos (calcula os dois verificadores). */
function cpfFrom(base: string): string {
  const dv = (s: string) => {
    let t = 0;
    for (let i = 0; i < s.length; i += 1) t += Number(s[i]) * (s.length + 1 - i);
    const r = (t * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  return `${base}${d1}${dv(`${base}${d1}`)}`;
}

const sheetRows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => {
  const k = from + i;
  return [cpfFrom(String(100000000 + k * 7919).slice(0, 9)), `SERVIDOR TESTE ${k}`, `1970-0${(k % 9) + 1}-15`, 'F', `1199${String(1000000 + k).slice(0, 7)}`, `servidor${k}@exemplo.com`, 'DF', 'ATIVO PERMANENTE', `${1500 + k}.50`];
});
const HEADERS = ['CPF', 'Nome', 'Nascimento', 'Sexo', 'Celular', 'E-mail', 'UF do órgão', 'Situação funcional', 'Margem livre'];

test('migração: Euro Multiplan cadastrada e ativa, campanha só de portal, parceiros ligados', () => {
  assert.equal(seeded.partners, 1);
  assert.equal(seeded.leads, true);
  assert.equal(seeded.campaign?.webhook_url, null);
  assert.equal(seeded.campaign?.commission_bps, 0);
});

test('planilha: lê .xlsx, reconhece o cabeçalho, completa zeros do CPF e descarta repetidos e inválidos', async () => {
  const rows = sheetRows(5);
  const xlsx = buildXlsx([{ name: 'Base', headers: HEADERS, rows: [...rows, rows[0]!, ['123', 'CPF RUIM', '', 'M', '', '', 'RJ', '', '']] }]);
  const plan = planSheet(await readXlsx(xlsx));
  assert.equal(plan.layout, 'cabecalho');
  assert.equal(plan.records.length, 5);
  assert.equal(plan.repeatedInFile, 1);
  assert.equal(plan.invalid.cpf_invalido, 1);
  assert.equal(plan.records[0]!.phones[0], rows[0]![4]);
  assert.equal(plan.records[0]!.availableMarginCents, 150050);
  assert.equal(cleanCpf('1'), null);
  const real = cpfFrom('012345678');
  assert.equal(cleanCpf(String(Number(real))), real, 'o Excel perde o zero à esquerda do CPF');
});

test('planilha da Euro (67 colunas, sem cabeçalho): colunas posicionais viram os campos certos', async () => {
  const cols = Array.from({ length: 67 }, () => '0');
  const put = (letter: string, v: string) => {
    let n = 0;
    for (const ch of letter) n = n * 26 + ch.charCodeAt(0) - 64;
    cols[n - 1] = v;
  };
  put('A', cpfFrom('987654321'));
  put('B', 'FULANO DE TAL'); put('C', '21607'); put('D', '67'); put('E', 'M'); put('F', 'MAE DE TAL');
  put('M', '1486705'); put('O', 'DF'); put('AU', 'APOSENTADO'); put('AV', '2559.43'); put('AD', '1399.02');
  put('AX', 'RUA A'); put('BB', 'MACAPA'); put('BC', 'AP'); put('BD', '68904043'); put('BE', '96992045553'); put('BF', '96988111912'); put('BM', 'fulano@exemplo.com');
  const xlsx = buildXlsx([{ name: 'Rafael', headers: cols, rows: [] }]); // sem linha de dados: o "cabeçalho" é a primeira linha de dados
  const plan = planSheet(await readXlsx(xlsx));
  assert.equal(plan.layout, 'siape');
  const r = plan.records[0]!;
  assert.equal(r.name, 'FULANO DE TAL');
  assert.equal(r.birthDate, '1959-02-26');
  assert.equal(r.availableMarginCents, 255943);
  assert.equal(r.cardMarginCents, 139902);
  assert.equal(r.orgUf, 'DF');
  assert.equal(r.address.city, 'MACAPA');
  assert.equal(r.address.cep, '68904043');
  assert.deepEqual(r.phones, ['96992045553', '96988111912']);
  assert.equal(SIAPE_LAYOUT.availableMarginCents, 'AV');
});

test('portal: importa sem duplicar (mesmo arquivo de novo = nada novo), completa dados e guarda criptografado', async () => {
  const admin = client();
  const created = await admin('POST', '/api/admin/partners', { headers: { 'x-admin-token': ADMIN }, body: { legalName: 'Euro Teste ME', cnpj: '09242004000150', category: 'consignado', email: 'euro@teste.com', tradeName: 'EURO TESTE', campaign: { name: 'Consignado portal', consentCategory: 'consignado', employmentTypes: [], ufs: [], pricePerLeadCents: 0, commissionBps: 1500, dailyCap: 20 } } });
  assert.equal(created.status, 201);
  const login = await admin('POST', '/api/partner/login', { body: { email: 'euro@teste.com', password: created.json.password } });
  assert.equal(login.status, 200);
  assert.equal(login.json.tradeName, 'EURO TESTE');
  const auth = { authorization: `Bearer ${login.json.token}` };
  const rows = planSheet(await readXlsx(buildXlsx([{ name: 'Base', headers: HEADERS, rows: sheetRows(40) }])));

  const run = async (records: unknown[], name: string) => {
    const start = await admin('POST', '/api/partner/imports', { headers: auth, body: { filename: name, layout: 'cabecalho', total: records.length } });
    assert.equal(start.status, 201);
    const b = await admin('POST', `/api/partner/imports/${start.json.importId}/rows`, { headers: auth, body: { rows: records } });
    assert.equal(b.status, 200, JSON.stringify(b.json));
    const fin = await admin('POST', `/api/partner/imports/${start.json.importId}/finish`, { headers: auth, body: {} });
    return { b: b.json, fin: fin.json };
  };
  const first = await run(rows.records, 'base.xlsx');
  assert.deepEqual(first.b, { created: 40, updated: 0, same: 0, rejected: 0 });
  assert.equal(first.fin.created, 40);
  const again = await run(rows.records, 'base.xlsx');
  assert.deepEqual(again.b, { created: 0, updated: 0, same: 40, rejected: 0 }, 'o mesmo arquivo não cria nem altera nada');
  const total = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.partner_contacts`);
  assert.equal(total.rows[0]!.n, '40');

  // versão nova do arquivo: 1 telefone novo e 1 margem diferente (atualiza), 10 contatos novos
  const next = planSheet(await readXlsx(buildXlsx([{ name: 'Base', headers: HEADERS, rows: [...sheetRows(40).slice(0, 2).map((r, i) => (i === 0 ? [...r.slice(0, 4), '21977776666', ...r.slice(5)] : [...r.slice(0, 8), '9999.00'])), ...sheetRows(10, 40)] }])));
  const third = await run(next.records, 'base-v2.xlsx');
  assert.deepEqual(third.b, { created: 10, updated: 2, same: 0, rejected: 0 });
  const phones = await admin('GET', '/api/partner/contacts?q=SERVIDOR%20TESTE%200', { headers: auth });
  assert.equal(phones.json.items[0].name, 'SERVIDOR TESTE 0');
  const detail = await admin('GET', `/api/partner/contacts/${phones.json.items[0].id}`, { headers: auth });
  assert.equal(detail.json.pii.phones.length, 2, 'o telefone novo foi somado ao antigo, sem perder o que já existia');

  // CPF e telefone nunca ficam em claro no banco
  const raw = await db.query<{ pii_enc: Buffer; cpf_hmac: string }>(`SELECT pii_enc, cpf_hmac FROM app.partner_contacts LIMIT 1`);
  assert.ok(!raw.rows[0]!.pii_enc.toString('utf8').includes(rows.records[0]!.cpf));
  assert.ok(!raw.rows[0]!.cpf_hmac.includes(rows.records[0]!.cpf));

  // busca por CPF, filtro por margem e etapa
  const byCpf = await admin('GET', `/api/partner/contacts?q=${rows.records[3]!.cpf}`, { headers: auth });
  assert.equal(byCpf.json.total, 1);
  const rich = await admin('GET', '/api/partner/contacts?margem=5000', { headers: auth });
  assert.equal(rich.json.total, 1);
  const id = byCpf.json.items[0].id;
  assert.equal((await admin('PATCH', `/api/partner/contacts/${id}`, { headers: auth, body: { stage: 'em_contato', nextActionOn: '2030-01-01' } })).status, 200);
  assert.equal((await admin('POST', `/api/partner/contacts/${id}/events`, { headers: auth, body: { kind: 'ligacao', body: 'Atendeu, pediu retorno amanhã.' } })).status, 200);
  const after = await admin('GET', `/api/partner/contacts/${id}`, { headers: auth });
  assert.equal(after.json.stage, 'em_contato');
  assert.equal(after.json.events.length, 2);
  const facets = await admin('GET', '/api/partner/contacts/facets', { headers: auth });
  assert.equal(facets.json.stages.find((s: any) => s.key === 'em_contato').count, 1);

  // contrato da base própria: sem comissão para o Fôlego
  const deal = await admin('POST', '/api/partner/deals', { headers: auth, body: { source: 'contact', refId: id, product: 'consignado', amountCents: 2_000_000, signedOn: '2026-10-01' } });
  assert.equal(deal.status, 201);
  assert.equal(deal.json.commissionCents, 0);
  assert.equal((await admin('GET', `/api/partner/contacts/${id}`, { headers: auth })).json.stage, 'fechado');

  // validação do servidor: CPF inválido ou campo desconhecido é recusado
  const bad = await admin('POST', '/api/partner/imports', { headers: auth, body: { filename: 'x.xlsx', layout: 'cabecalho', total: 1 } });
  // Uma linha ruim não derruba o lote: as boas entram e a ruim é contada. E-mail ou telefone inválido só é descartado.
  const mixed = await admin('POST', `/api/partner/imports/${bad.json.importId}/rows`, { headers: auth, body: { rows: [{ ...rows.records[0], cpf: '11111111111' }, { ...rows.records[1], emails: ['sem-arroba', 'bom@exemplo.com', 'a..b@x.com'], phones: ['123', '21988887777'] }, { campo: 'solto' }] } });
  assert.equal(mixed.status, 200, JSON.stringify(mixed.json));
  assert.deepEqual(mixed.json, { created: 0, updated: 1, same: 0, rejected: 2 });
  const merged = await admin('GET', `/api/partner/contacts?q=${rows.records[1]!.cpf}`, { headers: auth });
  const mergedDetail = await admin('GET', `/api/partner/contacts/${merged.json.items[0].id}`, { headers: auth });
  assert.ok(mergedDetail.json.pii.emails.includes('bom@exemplo.com'));
  assert.ok(!mergedDetail.json.pii.emails.includes('sem-arroba'));
  assert.ok(mergedDetail.json.pii.phones.includes('21988887777'));

  // outro parceiro não enxerga nada disto
  const other = await admin('POST', '/api/admin/partners', { headers: { 'x-admin-token': ADMIN }, body: { legalName: 'Outra ME', cnpj: '11222333000144', category: 'consignado', email: 'outra@teste.com', campaign: { name: 'Campanha outra', consentCategory: 'consignado', pricePerLeadCents: 0, dailyCap: 5 } } });
  const otherLogin = await admin('POST', '/api/partner/login', { body: { email: 'outra@teste.com', password: other.json.password } });
  const oauth = { authorization: `Bearer ${otherLogin.json.token}` };
  assert.equal((await admin('GET', `/api/partner/contacts/${id}`, { headers: oauth })).status, 404);
  assert.equal((await admin('GET', '/api/partner/contacts', { headers: oauth })).json.total, 0);
  assert.equal((await admin('GET', '/api/partner/contacts')).status, 401);
});

test('contatos do Fôlego: entrega só no portal, contrato com comissão em %, baixa no backoffice e revogação limpa o nome', async () => {
  const admin = client();
  const euro = await db.query<{ id: string }>(`SELECT id FROM app.partners WHERE cnpj = '09242004000150'`);
  const partnerId = euro.rows[0]!.id;
  const login = await admin('POST', '/api/partner/login', { body: { email: 'euro@teste.com', password: (await partners.resetPassword(ctx(), 'teste', partnerId)).password } });
  const auth = { authorization: `Bearer ${login.json.token}` };

  const { c, caseId } = await paidCase('portal-lead');
  const ok = await c('POST', `/api/cases/${caseId}/leads`, { body: { name: 'João Freitas', phone: '(11) 98765-4321', categories: ['consignado'], consent: true } });
  assert.equal(ok.status, 201);
  assert.equal(await deliverPendingLeads(ctx()), 2, 'entrega aos dois parceiros (ambos sem webhook)');
  const mine = await admin('GET', '/api/partner/leads', { headers: auth });
  const lead = mine.json.leads.find((l: any) => l.name === 'João Freitas');
  assert.ok(lead, 'o contato aparece na tela do parceiro sem webhook');
  assert.equal(lead.status, 'delivered');
  assert.equal(lead.commissionBps, 1500);

  // contrato de R$ 30.500,00 com comissão de 15% = R$ 4.575,00
  const deal = await admin('POST', '/api/partner/deals', { headers: auth, body: { source: 'lead', refId: lead.id, product: 'consignado', amountCents: 3_050_000, installments: 84, monthlyCents: 69_000, bank: 'Banco do Brasil', signedOn: '2026-10-05' } });
  assert.equal(deal.status, 201, JSON.stringify(deal.json));
  assert.equal(deal.json.commissionCents, 457_500);
  assert.equal(deal.json.commissionBps, 1500);
  assert.equal((await admin('GET', '/api/partner/leads', { headers: auth })).json.leads.find((l: any) => l.id === lead.id).status, 'converted');
  assert.equal((await admin('POST', '/api/partner/deals', { headers: auth, body: { source: 'lead', refId: lead.id, product: 'consignado', amountCents: 100_000, signedOn: '2999-01-01' } })).status, 422);

  const list = await admin('GET', '/api/partner/deals', { headers: auth });
  assert.equal(list.json.totals.folegoVolumeCents, 3_050_000);
  assert.equal(list.json.totals.commissionDueCents, 457_500);
  const sum = await admin('GET', '/api/partner/summary', { headers: auth });
  assert.equal(sum.json.folego.received, 1);
  assert.equal(sum.json.folego.converted, 1);
  assert.equal(sum.json.deals.folego.commissionDueCents, 457_500);

  // corrigir o valor recalcula a comissão com o % congelado na entrega
  const fix = await admin('PATCH', `/api/partner/deals/${deal.json.id}`, { headers: auth, body: { amountCents: 3_000_000 } });
  assert.equal(fix.status, 200, JSON.stringify(fix.json));
  assert.equal(fix.json.commissionCents, 450_000);

  // backoffice do Fôlego: vê o contrato, dá baixa na comissão; depois disso o parceiro não altera mais o contrato
  const adminDeals = await partners.partnerDeals(ctx(), partnerId);
  assert.equal(adminDeals.deals[0]!.commissionCents, 450_000);
  assert.equal(adminDeals.deals[0]!.commissionStatus, 'a_receber');
  const listed = (await partners.listPartners(ctx())).partners.find((p) => p.id === partnerId)!;
  assert.deepEqual(listed.deals, { count: 1, volumeCents: 3_000_000, commissionDueCents: 450_000, commissionPaidCents: 0 });
  assert.equal(listed.campaigns[0]!.commissionBps, 1500);
  await partners.setCommissionStatus(ctx(), 'teste', deal.json.id, { status: 'recebida', receivedOn: '2026-10-20' });
  assert.equal((await admin('PATCH', `/api/partner/deals/${deal.json.id}`, { headers: auth, body: { amountCents: 1_000_000 } })).status, 409);
  assert.equal((await partners.partnerDeals(ctx(), partnerId)).deals[0]!.receivedOn, '2026-10-20');

  // o titular revoga: o nome some do contrato e do portal, o valor continua nos números
  assert.equal((await c('DELETE', `/api/cases/${caseId}/leads`)).status, 204);
  const names = await db.query<{ client_name: string | null }>(`SELECT client_name FROM app.partner_deals WHERE id = $1`, [deal.json.id]);
  assert.equal(names.rows[0]!.client_name, null);
  assert.equal((await admin('GET', '/api/partner/deals', { headers: auth })).json.totals.folegoVolumeCents, 3_000_000);
});

test('backoffice: editar o cadastro inteiro do parceiro, inclusive o e-mail de acesso ao portal (a senha continua)', async () => {
  const admin = client();
  const euro = await db.query<{ id: string }>(`SELECT id FROM app.partners WHERE cnpj = '09242004000150'`);
  const id = euro.rows[0]!.id;
  const pw = (await partners.resetPassword(ctx(), 'teste', id)).password;
  await partners.update(ctx(), 'teste', id, { email: 'novo@euro.test', cnpj: '09242004000150', city: 'Curitiba', uf: 'PR', tradeName: 'EURO NOVA', legalName: 'Euro Nova ME' });
  assert.equal((await admin('POST', '/api/partner/login', { body: { email: 'euro@teste.com', password: pw } })).status, 401, 'o e-mail antigo deixa de entrar');
  const ok = await admin('POST', '/api/partner/login', { body: { email: 'novo@euro.test', password: pw } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.tradeName, 'EURO NOVA');
  const listed = (await partners.listPartners(ctx())).partners.find((p) => p.id === id)!;
  assert.equal(listed.portalEmail, 'novo@euro.test');
  assert.equal(listed.city, 'Curitiba');
  // e-mail ou CNPJ de outro parceiro: recusa com mensagem clara
  await assert.rejects(partners.update(ctx(), 'teste', id, { email: 'outra@teste.com' }), /Já existe/);
  await assert.rejects(partners.update(ctx(), 'teste', id, { cnpj: '11222333000144' }), /Já existe/);
});
