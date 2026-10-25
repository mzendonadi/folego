// Assistente do Prumo no WhatsApp com áudio, foto de cupom e PDF de fatura. As IAs (Anthropic e transcrição) são simuladas; nada sai para a internet.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { handleAssistantInbound } from '../src/assistant.ts';
import { descriptionFrom, spokenToText } from '../src/assistant-media.ts';
import type { WaTransport } from '../src/whatsapp.ts';
import type { Ctx } from '../src/services.ts';
import { todaySaoPaulo } from '../src/services.ts';

let db: Db;
let app: FastifyInstance;
let gateway: FakeGateway;
const mailbox = new MemorySender();
const base = {
  ...loadConfig({ NODE_ENV: 'test' }), webhookSecret: 'segredo-de-teste', subscriptionsEnabled: true,
  bird: { apiKey: 'bk_test_0123456789012345', from: '+5511913792370', baseUrl: 'http://bird.invalid', template: 'folego-indicacao-prumo', language: 'pt-BR', webhookSecret: 'whsec_teste_0123456789', classic: false, workspaceId: 'ws-teste', channelId: 'canal-teste', inviteProjectId: 'proj-teste', inviteVersion: 'ver-teste' },
};
let config = base;
const sent: { to: string; text: string }[] = [];
let n = 0;
const files: Record<string, { bytes: Buffer; mime: string }> = {
  foto: { bytes: Buffer.from('jpeg-de-mentira'), mime: 'image/jpeg' },
  voz: { bytes: Buffer.from('ogg-de-mentira'), mime: 'audio/ogg' },
  fatura: { bytes: Buffer.from('%PDF-de-mentira'), mime: 'application/pdf' },
};
const fake = {
  async sendText(_c: unknown, to: string, text: string) { sent.push({ to, text }); return { id: `w${(n += 1)}` }; },
  async downloadMedia(_c: unknown, ref: { id?: string }) { return files[ref.id ?? '']!; },
} as unknown as WaTransport;
const ctx = (): Ctx => ({ db, config, whatsapp: fake, email: mailbox } as unknown as Ctx);

// ---- IA simulada: responde pelo que foi pedido
const realFetch = globalThis.fetch;
let receipt: Record<string, unknown> = { is_receipt: true, merchant: 'SUPERMERCADO EXEMPLO', total_cents: 8_740, date: '' };
let pdfText = '';
let heardText = 'mercado quarenta e cinco reais';
const calls: string[] = [];
function fakeInternet(): void {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(String(init?.body)) as { messages: { content: { type: string }[] }[] };
      const isPdf = body.messages[0]!.content.some((c) => c.type === 'document');
      const content = isPdf ? [{ type: 'text', text: pdfText }] : [{ type: 'tool_use', name: 'ler_comprovante', input: { ...receipt, date: receipt.date || todaySaoPaulo() } }];
      return new Response(JSON.stringify({ content }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.startsWith('https://api.openai.com/')) return new Response(JSON.stringify({ text: heardText }), { status: 200, headers: { 'content-type': 'application/json' } });
    return realFetch(url as never, init);
  }) as typeof fetch;
}

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  gateway = new FakeGateway(base.webhookSecret);
  app = await buildApp({ config: base, db, gateway, email: mailbox, whatsapp: fake, rateLimits: 'relaxed' });
  fakeInternet();
});
afterEach(() => { config = base; });
after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  await db.close();
});

function client() {
  let cookie = '';
  return async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...opts.headers }, payload: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const set = res.headers['set-cookie'];
    const raw = Array.isArray(set) ? set[0] : set;
    if (raw) cookie = raw.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json };
  };
}
async function conta(email: string, key: string, plan: 'controle' | 'desbravador', phone: string) {
  const c = client();
  mailbox.sent.length = 0;
  await c('POST', '/api/account/login-code', { body: { email } });
  const code = /\b(\d{6})\b/.exec(mailbox.sent[0]!.text)![1];
  await c('POST', '/api/account/login', { body: { email, code } });
  const o = await c('POST', '/api/account/subscription-order', { body: { plan }, headers: { 'idempotency-key': key } });
  const p = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [o.json.orderId]);
  gateway.markPaid(p.rows[0]!.provider_payment_id);
  await app.inject({ method: 'POST', url: '/webhooks/pix', headers: { 'content-type': 'application/json', 'x-webhook-secret': base.webhookSecret }, payload: JSON.stringify({ eventId: `evt-${key}`, paymentId: p.rows[0]!.provider_payment_id }) });
  const link = (await c('POST', '/api/account/assistant/link')).json;
  await say(phone, `vincular ${link.pending.code}`);
  return c;
}
let seq = 0;
const say = (phone: string, text: string | null, extra: Record<string, unknown> = {}) =>
  handleAssistantInbound(ctx(), { id: `m${(seq += 1)}`, from: { phone_number: phone }, ...(text === null ? {} : { text: { body: text } }), ...extra });
const last = () => sent.at(-1)?.text ?? '';
const withKeys = () => { config = { ...base, anthropicApiKey: 'sk-ant-de-mentira', openaiApiKey: 'sk-de-mentira' } as typeof base; };
const count = async (where: string) => Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.ledger_entries WHERE ${where}`)).rows[0]!.n);

test('voz: número por extenso vira número, sem perder palavra, acento nem centavos', () => {
  assert.equal(spokenToText('mercado quarenta e cinco reais'), 'mercado 45');
  assert.equal(spokenToText('Uber dezoito e noventa ontem'), 'Uber 18,90 ontem');
  assert.equal(spokenToText('recebi mil e duzentos de salário'), 'recebi 1200 de salário');
  assert.equal(spokenToText('farmácia sessenta e dois reais'), 'farmácia 62');
  assert.equal(spokenToText('aluguel mil e quinhentos e cinquenta'), 'aluguel 1550');
  assert.equal(spokenToText('padaria cento e vinte e cinco'), 'padaria 125');
  assert.equal(spokenToText('mercado quarenta e cinco reais e cinquenta centavos'), 'mercado 45,50');
  assert.equal(spokenToText('Mercado, R$45,00.'), 'Mercado 45,00', 'o que já veio em dígitos continua igual');
  assert.equal(spokenToText('padaria 12,50'), 'padaria 12,50');
  assert.equal(descriptionFrom('despesas mercado'), 'mercado');
  assert.equal(descriptionFrom('gasto no posto'), 'posto');
  assert.equal(descriptionFrom('lançar'), '');
});

test('áudio: sem a chave de transcrição o assistente diz que ainda não ouve; com ela, ouve, mostra o que entendeu e lança', async () => {
  const phone = '+5534991110001';
  await conta('voz1@exemplo.com', 'midia-voz-01', 'controle', phone);
  sent.length = 0;
  await say(phone, null, { audio: { id: 'voz', mime_type: 'audio/ogg; codecs=opus', voice: true } });
  assert.match(last(), /Ainda não consigo ouvir áudio/);
  assert.equal(await count('amount_cents = -4500'), 0);

  withKeys();
  heardText = 'mercado quarenta e cinco reais';
  sent.length = 0;
  await say(phone, null, { audio: { id: 'voz', mime_type: 'audio/ogg; codecs=opus', voice: true } });
  assert.match(sent[0]!.text, /Ouvi: “mercado quarenta e cinco reais”/);
  assert.match(last(), /Lancei R\$\s?45,00 em Mercado e comida/);
  assert.equal(await count('amount_cents = -4500'), 1);
  assert.ok(calls.some((u) => u.startsWith('https://api.openai.com/')));

  heardText = '';
  sent.length = 0;
  await say(phone, null, { audio: { id: 'voz', mime_type: 'audio/ogg' } });
  assert.match(last(), /Não consegui entender o áudio/);
});

test('foto: lê o cupom, pergunta a categoria, lança com "despesas mercado"; com a descrição na legenda lança direto', async () => {
  const phone = '+5534991110002';
  await conta('foto1@exemplo.com', 'midia-foto-01', 'controle', phone);
  sent.length = 0;
  await say(phone, null, { image: { id: 'foto', mime_type: 'image/jpeg' } });
  assert.match(last(), /Ainda não consigo ler foto/, 'sem a chave da IA, avisa com franqueza');

  withKeys();
  sent.length = 0;
  await say(phone, null, { image: { id: 'foto', mime_type: 'image/jpeg' } });
  assert.match(last(), /Li SUPERMERCADO EXEMPLO: R\$\s?87,40/);
  assert.match(last(), /despesas mercado/);
  assert.equal(await count('amount_cents = -8740'), 0, 'nada é lançado sem a categoria');

  await say(phone, 'despesas mercado');
  assert.match(last(), /Lancei R\$\s?87,40 em Mercado e comida/);
  const row = (await db.query<{ note: string; category: string }>(`SELECT note, category FROM app.ledger_entries WHERE amount_cents = -8740`)).rows[0]!;
  assert.equal(row.category, 'mercado');
  assert.match(row.note, /^Mercado/);
  assert.equal((await db.query(`SELECT 1 FROM app.assistant_links WHERE pending IS NOT NULL`)).rows.length, 0, 'a espera foi limpa');

  // foto com a legenda já dizendo o que é: lança direto
  receipt = { is_receipt: true, merchant: 'POSTO SOL', total_cents: 15_000, date: '' };
  sent.length = 0;
  await say(phone, null, { image: { id: 'foto', mime_type: 'image/jpeg', caption: 'gasto no posto' } });
  assert.match(last(), /Lancei R\$\s?150,00/);
  assert.equal(await count('amount_cents = -15000'), 1);
  assert.equal(await say(phone, 'desfazer'), true);
  assert.match(last(), /Desfeito/);

  // não é cupom e valor absurdo
  receipt = { is_receipt: false, merchant: '', total_cents: 0, date: '' };
  await say(phone, null, { image: { id: 'foto', mime_type: 'image/jpeg' } });
  assert.match(last(), /Não consegui ler um cupom/);
  receipt = { is_receipt: true, merchant: 'LOJA', total_cents: 999_999_999, date: '' };
  await say(phone, null, { image: { id: 'foto', mime_type: 'image/jpeg' } });
  assert.match(last(), /Não consegui ler um cupom/, 'total fora do razoável é leitura errada');
  receipt = { is_receipt: true, merchant: 'SUPERMERCADO EXEMPLO', total_cents: 8_740, date: '' };
});

test('foto: texto com valor depois da foto vale como lançamento novo e CANCELAR descarta sem desconectar', async () => {
  const phone = '+5534991110003';
  await conta('foto2@exemplo.com', 'midia-foto-02', 'controle', phone);
  withKeys();
  receipt = { is_receipt: true, merchant: 'SUPERMERCADO EXEMPLO', total_cents: 6_310, date: '' };
  await say(phone, null, { image: { id: 'foto', mime_type: 'image/jpeg' } });
  await say(phone, 'padaria 12');
  assert.match(last(), /Lancei R\$\s?12,00/);
  assert.equal(await count('amount_cents = -6310'), 0, 'a foto esquecida não foi lançada sozinha');
  await say(phone, null, { image: { id: 'foto', mime_type: 'image/jpeg' } });
  await say(phone, 'cancelar');
  assert.match(last(), /descartei/);
  await say(phone, 'saldo');
  assert.match(last(), /Em \S+: entrou/, 'continua conectado');
});

// Fatura inventada (mesmo layout da do domínio)
const FATURA = `
BANCO EXEMPLO S.A. – CNPJ/MF 00.000.000/0001-00
TITULAR EXEMPLO - 5480 XXXX XXXX 3303
Olá, Titular! Esta é a fatura do seu cartão BANCO EXEMPLO ELITE MASTERCARD
contendo compras e pagamentos realizados até 08/10.
Total a Pagar
R$ 404,85
Vencimento
16/10/2026
Seu limite é
R$44.060,00
Limite utilizado
R$604,85
Limite Disponível:
R$43.455,15
Histórico de Faturas   Pagamento   Período das compras
AGO.   R$ 900,00   R$900,00   10/07/26 a 10/08/26
SET.
R$ 500,00   R$500,00   11/08/26 a 09/09/26
OUT.   R$ 404,85   Esta Fatura   10/09/26 a 08/10/26
NOV.   R$ 200,00   Fatura Aberta   09/10/26 a 09/11/26
Detalhamento da Fatura
TITULAR EXEMPLO - 5480 XXXX XXXX 3303
Pagamento e Demais Créditos
Compra   Data   Descrição   Parcela   R$   US$
10/09 PAGAMENTO DE FATURA-INTERNET   -500,00
Parcelamentos
Compra   Data   Descrição   Parcela   R$   US$
3   17/07 LOJA TESTE 6   03/03   100,00
Despesas
Compra   Data   Descrição   Parcela   R$   US$
05/10 TARIFA TESTE   10,00
VALOR TOTAL   110,00   0,00
@ TITULAR EXEMPLO - 5480 XXXX XXXX 8556
Despesas
09/09 FACEBK *ABC123   35,48 EURO   228,26   41,95
COTAÇÃO DOLAR R$ 5,4412
IOF DESPESA NO EXTERIOR   7,99
10/09 OPENAI   28,31   5,19
COTAÇÃO DOLAR R$ 5,4544
IOF DESPESA NO EXTERIOR   0,99
10/09 OPENAI   28,31   5,19
IOF DESPESA NO EXTERIOR   0,99
VALOR TOTAL   294,85   10,38
Resumo da Fatura
Descrição   R$   US$
Saldo Anterior   500,00
(+) Total Despesas/Débitos no Brasil   119,97
(+) Total Despesas/Débitos no Exterior   284,88   10,38
(-) Total de pagamentos   500,00
(-) Total de créditos   0,00
(=) Saldo Desta Fatura   404,85
`;
const doc = (name: string) => ({ document: { id: 'fatura', mime_type: 'application/pdf', filename: name }, });

test('fatura em anexo: lê o PDF, cartão novo pede o cadastro, "lançar fatura em anexo em cartão de crédito" lança no cartão certo', async () => {
  const phone = '+5534991110004';
  const c = await conta('fatura-wa@exemplo.com', 'midia-fat-01', 'desbravador', phone);
  withKeys();
  pdfText = FATURA;
  // o extrato de setembro já está na conta, com o pagamento da fatura como uma saída comum
  await c('POST', '/api/account/entries', { body: { entries: [{ date: '2026-09-10', amountCents: -50_000, note: 'PAGAMENTO DE BOLETO BANCO EXEMPLO', source: 'import' }] } });

  sent.length = 0;
  await say(phone, 'lançar fatura em anexo em cartão de crédito');
  assert.match(last(), /Não achei o valor/, 'só o texto, sem anexo, não tem o que lançar');

  sent.length = 0;
  await say(phone, null, { document: { id: 'fatura', mime_type: 'application/pdf', filename: 'fatura.pdf', caption: 'lançar fatura em anexo em cartão de crédito' } });
  assert.match(last(), /Li a fatura Banco Exemplo Elite Mastercard \(final 3303\): 5 compras/);
  assert.match(last(), /quitou a fatura de setembro/);
  assert.match(last(), /ainda não está cadastrado/);
  assert.equal((await db.query(`SELECT 1 FROM app.credit_cards`)).rows.length, 0, 'não cadastra sem a pessoa pedir');

  await say(phone, 'cadastrar');
  assert.match(sent.at(-2)!.text, /Cartão Banco Exemplo Elite Mastercard cadastrado/);
  assert.match(last(), /Fatura lançada no cartão Banco Exemplo Elite Mastercard: 5 compras novas/);
  assert.match(last(), /pagamento\(s\) da fatura anterior ligado\(s\) ao extrato/);
  const card = (await db.query<{ limit_cents: string; closing_day: number; due_day: number; last4: string }>(`SELECT limit_cents::text, closing_day, due_day, last4 FROM app.credit_cards`)).rows[0]!;
  assert.deepEqual([card.limit_cents, card.closing_day, card.due_day, card.last4], ['4406000', 9, 16, '3303']);
  assert.equal(await count(`transfer_kind = 'card_payment'`), 1, 'o pagamento da fatura no extrato deixou de ser gasto');
  assert.equal(await count(`card_id IS NOT NULL`), 5);

  // a mesma fatura de novo, com a instrução junto: reconhece o cartão e não duplica
  sent.length = 0;
  await say(phone, null, { document: { id: 'fatura', mime_type: 'application/pdf', filename: 'fatura.pdf', caption: 'lançar fatura em anexo em cartão de crédito' } });
  assert.match(last(), /Fatura lançada no cartão Banco Exemplo Elite Mastercard: 0 compras novas, 5 já estavam lançadas/);
  assert.equal(await count(`card_id IS NOT NULL`), 5);
});

test('fatura em anexo: sem instrução pergunta antes; soma que não bate avisa; outros arquivos e o plano Controle são tratados com clareza', async () => {
  const phone = '+5534991110005';
  await conta('fatura-wa2@exemplo.com', 'midia-fat-02', 'desbravador', phone);
  withKeys();
  pdfText = FATURA;
  await say(phone, null, doc('fatura.pdf'));
  assert.match(last(), /Responda CADASTRAR/);
  await say(phone, 'cadastrar');
  assert.match(last(), /Fatura lançada/);

  // soma diferente do total da fatura: não lança sozinho, mesmo com a instrução
  pdfText = FATURA.replace('05/10 TARIFA TESTE   10,00', '05/10 TARIFA TESTE   12,00');
  sent.length = 0;
  await say(phone, null, { document: { id: 'fatura', mime_type: 'application/pdf', filename: 'fatura.pdf', caption: 'lançar fatura' } });
  assert.match(last(), /não bate com o que a fatura informa/);
  assert.match(last(), /Responda LANÇAR/);
  await say(phone, 'cancelar');
  assert.match(last(), /descartei/);

  pdfText = 'Receita de bolo: 3 ovos e 2 xícaras de farinha';
  await say(phone, null, { document: { id: 'fatura', mime_type: 'application/pdf', filename: 'bolo.pdf', caption: 'lançar' } });
  assert.match(last(), /Não achei uma fatura de cartão/);
  pdfText = 'Extrato de conta corrente\nAgência 0001 Conta 12345-6\nSaldo anterior 1.000,00\n10/09 PIX RECEBIDO 500,00\nSaldo final 1.500,00';
  await say(phone, null, doc('extrato.pdf'));
  assert.match(last(), /parece um extrato de conta/);

  await say(phone, null, { document: { id: 'fatura', mime_type: 'text/plain', filename: 'nota.txt' } });
  assert.match(last(), /só leio PDF de fatura/);

  // plano Controle não tem cartões: a leitura acontece, a importação é recusada com a mensagem do plano
  await conta('fatura-wa3@exemplo.com', 'midia-fat-03', 'controle', '+5534991110006');
  pdfText = FATURA;
  await say('+5534991110006', null, doc('fatura.pdf'));
  await say('+5534991110006', 'cadastrar');
  assert.match(last(), /plano acima do seu/);
});

test('mídia: sem chave da IA o PDF avisa; vídeo e figurinha recebem uma explicação; o limite diário de áudios vale', async () => {
  const phone = '+5534991110007';
  await conta('limite@exemplo.com', 'midia-lim-01', 'controle', phone);
  sent.length = 0;
  await say(phone, null, doc('f.pdf'));
  assert.match(last(), /Ainda não consigo ler PDF/);
  await say(phone, null, { video: { id: 'foto', mime_type: 'video/mp4' } });
  assert.match(last(), /texto, áudio, foto de cupom e o PDF/);
  await say(phone, null, { sticker: { id: 'foto', mime_type: 'image/webp' } });
  assert.match(last(), /texto, áudio, foto de cupom e o PDF/);

  withKeys();
  heardText = 'cafe 3';
  const person = (await db.query<{ id: string }>(`SELECT id FROM app.subscribers WHERE email = 'limite@exemplo.com'`)).rows[0]!.id;
  await db.query(`INSERT INTO app.assistant_media_log(subscriber_id, kind) SELECT $1, 'audio' FROM generate_series(1, 40)`, [person]);
  sent.length = 0;
  await say(phone, null, { audio: { id: 'voz', mime_type: 'audio/ogg' } });
  assert.match(last(), /Você já usou os áudios de hoje/);
});
