import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleWebhook } from '../src/services.ts';
import { ensureDefaultEbook, sendEbookGifts } from '../src/ebook.ts';
import { notifyCredits, syncPrices, optOutToken } from '../src/referrals.ts';
import { refreshMarket } from '../src/market.ts';

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
let pdf: Buffer;
const mailbox = new MemorySender();
const config = { ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true, adminEmails: ['dono@exemplo.com'] };
const ctx = () => ({ db, config, gateway, email: mailbox });

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(config.webhookSecret);
  app = await buildApp({ config, db, gateway, email: mailbox, rateLimits: 'relaxed' });
  pdf = await readFile(new URL('../src/assets/folego-ebook.pdf', import.meta.url));
});
after(async () => {
  await app.close();
  await db.close();
});

function client() {
  let cookie = '';
  return async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, opts: { body?: unknown; raw?: Buffer; headers?: Record<string, string> } = {}) => {
    const hasBody = opts.body !== undefined || opts.raw !== undefined;
    const res = await app.inject({
      method,
      url,
      headers: { 'x-folego': '1', ...(opts.raw ? { 'content-type': 'application/pdf' } : opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...opts.headers },
      payload: !hasBody ? undefined : opts.raw ?? JSON.stringify(opts.body),
    });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json, raw: res.rawPayload, headers: res.headers };
  };
}
type Client = ReturnType<typeof client>;
const lastCode = () => /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;
const PW = 'Senha-Forte-2026';

let sharedOwner: Client | null = null;
async function ownerClient() {
  if (sharedOwner) return sharedOwner;
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/gestao/setup-code', { body: { email: 'dono@exemplo.com' } });
  await c('POST', '/api/gestao/setup', { body: { email: 'dono@exemplo.com', code: lastCode(), password: PW } });
  assert.equal((await c('POST', '/api/gestao/login-password', { body: { email: 'dono@exemplo.com', password: PW } })).status, 200);
  sharedOwner = c;
  return c;
}
async function subLogin(c: Client, email: string) {
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  await c('POST', '/api/account/login', { body: { email, code: lastCode() } });
}
async function payFirst(orderId: string) {
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  return handleWebhook(ctx(), { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt-${orderId}`, paymentId: p.rows[0]!.provider_payment_id });
}
async function subscribe(c: Client, email: string, plan: string, referralCode?: string) {
  await subLogin(c, email);
  const co = await c('POST', '/api/account/subscription-checkout', { body: { plan, acceptTerms: true, ...(referralCode ? { referralCode } : {}) } });
  assert.equal(co.status, 201);
  assert.equal(await payFirst(co.json.orderId), 'confirmed');
}
const idOf = async (email: string) => (await db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE email = $1`, [email])).rows[0]!.id;

test('eBook: o padrão entra na primeira subida; backoffice envia, atualiza, ativa, baixa e exclui; só PDF até 15 MB', async () => {
  assert.equal(await ensureDefaultEbook(db), true);
  assert.equal(await ensureDefaultEbook(db), false, 'só importa uma vez');
  const owner = await ownerClient();
  let list = (await owner('GET', '/api/gestao/ebooks')).json;
  assert.equal(list.ebooks.length, 1);
  assert.equal(list.ebooks[0].active, true);
  assert.equal(list.ebooks[0].source, 'padrao');

  assert.equal((await owner('POST', '/api/gestao/ebooks?titulo=Falso&arquivo=x.pdf', { raw: Buffer.from('isso não é um pdf, só texto longo o bastante para passar do tamanho mínimo '.repeat(3)) })).status, 422);
  const up = await owner('POST', '/api/gestao/ebooks?titulo=Edi%C3%A7%C3%A3o%202&arquivo=Meu%20eBook%20Novo.pdf', { raw: pdf });
  assert.equal(up.status, 201);
  assert.equal(up.json.active, true);
  assert.equal(up.json.filename, 'Meu-eBook-Novo.pdf');
  list = (await owner('GET', '/api/gestao/ebooks')).json;
  assert.equal(list.ebooks.filter((e: any) => e.active).length, 1, 'só um ativo');
  assert.equal(list.ebooks.find((e: any) => e.active).title, 'Edição 2');

  const id = up.json.id;
  assert.equal((await owner('PATCH', `/api/gestao/ebooks/${id}`, { body: { title: 'Edição 2 (revisada)' } })).json.title, 'Edição 2 (revisada)');
  const rep = await owner('PUT', `/api/gestao/ebooks/${id}/arquivo?arquivo=revisado.pdf`, { raw: pdf });
  assert.equal(rep.json.version, 2);
  const file = await owner('GET', `/api/gestao/ebooks/${id}/arquivo`);
  assert.equal(file.status, 200);
  assert.equal(file.raw.subarray(0, 5).toString(), '%PDF-');
  mailbox.sent.length = 0;
  assert.equal((await owner('POST', `/api/gestao/ebooks/${id}/teste`, { body: {} })).status, 200);
  assert.equal(mailbox.sent[0]!.to, 'dono@exemplo.com');
  assert.equal(mailbox.sent[0]!.attachments![0]!.contentType, 'application/pdf');
  assert.match(mailbox.sent[0]!.subject, /^\[TESTE\]/);

  const first = list.ebooks.find((e: any) => e.source === 'padrao').id;
  assert.equal((await owner('PATCH', `/api/gestao/ebooks/${first}`, { body: { active: true } })).json.active, true);
  assert.equal((await owner('GET', '/api/gestao/ebooks')).json.ebooks.find((e: any) => e.id === id).active, false);
  assert.equal((await owner('DELETE', `/api/gestao/ebooks/${id}`)).status, 204);
  assert.equal((await owner('GET', '/api/gestao/ebooks')).json.ebooks.length, 1);
});

test('presente: assinou Ousado ou Desbravador recebe o eBook em anexo, uma única vez; Controle não recebe', async () => {
  const a = client();
  const b = client();
  const c = client();
  await subscribe(a, 'presente-ousado@exemplo.com', 'ousado');
  await subscribe(b, 'presente-desb@exemplo.com', 'desbravador');
  await subscribe(c, 'presente-controle@exemplo.com', 'controle');
  mailbox.sent.length = 0;
  while ((await sendEbookGifts(ctx())) > 0) { /* esvazia a fila */ }
  const to = mailbox.sent.map((m) => m.to);
  assert.ok(to.includes('presente-ousado@exemplo.com'));
  assert.ok(to.includes('presente-desb@exemplo.com'));
  assert.ok(!to.includes('presente-controle@exemplo.com'));
  const mail = mailbox.sent.find((m) => m.to === 'presente-ousado@exemplo.com')!;
  assert.equal(mail.attachments![0]!.content.subarray(0, 5).toString(), '%PDF-');
  assert.match(mail.html, /Respira\. Organiza\. Avança\./);
  assert.match(mail.html, /Obrigado por assinar o Prumo/);
  assert.match(mail.html, /10% de desconto/, 'convida a indicar amigos');
  mailbox.sent.length = 0;
  assert.equal(await sendEbookGifts(ctx()), 0, 'só uma vez');
  // quem faz upgrade depois do Controle ganha o presente
  await db.query(`UPDATE app.subscriptions SET plan = 'ousado' WHERE subscriber_id = $1`, [await idOf('presente-controle@exemplo.com')]);
  assert.equal(await sendEbookGifts(ctx()), 1);
  assert.equal((await db.query<{ n: number }>(`SELECT sent_count AS n FROM app.ebooks WHERE active`)).rows[0]!.n >= 3, true);
});

test('indicação de quem comprou no Pix: só gera lead (sem bônus), com limites e descadastro do amigo', async () => {
  const c = client();
  await subLogin(c, 'comprador-pix@exemplo.com'); // abre uma sessão (quem compra no Pix também tem sessão)
  assert.equal((await c('POST', '/api/referrals/lead', { body: { friendEmail: 'amigo@exemplo.com', yourName: 'Bia' } })).status, 403, 'precisa ter usado um produto');
  const sid = (await db.query<{ id: string }>(`SELECT id FROM app.sessions WHERE subscriber_id = (SELECT id FROM app.subscribers WHERE email = 'comprador-pix@exemplo.com') ORDER BY created_at DESC LIMIT 1`)).rows[0]!.id;
  await db.query(`INSERT INTO app.orders(case_id, subscriber_id, session_id, status, total_cents, idempotency_key, paid_at) VALUES (NULL,$2,$1,'paid',2900,'ref-test-1', now())`, [sid, await idOf('comprador-pix@exemplo.com')]);
  mailbox.sent.length = 0;
  assert.equal((await c('POST', '/api/referrals/lead', { body: { friendEmail: 'Amigo@Exemplo.com', yourName: 'Bia Souza' } })).status, 204);
  const m = mailbox.sent[0]!;
  assert.equal(m.to, 'amigo@exemplo.com');
  assert.match(m.subject, /Bia indicou o Fôlego/);
  assert.match(m.html, /diagnóstico grátis/i);
  assert.match(m.html, /Não quero receber indicações/);
  assert.ok(m.headers!['List-Unsubscribe']);
  assert.equal((await db.query(`SELECT 1 FROM app.referral_credits`)).rows.length, 0, 'lead não gera crédito nenhum');

  mailbox.sent.length = 0;
  await c('POST', '/api/referrals/lead', { body: { friendEmail: 'amigo@exemplo.com', yourName: 'Bia' } });
  assert.equal(mailbox.sent.length, 0, 'o mesmo amigo não recebe de novo dentro do prazo');
  assert.equal((await c('POST', '/api/referrals/lead', { body: { friendEmail: 'nao-e-email', yourName: 'Bia' } })).status, 400);

  // descadastro: o amigo pede para não receber e ninguém mais consegue enviar
  const token = optOutToken(ctx(), 'bloqueado@exemplo.com');
  assert.equal((await client()('POST', '/api/unsubscribe', { body: { token } })).status, 204);
  mailbox.sent.length = 0;
  await c('POST', '/api/referrals/lead', { body: { friendEmail: 'bloqueado@exemplo.com', yourName: 'Bia' } });
  assert.equal(mailbox.sent.length, 0);
  assert.equal((await client()('POST', '/api/unsubscribe', { body: { token: `r.${Buffer.from('x@y.com').toString('base64url')}.assinatura-falsa-xxxxxxxxxxxxxxxxxxxx` } })).status, 400);

  for (let i = 0; i < 6; i += 1) await c('POST', '/api/referrals/lead', { body: { friendEmail: `lote${i}@exemplo.com`, yourName: 'Bia' } });
  assert.equal((await c('POST', '/api/referrals/lead', { body: { friendEmail: 'mais@exemplo.com', yourName: 'Bia' } })).status, 429, 'limite de 5 por comprador');
});

test('indicação de assinante: cada amigo que assina vale 10% na próxima fatura, acumulando, sem fraude', async () => {
  const x = client();
  await subscribe(x, 'indicador@exemplo.com', 'ousado');
  const ov = (await x('GET', '/api/account/referrals')).json;
  assert.equal(ov.percent, 10);
  assert.match(ov.code, /^[a-z0-9]{8}$/);
  assert.ok(ov.link.includes(`?ind=${ov.code}`));
  assert.equal((await x('POST', '/api/account/referrals', { body: { email: 'indicador@exemplo.com' } })).status, 422, 'não indica a si mesmo');

  mailbox.sent.length = 0;
  assert.equal((await x('POST', '/api/account/referrals', { body: { email: 'Amiga1@Exemplo.com' } })).status, 204);
  const inv = mailbox.sent[0]!;
  assert.equal(inv.to, 'amiga1@exemplo.com');
  assert.ok(inv.html.includes(`ind=${ov.code}`));

  // amiga 1 assina pelo link (código) e amiga 2 só pelo e-mail convidado (sem código)
  const y1 = client();
  await subscribe(y1, 'amiga1@exemplo.com', 'controle', ov.code);
  assert.equal((await x('GET', '/api/account/referrals')).json.credits.available, 1);
  assert.equal((await x('GET', '/api/account/referrals')).json.converted, 1);
  assert.equal((await x('POST', '/api/account/referrals', { body: { email: 'amiga2@exemplo.com' } })).status, 204);
  const y2 = client();
  await subscribe(y2, 'amiga2@exemplo.com', 'desbravador');
  const after = (await x('GET', '/api/account/referrals')).json;
  assert.equal(after.credits.available, 2);
  assert.equal(after.next.percent, 10);
  assert.equal(after.next.valueCents, 3599);
  assert.equal(after.next.months, 2);

  // a própria indicada não pode se premiar, e quem já assinou antes não gera crédito de novo
  const selfCode = (await y1('GET', '/api/account/referrals')).json.code;
  const again = (await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.referral_credits`)).rows[0]!.n;
  await y1('POST', '/api/account/subscription-checkout', { body: { plan: 'controle', acceptTerms: true, referralCode: selfCode } }).catch(() => undefined);
  assert.equal((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.referral_credits`)).rows[0]!.n, again);

  // o worker avisa quem ganhou e acerta o valor da assinatura no provedor
  mailbox.sent.length = 0;
  assert.ok((await notifyCredits(ctx())) >= 2);
  assert.ok(mailbox.sent.some((m) => m.to === 'indicador@exemplo.com' && /10% de desconto/.test(m.subject)));
  assert.equal(await notifyCredits(ctx()), 0, 'avisa uma vez');
  assert.ok((await syncPrices(ctx())) >= 1);
  const sub = (await db.query<{ provider_subscription_id: string }>(`SELECT provider_subscription_id FROM app.billing_profiles WHERE subscriber_id = $1`, [await idOf('indicador@exemplo.com')])).rows[0]!.provider_subscription_id;
  assert.equal(gateway.valueOf(sub), 3599, 'próxima fatura com 10% de desconto');

  // fatura 1 sai com desconto: gasta 1 crédito e continua com desconto (ainda há 1)
  const r1 = await x('POST', '/api/dev/renew');
  assert.equal(r1.json.outcome, 'confirmed');
  assert.equal((await x('GET', '/api/account/referrals')).json.credits.available, 1);
  assert.equal((await x('GET', '/api/account/referrals')).json.credits.applied, 1);
  await syncPrices(ctx());
  assert.equal(gateway.valueOf(sub), 3599, 'ainda há um mês de desconto');
  await x('POST', '/api/dev/renew');
  assert.equal((await x('GET', '/api/account/referrals')).json.credits.available, 0);
  await syncPrices(ctx());
  assert.equal(gateway.valueOf(sub), 3999, 'acabaram os créditos: volta ao preço cheio');
  const paid = (await db.query<{ amount_cents: string }>(`SELECT p.amount_cents FROM app.payments p JOIN app.orders o ON o.id = p.order_id WHERE o.subscriber_id = $1 AND p.status = 'confirmed' ORDER BY p.created_at`, [await idOf('indicador@exemplo.com')])).rows.map((r) => Number(r.amount_cents));
  assert.deepEqual(paid, [3999, 3599, 3599]);
});

test('backoffice: Indicações mostra os números, permite ajustar créditos com motivo e o desconto é configurável', async () => {
  const owner = await ownerClient();
  const ov = (await owner('GET', '/api/gestao/indicacoes')).json;
  assert.ok(ov.kpis.leadInvites >= 1);
  assert.ok(ov.kpis.subscriberInvites >= 2);
  assert.equal(ov.kpis.converted, 2);
  assert.ok(ov.top.find((t: any) => t.email === 'indicador@exemplo.com'));
  const id = await idOf('amiga1@exemplo.com');
  assert.equal((await owner('POST', '/api/gestao/indicacoes/creditos', { body: { subscriberId: id, delta: 2, reason: '' } })).status, 400);
  assert.equal((await owner('POST', '/api/gestao/indicacoes/creditos', { body: { subscriberId: id, delta: 2, reason: 'Cortesia de lançamento' } })).json.available, 2);
  assert.equal((await owner('POST', '/api/gestao/indicacoes/creditos', { body: { subscriberId: id, delta: -1, reason: 'Correção' } })).json.available, 1);
  await owner('PUT', '/api/gestao/config', { body: { referralDiscountPct: 20 } });
  assert.equal((await owner('GET', '/api/gestao/indicacoes')).json.percent, 20);
  await owner('PUT', '/api/gestao/config', { body: { referralDiscountPct: 10 } });
});

test('controle dos descontos: aparece em Pedidos e na Jornada do cliente, usa o valor contratado e a conferência bate com o provedor', async () => {
  const owner = await ownerClient();
  const id = await idOf('indicador@exemplo.com');
  const d = (await owner('GET', `/api/gestao/assinaturas/${id}`)).json;
  // pedidos: o desconto aparece (preço de tabela x valor cobrado) e o método é cartão
  const discounted = d.orders.filter((o: any) => o.discountCents > 0);
  assert.equal(discounted.length, 2, 'duas faturas saíram com desconto');
  assert.equal(discounted[0].listCents, 3999);
  assert.equal(discounted[0].totalCents, 3599);
  assert.equal(discounted[0].discountCents, 400);
  assert.equal(discounted[0].creditPercent, 10);
  assert.equal(discounted[0].method, 'card');
  // controle por cliente: créditos (aplicados, com a fatura), billing e indicações
  assert.equal(d.referral.credits.filter((c: any) => c.status === 'applied').length, 2);
  assert.ok(d.referral.credits.every((c: any) => c.appliedAmountCents === 3599 || c.status !== 'applied'));
  assert.equal(d.referral.billing.status, 'active');
  assert.equal(d.referral.billing.inSync, true);
  assert.equal(d.referral.billing.wantedCents, 3999);
  assert.equal(d.referral.converted, 2);
  const friend = (await owner('GET', `/api/gestao/assinaturas/${await idOf('amiga1@exemplo.com')}`)).json;
  assert.equal(friend.referral.referredBy, 'indicador@exemplo.com');

  // Jornada: ganhou, aplicou e indicou aparecem na linha do tempo
  const tl = (await owner('GET', `/api/gestao/jornada/assinante/${id}`)).json.timeline.map((t: any) => `${t.label}|${t.detail ?? ''}`).join('\n');
  assert.match(tl, /Ganhou desconto por indicação/);
  assert.match(tl, /Desconto de 10% aplicado na fatura/);
  assert.match(tl, /cobrado R\$ 35,99 em vez de R\$ 39,99/);
  assert.match(tl, /Indicou um amigo por e-mail/);
  assert.match(tl, /Aceitou os termos e começou a assinatura mensal no cartão/);
  const tlFriend = (await owner('GET', `/api/gestao/jornada/assinante/${await idOf('amiga1@exemplo.com')}`)).json.timeline.map((t: any) => t.label).join('\n');
  assert.match(tlFriend, /Chegou por indicação de um assinante/);

  // valor contratado: mudar o preço do plano NÃO muda a cobrança de quem já assina nem gera descontos errados
  await db.query(`UPDATE app.products SET price_cents = 4999 WHERE code = 'sub_ousado'`);
  await db.query(`INSERT INTO app.referral_credits(subscriber_id, percent, source, note) VALUES ($1, 10, 'manual', 'teste de preço')`, [id]);
  await syncPrices(ctx());
  const sub = (await db.query<{ provider_subscription_id: string }>(`SELECT provider_subscription_id FROM app.billing_profiles WHERE subscriber_id = $1`, [id])).rows[0]!.provider_subscription_id;
  assert.equal(gateway.valueOf(sub), 3599, '10% sobre o valor CONTRATADO (3.999), não sobre o preço novo (4.999)');
  const rec = (await owner('GET', '/api/gestao/indicacoes')).json.reconcile.find((r: any) => r.email === 'indicador@exemplo.com');
  assert.equal(rec.wantedCents, 3599);
  assert.equal(rec.syncedCents, 3599);
  assert.equal(rec.inSync, true);
  await db.query(`UPDATE app.products SET price_cents = 3999 WHERE code = 'sub_ousado'`);
});

test('indicadores do Banco Central: se a consulta "últimos N" for recusada usa o intervalo de datas; o motivo da falha fica registrado', async () => {
  await db.query(`DELETE FROM app.market_indicators`);
  const seen: string[] = [];
  const fetchFn = (async (url: string) => {
    seen.push(url);
    if (url.includes('/ultimos/')) return new Response('nope', { status: 406 });
    if (!/sgs\.(\d+)\//.test(url)) return new Response('erro', { status: 500 });
    const serie = /sgs\.(\d+)\//.exec(url)![1];
    if (serie === '1') return new Response('erro', { status: 500 });
    return new Response(JSON.stringify([{ data: '01/10/2026', valor: '14,75' }]), { status: 200 });
  }) as unknown as typeof fetch;
  const saved = await refreshMarket(ctx(), { fetchFn, force: true });
  assert.equal(saved, 3, 'três séries entraram pelo plano B');
  assert.ok(seen.some((u) => u.includes('dataInicial=')));
  const owner = await ownerClient();
  const st = (await owner('GET', '/api/gestao/mercado')).json;
  assert.match(st.lastRun.errors.usd, /bcb_http_500/);
  assert.match(st.lastRun.errors.usd, /awesomeapi: awesome_http_500/);
  assert.equal(st.lastRun.errors.selic, undefined);
  assert.equal(st.indicators.selicPct, 14.75);
});

test('indicadores: se o Banco Central não responde pela rede, usa BrasilAPI, IBGE e AwesomeAPI (planos B) sem perder tempo com as outras séries dele', async () => {
  await db.query("DELETE FROM app.market_indicators");
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    if (url.includes('bcb.gov.br')) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (url.includes('brasilapi')) return new Response(JSON.stringify([{ nome: 'Selic', valor: 14.75 }, { nome: 'CDI', valor: 14.65 }, { nome: 'IPCA', valor: 4.2 }]), { status: 200 });
    if (url.includes('ibge')) return new Response(JSON.stringify([{ resultados: [{ series: [{ serie: { '202607': '4.44', '202608': '4.22' } }] }] }]), { status: 200 });
    if (url.includes('awesomeapi')) return new Response(JSON.stringify([{ bid: '5.40', timestamp: '1790967476' }, { bid: '5.30', timestamp: '1790400000' }]), { status: 200 });
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  const saved = await refreshMarket(ctx(), { fetchFn, force: true });
  assert.ok(saved >= 6);
  assert.equal(urls.filter((u) => u.includes('bcb.gov.br')).length, 2, 'só a primeira série tenta o Banco Central (duas formas de consulta); as outras pulam');
  const owner = await ownerClient();
  const st = (await owner('GET', '/api/gestao/mercado')).json;
  assert.deepEqual(st.lastRun.errors, {});
  assert.equal(st.indicators.selicPct, 14.75);
  assert.equal(st.indicators.cdiPct, 14.65);
  assert.equal(st.indicators.ipca12Pct, 4.22);
  assert.equal(st.indicators.usdBrl, 5.4);
});
