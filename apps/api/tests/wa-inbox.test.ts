// Caixa de entrada completa de WhatsApp: arquivos (foto, áudio, documento), encaminhar, número novo, perfis e a caixa do número do Fôlego (Bird).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { classicToEvent } from '../src/bird.ts';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPgliteDb, ensureSchema } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { MemorySender } from '../src/email.ts';
import { WaError } from '../src/whatsapp.ts';
import type { WaTransport } from '../src/whatsapp.ts';
import { signedMediaUrl } from '../src/wa-media.ts';
import { HOUSE_PARTNER_ID, BirdWaTransport } from '../src/wa-bird.ts';

const ADMIN = 'token-do-administrador-com-32-caracteres!';
const APP_SECRET = 'segredo-do-app-da-meta-123456';
const BIRD_RAW = Buffer.from('segredo-do-webhook-da-bird-0123456789');
const NUM = '1099887766';
const PW = 'Senha-Forte-2026';

let db: Db;
let app: FastifyInstance;
const mailbox = new MemorySender();
const config = {
  ...loadConfig({ NODE_ENV: 'test' }),
  webhookSecret: 'segredo-de-teste', leadsEnabled: true, partnerAdminToken: ADMIN, adminEmails: ['dono@exemplo.com'],
  bird: { apiKey: 'bk_test_0123456789012345', from: '+5511913792370', baseUrl: 'http://bird.invalid', template: 'folego-indicacao-prumo', language: 'pt-BR', webhookSecret: `whsec_${BIRD_RAW.toString('base64')}`, classic: false, workspaceId: 'ws-teste', channelId: 'canal-teste', inviteProjectId: 'proj-teste', inviteVersion: 'ver-teste' },
};

const sentText: { to: string; text: string; from: string; ref?: string | undefined }[] = [];
const sentMedia: { to: string; kind: string; mime: string; filename: string | null; caption: string; size: number; voice: boolean; url: string; from: string }[] = [];
const profileEdits: Record<string, unknown>[] = [];
const photos: { size: number; mime: string }[] = [];
const downloads: Record<string, { bytes: Buffer; mime: string }> = {};
let counter = 0;
const fake: WaTransport = {
  async sendText(c, to, text) { sentText.push({ to, text, from: c.phoneNumberId, ref: c.ref }); return { id: `wamid.t${(counter += 1)}` }; },
  async sendTemplate() { return { id: `wamid.p${(counter += 1)}` }; },
  async profile() { return { displayPhone: '+55 41 97425-502', verifiedName: 'Euro Teste' }; },
  async sendMedia(c, to, m) { sentMedia.push({ to, kind: m.kind, mime: m.mime, filename: m.filename, caption: m.caption, size: m.bytes.length, voice: m.voice, url: m.publicUrl, from: c.phoneNumberId }); return { id: `wamid.m${(counter += 1)}` }; },
  async downloadMedia(_c, ref) { const f = downloads[ref.id ?? ref.url ?? '']; if (!f) throw new WaError('Arquivo não encontrado.', 404, null); return f; },
  async getBusinessProfile() { return { about: 'Crédito consignado', description: 'Euro Multiplan', email: 'euro@exemplo.com', websites: ['https://exemplo.com'], address: 'Curitiba', vertical: 'FINANCE', photoUrl: null }; },
  async updateBusinessProfile(_c, p) { profileEdits.push(p as Record<string, unknown>); },
  async setBusinessPhoto(_c, bytes, mime) { photos.push({ size: bytes.length, mime }); },
};

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(80, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(80, 3)]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(60, 5)]);
const DOCX = Buffer.concat([Buffer.from('PK'), Buffer.alloc(60, 9)]);

before(async () => {
  db = await createPgliteDb();
  await ensureSchema(db);
  await db.query(`DELETE FROM app.partner_campaigns`);
  await db.query(`DELETE FROM app.partner_users`);
  await db.query(`DELETE FROM app.partners WHERE NOT internal`);
  app = await buildApp({ config, db, gateway: new FakeGateway(config.webhookSecret), email: mailbox, whatsapp: fake, rateLimits: 'relaxed' });
});
after(async () => {
  await app.close();
  await db.close();
});

async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, opts: { body?: unknown; headers?: Record<string, string>; raw?: string | Buffer; ctype?: string } = {}) {
  const hasBody = opts.body !== undefined || opts.raw !== undefined;
  const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(hasBody ? { 'content-type': opts.ctype ?? 'application/json' } : {}), ...opts.headers }, payload: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
  let json: any = null;
  try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
  return { status: res.statusCode, json, text: res.body, raw: res.rawPayload, headers: res.headers };
}

async function newPartner(email: string, cnpj: string) {
  const c = await call('POST', '/api/admin/partners', { headers: { 'x-admin-token': ADMIN }, body: { legalName: `Parceiro ${email}`, cnpj, category: 'consignado', email, campaign: { name: 'Campanha portal', consentCategory: 'consignado', pricePerLeadCents: 0, dailyCap: 20 } } });
  assert.equal(c.status, 201);
  const l = await call('POST', '/api/partner/login', { body: { email, password: c.json.password } });
  return { id: c.json.partnerId as string, auth: { authorization: `Bearer ${l.json.token}` } };
}
const upload = (auth: Record<string, string>, bytes: Buffer, mime: string, filename: string, purpose?: string) =>
  call('POST', '/api/partner/wa/media', { headers: { ...auth, 'x-mime': mime, 'x-filename': encodeURIComponent(filename), ...(purpose ? { 'x-purpose': purpose } : {}) }, raw: bytes, ctype: 'application/octet-stream' });
const metaHook = (partnerId: string, body: unknown) => {
  const raw = JSON.stringify(body);
  return call('POST', `/webhooks/whatsapp/${partnerId}`, { raw, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}` } });
};
const textIn = (from: string, text: string, id: string) => ({ entry: [{ changes: [{ value: { metadata: { phone_number_id: NUM }, contacts: [{ profile: { name: 'Contato' } }], messages: [{ id, from, type: 'text', text: { body: text } }] } }] }] });
const NOBODY = '00000000-0000-7000-8000-000000000000';

let P: { id: string; auth: { authorization: string } };
let t1 = '';
let t2 = '';
let imageMsgId = '';
let avatarId = '';

test('parceiro: abre conversa, envia foto, voz, PDF e Word; confere tipo, tamanho e conteúdo do arquivo', async () => {
  P = await newPartner('inbox@parceiro.test', '11222333000181');
  const saved = await call('PUT', '/api/partner/wa/account', { headers: P.auth, body: { phoneNumberId: NUM, token: 'EAAG-token-permanente-de-teste-1234567890', appSecret: APP_SECRET, quietStart: 0, quietEnd: 0 } });
  assert.equal(saved.status, 200);
  assert.equal((await metaHook(P.id, textIn('5541999990001', 'oi, quero saber do consignado', 'wamid.in1'))).status, 200);
  const list = await call('GET', '/api/partner/wa/threads', { headers: P.auth });
  t1 = list.json.items[0].id;

  const png = await upload(P.auth, PNG, 'image/png', 'foto.png');
  assert.equal(png.status, 201, png.text);
  assert.equal(png.json.kind, 'image');
  const sent = await call('POST', `/api/partner/wa/threads/${t1}/messages`, { headers: P.auth, body: { mediaId: png.json.id, caption: 'Segue a simulação' } });
  assert.equal(sent.status, 200, sent.text);
  assert.deepEqual([sentMedia[0]!.kind, sentMedia[0]!.mime, sentMedia[0]!.caption, sentMedia[0]!.size, sentMedia[0]!.to], ['image', 'image/png', 'Segue a simulação', PNG.length, '5541999990001']);

  // o arquivo volta idêntico, só para o dono (outro parceiro não abre)
  const back = await call('GET', `/api/partner/wa/media/${png.json.id}`, { headers: P.auth });
  assert.equal(back.status, 200);
  assert.equal(Buffer.compare(back.raw, PNG), 0);
  assert.equal(back.headers['content-type'], 'image/png');
  assert.equal(back.headers['x-content-type-options'], 'nosniff');
  const other = await newPartner('outro@parceiro.test', '45723174000110');
  assert.equal((await call('GET', `/api/partner/wa/media/${png.json.id}`, { headers: other.auth })).status, 404, 'isolamento entre parceiros');

  const voice = await upload(P.auth, OGG, 'audio/ogg; codecs=opus', 'voz.ogg');
  assert.equal(voice.json.kind, 'audio');
  await call('POST', `/api/partner/wa/threads/${t1}/messages`, { headers: P.auth, body: { mediaId: voice.json.id, voice: true } });
  assert.deepEqual([sentMedia[1]!.kind, sentMedia[1]!.voice, sentMedia[1]!.caption], ['audio', true, '']);

  const pdf = await upload(P.auth, PDF, 'application/pdf', 'proposta.pdf');
  await call('POST', `/api/partner/wa/threads/${t1}/messages`, { headers: P.auth, body: { mediaId: pdf.json.id, caption: 'Proposta' } });
  assert.deepEqual([sentMedia[2]!.kind, sentMedia[2]!.filename], ['document', 'proposta.pdf']);
  const docx = await upload(P.auth, DOCX, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'contrato.docx');
  assert.equal(docx.status, 201);
  await call('POST', `/api/partner/wa/threads/${t1}/messages`, { headers: P.auth, body: { mediaId: docx.json.id } });
  assert.equal(sentMedia[3]!.kind, 'document');

  // recusas com explicação
  assert.equal((await upload(P.auth, OGG, 'audio/webm', 'voz.webm')).json.error, 'audio_format', 'WebM não é aceito pelo WhatsApp');
  assert.equal((await upload(P.auth, Buffer.from('MZ-executavel'), 'image/jpeg', 'foto.jpg')).json.error, 'file_corrupt', 'conteúdo diferente do tipo');
  assert.equal((await upload(P.auth, Buffer.from('a,b'), 'text/csv', 'planilha.csv')).json.error, 'file_type');
  const big = Buffer.concat([JPG, Buffer.alloc(6 * 1024 * 1024, 1)]);
  assert.equal((await upload(P.auth, big, 'image/jpeg', 'grande.jpg')).json.error, 'file_too_big', 'foto passa de 5 MB');

  // o histórico mostra o anexo, a legenda e o tipo
  const d = await call('GET', `/api/partner/wa/threads/${t1}`, { headers: P.auth });
  const img = d.json.messages.find((m: any) => m.kind === 'image');
  assert.equal(img.text, 'Segue a simulação');
  assert.equal(img.media.id, png.json.id);
  const prev = (await call('GET', '/api/partner/wa/threads', { headers: P.auth })).json.items.find((t: any) => t.id === t1);
  assert.match(prev.preview, /^(Documento|Áudio|Foto)/);
});

test('parceiro: foto e áudio que chegam do cliente são baixados e guardados', async () => {
  downloads['meta-img-1'] = { bytes: JPG, mime: 'image/jpeg' };
  downloads['meta-aud-1'] = { bytes: OGG, mime: 'audio/ogg; codecs=opus' };
  const body = { entry: [{ changes: [{ value: { metadata: { phone_number_id: NUM }, contacts: [{ profile: { name: 'Contato' } }], messages: [
    { id: 'wamid.in2', from: '5541999990001', type: 'image', image: { id: 'meta-img-1', mime_type: 'image/jpeg', caption: 'meu holerite' } },
    { id: 'wamid.in3', from: '5541999990001', type: 'audio', audio: { id: 'meta-aud-1', mime_type: 'audio/ogg', voice: true } },
    { id: 'wamid.in4', from: '5541999990001', type: 'image', image: { id: 'nao-existe', mime_type: 'image/jpeg' } },
  ] } }] }] };
  assert.equal((await metaHook(P.id, body)).status, 200);
  assert.equal((await metaHook(P.id, body)).status, 200, 'a Meta reenvia: sem duplicar');
  const d = await call('GET', `/api/partner/wa/threads/${t1}`, { headers: P.auth });
  const inbound = d.json.messages.filter((m: any) => m.direction === 'in');
  assert.equal(inbound.length, 4, 'texto + 3 novas, sem duplicar');
  const img = inbound.find((m: any) => m.kind === 'image' && m.text === 'meu holerite');
  imageMsgId = img.id;
  const file = await call('GET', `/api/partner/wa/media/${img.media.id}`, { headers: P.auth });
  assert.equal(Buffer.compare(file.raw, JPG), 0);
  const voice = inbound.find((m: any) => m.kind === 'audio');
  assert.equal(voice.voice, true);
  assert.ok(voice.media.id);
  const broken = inbound.filter((m: any) => m.kind === 'image').find((m: any) => !m.media);
  assert.match(broken.text, /não consegui baixá-lo/i, 'falha ao baixar não perde a mensagem');
  assert.equal(d.json.windowOpen, true);
});

test('parceiro: número novo, encaminhar (respeita a janela de 24 h) e perfil do contato', async () => {
  assert.equal((await call('POST', '/api/partner/wa/threads/new', { headers: P.auth, body: { phone: '123' } })).status, 400);
  assert.equal((await call('POST', '/api/partner/wa/threads/new', { headers: P.auth, body: { phone: '(00) 12345-0000' } })).json.error, 'invalid_phone');
  const added = await call('POST', '/api/partner/wa/threads/new', { headers: P.auth, body: { phone: '(41) 98888-7777', name: 'Novo Contato', optin: true } });
  assert.equal(added.status, 200, added.text);
  t2 = added.json.threadId;
  assert.equal(added.json.windowOpen, false);
  const d2 = await call('GET', `/api/partner/wa/threads/${t2}`, { headers: P.auth });
  assert.deepEqual([d2.json.name, d2.json.optin, d2.json.canTemplate], ['Novo Contato', true, true]);
  assert.equal((await call('POST', '/api/partner/wa/threads/new', { headers: P.auth, body: { phone: '41988887777' } })).json.threadId, t2, 'o mesmo número é a mesma conversa');

  // contato que escreve abre a janela: recebe o encaminhamento; o que está com janela fechada não recebe
  await metaHook(P.id, textIn('5541977776666', 'olá', 'wamid.in5'));
  const open = (await call('GET', '/api/partner/wa/threads', { headers: P.auth })).json.items.find((t: any) => t.id !== t1 && t.id !== t2);
  const before = sentMedia.length;
  const fw = await call('POST', `/api/partner/wa/threads/${t1}/forward`, { headers: P.auth, body: { messageIds: [imageMsgId], threadIds: [open.id, t2] } });
  assert.equal(fw.status, 200, fw.text);
  const byId = Object.fromEntries(fw.json.results.map((r: any) => [r.threadId, r]));
  assert.equal(byId[open.id].sent, 1);
  assert.equal(byId[t2].sent, 0);
  assert.match(byId[t2].skipped, /24 h/);
  assert.equal(sentMedia.length, before + 1);
  assert.equal(sentMedia.at(-1)!.kind, 'image');
  assert.equal(sentMedia.at(-1)!.to, '5541977776666');
  const fwdMsg = (await call('GET', `/api/partner/wa/threads/${open.id}`, { headers: P.auth })).json.messages.find((m: any) => m.forwarded);
  assert.ok(fwdMsg, 'a mensagem encaminhada fica marcada');
  assert.equal((await call('POST', `/api/partner/wa/threads/${t1}/forward`, { headers: P.auth, body: { messageIds: [imageMsgId], threadIds: [t1, t1, t1, t1, t1, t1] } })).status, 400, 'no máximo 5 conversas');

  // perfil: nome, observações e foto (só no painel)
  const av = await upload(P.auth, JPG, 'image/jpeg', 'rosto.jpg', 'avatar');
  avatarId = av.json.id;
  const saved = await call('PATCH', `/api/partner/wa/threads/${t1}/profile`, { headers: P.auth, body: { name: 'Maria Souza', notes: 'cliente quente, prefere ligação à tarde', avatarMediaId: avatarId } });
  assert.equal(saved.status, 200, saved.text);
  const d1 = (await call('GET', `/api/partner/wa/threads/${t1}`, { headers: P.auth })).json;
  assert.deepEqual([d1.name, d1.notes, d1.avatarMediaId], ['Maria Souza', 'cliente quente, prefere ligação à tarde', avatarId]);
  assert.equal(Buffer.compare((await call('GET', `/api/partner/wa/media/${avatarId}`, { headers: P.auth })).raw, JPG), 0);
  assert.equal((await call('PATCH', `/api/partner/wa/threads/${t1}/profile`, { headers: P.auth, body: { avatarMediaId: NOBODY } })).status, 404, 'foto de perfil precisa ser deste parceiro');
  // as observações não ficam em texto puro no banco
  const raw = await db.query<{ notes_enc: Buffer }>(`SELECT notes_enc FROM app.wa_threads WHERE id = $1`, [t1]);
  assert.equal(Buffer.from(raw.rows[0]!.notes_enc).includes('cliente quente'), false);
});

test('parceiro: perfil da empresa (descrição, e-mail, site) e foto do perfil pela Meta', async () => {
  const p = await call('GET', '/api/partner/wa/business-profile', { headers: P.auth });
  assert.equal(p.json.editable, true);
  assert.equal(p.json.description, 'Euro Multiplan');
  assert.equal(p.json.photoEditable, false, 'sem o ID do app não dá para trocar a foto');
  assert.equal((await call('PUT', '/api/partner/wa/business-profile', { headers: P.auth, body: { email: 'nao-e-email' } })).status, 400);
  const up = await call('PUT', '/api/partner/wa/business-profile', { headers: P.auth, body: { about: 'Consignado sem enrolação', websites: ['https://euro.exemplo.com'], address: 'Curitiba, PR' } });
  assert.equal(up.status, 200, up.text);
  assert.deepEqual(profileEdits[0], { about: 'Consignado sem enrolação', websites: ['https://euro.exemplo.com'], address: 'Curitiba, PR' });
  const photo = await upload(P.auth, JPG, 'image/jpeg', 'logo.jpg', 'avatar');
  assert.equal((await call('PUT', '/api/partner/wa/account', { headers: P.auth, body: { appId: '123456789012' } })).json.appId, '123456789012');
  const set = await call('PUT', '/api/partner/wa/business-profile/photo', { headers: P.auth, body: { mediaId: photo.json.id } });
  assert.equal(set.status, 200, set.text);
  assert.deepEqual(photos[0], { size: JPG.length, mime: 'image/jpeg' });
});

test('adaptador da Bird clássica: texto e modelo pelo projeto/versão, chave AccessKey e destinatário em receiver', async () => {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'cls_1', status: 'accepted' }), { status: 202, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const cfg = { ...config.bird!, classic: true, baseUrl: 'https://api.bird.test', workspaceId: 'ws-1', channelId: 'ch-1', apiKey: 'GZchaveantigadeteste1234567' };
  const t = new BirdWaTransport(cfg, f);
  const cred = { phoneNumberId: '+5511913792370', token: '', provider: 'bird' as const, ref: 'ref-9' };

  assert.equal((await t.sendText(cred, '5534998375296', 'Olá')).id, 'cls_1');
  assert.equal(calls[0]!.url, 'https://api.bird.test/workspaces/ws-1/channels/ch-1/messages');
  assert.equal(calls[0]!.headers.authorization, 'AccessKey GZchaveantigadeteste1234567');
  assert.deepEqual(calls[0]!.body, { receiver: { contacts: [{ identifierValue: '+5534998375296', identifierKey: 'phonenumber' }] }, body: { type: 'text', text: { text: 'Olá' } }, reference: 'ref-9' });

  await t.sendTemplate(cred, '5534998375296', { name: 'folego-retorno-chatbot', language: 'pt_BR', params: ['Ana'], paramNames: ['nome_do_cliente'], birdProjectId: 'p-1', birdVersion: 'v-1' });
  assert.deepEqual(calls[1]!.body.template, { projectId: 'p-1', version: 'v-1', locale: 'pt-BR', parameters: [{ type: 'string', key: 'nome_do_cliente', value: 'Ana' }] });

  await assert.rejects(() => t.sendTemplate(cred, '5534998375296', { name: 'sem-id', language: 'pt_BR', params: [] }), /ID do projeto/);
  assert.equal(calls.length, 2, 'sem o ID do projeto nem chama a Bird');
});

test('adaptador da Bird: se o identificador ou as variáveis não batem (422), tenta sublinhado e variáveis numeradas antes de desistir', async () => {
  const bodies: any[] = [];
  const f = (async (_url: string, init: { body?: string }) => {
    const b = JSON.parse(init.body ?? '{}');
    bodies.push(b);
    const okSlug = b.template.slug === 'folego_retorno_chatbot';
    const named = Boolean(b.template.components?.[0]?.parameters?.[0]?.name);
    if (okSlug && !named) return new Response(JSON.stringify({ id: 'wam_ok' }), { status: 202, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ message: 'template slug or parameters do not match' }), { status: 422 });
  }) as unknown as typeof fetch;
  const t = new BirdWaTransport(config.bird, f);
  const cred = { phoneNumberId: '+5511913792370', token: '', provider: 'bird' as const, ref: 'r' };
  const r = await t.sendTemplate(cred, '5541999990009', { name: 'folego-retorno-chatbot', language: 'pt_BR', params: ['Fausto'], paramNames: ['nome_do_cliente'] });
  assert.equal(r.id, 'wam_ok');
  assert.ok(bodies.length >= 2 && bodies.length <= 4, `tentou ${bodies.length} formas`);
  // nenhuma forma serve: devolve o primeiro erro, sem esconder
  const ruim = new BirdWaTransport(config.bird, (async () => new Response('{"message":"slug not in catalogue"}', { status: 422 })) as unknown as typeof fetch);
  await assert.rejects(() => ruim.sendTemplate(cred, '5541999990009', { name: 'x-y', language: 'pt_BR', params: [] }), /422.*catalogue/);
  // erro que não é 422 (ex.: 402 sem saldo) não repete a tentativa
  let n = 0;
  const semSaldo = new BirdWaTransport(config.bird, (async () => { n += 1; return new Response('{"message":"no wallet balance"}', { status: 402 }); }) as unknown as typeof fetch);
  await assert.rejects(() => semSaldo.sendTemplate(cred, '5541999990009', { name: 'x-y', language: 'pt_BR', params: [] }), /402/);
  assert.equal(n, 1);
});

test('adaptador da Bird: pedidos de texto, modelo nomeado e mídia; baixa a mídia sem repassar a chave ao endereço assinado', async () => {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: string, init: { headers?: Record<string, string>; body?: string; redirect?: string }) => {
    calls.push({ url: String(url), headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null });
    if (String(url).startsWith('https://platform.bird.com/v1/whatsapp/messages/wam_9/media/')) return new Response(null, { status: 302, headers: { location: 'https://files.example.com/assinado?x=1' } });
    if (String(url).startsWith('https://files.example.com/')) return new Response(JPG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return new Response(JSON.stringify({ id: 'wam_77', status: 'accepted' }), { status: 202, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const t = new BirdWaTransport(config.bird, f);
  const cred = { phoneNumberId: '+5511913792370', token: '', provider: 'bird' as const, ref: 'ref-1' };

  assert.equal((await t.sendText(cred, '5541999990009', 'Olá')).id, 'wam_77');
  assert.equal(calls[0]!.url, 'http://bird.invalid/v1/whatsapp/messages');
  assert.equal(calls[0]!.headers.authorization, 'Bearer bk_test_0123456789012345');
  assert.deepEqual(calls[0]!.body, { from: '+5511913792370', to: '+5541999990009', text: { body: 'Olá' }, metadata: { ref: 'ref-1' } });

  await t.sendTemplate(cred, '5541999990009', { name: 'folego-indicacao-prumo', language: 'pt_BR', params: ['José Pereira', 'Carlos Alberto', 'abc23xyz'], paramNames: ['nome_do_assinante', 'nome_da_indicacao', 'codigo'] });
  assert.deepEqual(calls[1]!.body.template, { slug: 'folego-indicacao-prumo', language: 'pt-BR', components: [{ type: 'body', parameters: [{ type: 'text', name: 'nome_do_assinante', text: 'José Pereira' }, { type: 'text', name: 'nome_da_indicacao', text: 'Carlos Alberto' }, { type: 'text', name: 'codigo', text: 'abc23xyz' }] }] });

  await t.sendMedia(cred, '5541999990009', { kind: 'audio', mime: 'audio/ogg', filename: 'voz.ogg', caption: '', bytes: OGG, publicUrl: 'https://folego.online/wa-media/x?e=1&s=2', voice: true });
  assert.deepEqual(calls[2]!.body.audio, { url: 'https://folego.online/wa-media/x?e=1&s=2', voice: true });
  await t.sendMedia(cred, '5541999990009', { kind: 'document', mime: 'application/pdf', filename: 'guia.pdf', caption: 'Guia', bytes: PDF, publicUrl: 'https://folego.online/wa-media/y?e=1&s=2', voice: false });
  assert.deepEqual(calls[3]!.body.document, { url: 'https://folego.online/wa-media/y?e=1&s=2', caption: 'Guia', filename: 'guia.pdf' });

  const got = await t.downloadMedia(cred, { url: 'https://platform.bird.com/v1/whatsapp/messages/wam_9/media/waf_1' });
  assert.equal(Buffer.compare(got.bytes, JPG), 0);
  assert.equal(got.mime, 'image/jpeg');
  const first = calls.find((c) => c.url.startsWith('https://platform.bird.com/v1/whatsapp/messages/wam_9'))!;
  const second = calls.find((c) => c.url.startsWith('https://files.example.com/'))!;
  assert.equal(first.headers.authorization, 'Bearer bk_test_0123456789012345');
  assert.equal(second.headers.authorization, undefined, 'o endereço assinado não pode receber a chave');
  await assert.rejects(() => t.downloadMedia(cred, { url: 'http://inseguro.example.com/x' }), /endereço/);
  await assert.rejects(() => new BirdWaTransport(null, f).sendText(cred, '55', 'x'), /não está configurado/);
});

test('modelos salvos: editar texto e variáveis nomeadas, limpar variáveis e recusar nome repetido', async () => {
  const mk = (name: string) => call('POST', '/api/partner/wa/templates', { headers: P.auth, body: { name, category: 'MARKETING', body: `Olá {{1}}, modelo ${name}.` } });
  const a = await mk('folego-modelo-a');
  await mk('folego-modelo-b');
  assert.equal(a.status, 201, a.text);
  const up = await call('PUT', `/api/partner/wa/templates/${a.json.id}`, { headers: P.auth, body: { body: 'Olá {{1}}, seu código é {{2}}.', paramNames: ['nome_do_cliente', 'codigo'], category: 'UTILITY' } });
  assert.equal(up.status, 200, up.text);
  const row = (await call('GET', '/api/partner/wa/templates', { headers: P.auth })).json.templates.find((t: any) => t.id === a.json.id);
  assert.deepEqual([row.body, row.paramNames, row.category, row.slots, row.name], ['Olá {{1}}, seu código é {{2}}.', ['nome_do_cliente', 'codigo'], 'UTILITY', 2, 'folego-modelo-a']);
  assert.equal((await call('PUT', `/api/partner/wa/templates/${a.json.id}`, { headers: P.auth, body: { paramNames: [] } })).status, 200);
  const cleared = (await call('GET', '/api/partner/wa/templates', { headers: P.auth })).json.templates.find((t: any) => t.id === a.json.id);
  assert.equal(cleared.paramNames, null, 'lista vazia limpa as variáveis nomeadas');
  assert.equal(cleared.body, 'Olá {{1}}, seu código é {{2}}.', 'campos não enviados ficam como estavam');
  assert.equal((await call('PUT', `/api/partner/wa/templates/${a.json.id}`, { headers: P.auth, body: { name: 'folego-modelo-b' } })).json.error, 'duplicate');
  assert.equal((await call('PUT', `/api/partner/wa/templates/${a.json.id}`, { headers: P.auth, body: { name: 'Nome Inválido!' } })).status, 400);
  assert.equal((await call('PUT', `/api/partner/wa/templates/${NOBODY}`, { headers: P.auth, body: { body: 'Olá {{1}}, tudo bem?' } })).status, 404);
});

// ------------------------------------------------------------------------------------------------ backoffice (Bird)
const birdHook = async (event: unknown, secret = BIRD_RAW) => {
  const body = JSON.stringify(event);
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', secret).update(`${id}.${ts}.${body}`).digest('base64');
  const res = await app.inject({ method: 'POST', url: '/webhooks/bird', headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` }, payload: body });
  return res.statusCode;
};

const classicHook = async (event: unknown, key: string, opts: { badSignature?: boolean } = {}) => {
  const body = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  const url = `${config.publicUrl}/webhooks/bird`;
  const sig = createHmac('sha256', key).update(Buffer.concat([Buffer.from(`${ts}\n${url}\n`), createHash('sha256').update(body).digest()])).digest('base64');
  const res = await app.inject({ method: 'POST', url: '/webhooks/bird', headers: { 'content-type': 'application/json', 'messagebird-signature': opts.badSignature ? Buffer.from('x').toString('base64') : sig, 'messagebird-request-timestamp': ts }, payload: body });
  return res.statusCode;
};

test('respostas atrasadas: traz da Bird só as recebidas que o webhook perdeu, com a hora original, sem duplicar', async () => {
  const { backfillBirdInbound } = await import('../src/bird.ts');
  const ctx = { db, config: { ...config, bird: { ...config.bird!, classic: true, baseUrl: 'http://bird.invalid' } } } as unknown as import('../src/services.ts').Ctx;
  const antiga = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ results: [
      { id: 'bf_1', direction: 'incoming', createdAt: antiga, sender: { contact: { identifierValue: '+5511977770001' } }, body: { type: 'text', text: { text: 'Quero saber mais' } } },
      { id: 'bf_2', direction: 'outgoing', createdAt: antiga, receiver: { contacts: [{ identifierValue: '+5511977770001' }] }, body: { type: 'text', text: { text: 'Olá' } } },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  try {
    const r1 = await backfillBirdInbound(ctx, 7);
    assert.deepEqual(r1, { lidas: 2, recebidasNaBird: 1, novas: 1, maisAntiga: antiga });
    assert.match(urls[0]!, /\/workspaces\/[^/]+\/channels\/[^/]+\/messages\?limit=100$/);
    const m = await db.query<{ created_at: Date; last_inbound_at: Date | null; windowOpen: boolean }>(
      `SELECT m.created_at, t.last_inbound_at, (t.last_inbound_at > now() - interval '24 hours') AS "windowOpen" FROM app.wa_messages m JOIN app.wa_threads t ON t.id = m.thread_id WHERE m.wa_id = 'bf_1'`,
    );
    assert.ok(Math.abs(new Date(m.rows[0]!.created_at).getTime() - Date.parse(antiga)) < 1000, 'a mensagem guarda a hora em que o cliente escreveu');
    assert.equal(m.rows[0]!.windowOpen, false, 'resposta de 3 dias atrás não abre a janela de 24 h');
    assert.deepEqual(await backfillBirdInbound(ctx, 7), { lidas: 2, recebidasNaBird: 1, novas: 0, maisAntiga: antiga }, 'rodar de novo não duplica');
  } finally {
    globalThis.fetch = real;
    await db.query(`DELETE FROM app.wa_messages WHERE wa_id = 'bf_1'`);
    await db.query(`DELETE FROM app.wa_threads WHERE partner_id = $1 AND id NOT IN (SELECT thread_id FROM app.wa_messages)`, [HOUSE_PARTNER_ID]);
  }
});

test('Bird clássica: webhook assinado (messagebird-signature) traz a resposta e o andamento da mensagem; assinatura errada é recusada', async () => {
  const key = `whsec_${BIRD_RAW.toString('base64')}`; // o segredo é usado como texto puro nesse formato
  const inbound = { service: 'channels', event: 'whatsapp.inbound', payload: { id: 'cls_in_1', channelId: 'c', sender: { contact: { id: 'x', identifierKey: 'phonenumber', identifierValue: '+5534998375296' } }, body: { type: 'text', text: { text: 'Quanto custa?' } }, direction: 'incoming', status: 'delivered' } };
  assert.equal(await classicHook(inbound, key, { badSignature: true }), 401);
  assert.equal(await classicHook(inbound, key), 200);
  const got = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wa_messages m JOIN app.wa_threads t ON t.id = m.thread_id WHERE m.direction = 'in' AND m.wa_id = 'cls_in_1' AND t.partner_id = $1`, [HOUSE_PARTNER_ID]);
  assert.equal(got.rows[0]!.n, '1', 'a resposta virou mensagem na conversa do número do Fôlego');
  assert.equal(await classicHook(inbound, key), 200);
  assert.equal((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wa_messages WHERE wa_id = 'cls_in_1'`)).rows[0]!.n, '1', 'a repetição do aviso não duplica');

  assert.deepEqual(classicToEvent({ event: 'whatsapp.outbound', payload: { id: 'm1', reference: 'r1', status: 'delivered' } }), { type: 'whatsapp.delivered', data: { id: 'm1', metadata: { ref: 'r1' }, reason: null } });
  assert.equal((classicToEvent({ event: 'whatsapp.outbound', payload: { id: 'm1', status: 'delivery_failed', reason: 'x' } }) as { type: string }).type, 'whatsapp.failed');
  assert.equal((classicToEvent({ event: 'whatsapp.outbound', payload: { id: 'm1', status: 'processing' } }) as { type: string }).type, 'ignorado');

  // Sem chave de assinatura no webhook da Bird, o segredo vai no endereço (?k=): aceito; código errado, recusado.
  const unsigned = JSON.stringify({ service: 'channels', event: 'whatsapp.inbound', payload: { id: 'cls_in_2', sender: { contact: { identifierValue: '+5534998375296' } }, body: { type: 'text', text: { text: 'Pode me ligar?' } } } });
  const post = (k: string) => app.inject({ method: 'POST', url: `/webhooks/bird?k=${encodeURIComponent(k)}`, headers: { 'content-type': 'application/json' }, payload: unsigned });
  assert.equal((await post('codigo-errado-com-mais-de-16-caracteres')).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/webhooks/bird', headers: { 'content-type': 'application/json' }, payload: unsigned })).statusCode, 401, 'sem assinatura e sem código: recusado');
  assert.equal((await post(key)).statusCode, 200);
  assert.equal((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.wa_messages WHERE wa_id = 'cls_in_2'`)).rows[0]!.n, '1', 'a resposta chegou pelo código no endereço');
  await db.query(`DELETE FROM app.wa_messages WHERE wa_id = 'cls_in_2'`);

  // limpa o que este teste criou, para não mudar a contagem dos testes seguintes
  await db.query(`DELETE FROM app.wa_messages WHERE wa_id = 'cls_in_1'`);
  await db.query(`DELETE FROM app.wa_threads WHERE partner_id = $1 AND id NOT IN (SELECT thread_id FROM app.wa_messages)`, [HOUSE_PARTNER_ID]);
});

test('backoffice: caixa do número do Fôlego (Bird) recebe texto e foto, responde, acompanha status e respeita SAIR', async () => {
  // entra como dono (código por e-mail, como nos demais testes do backoffice)
  let cookie = '';
  const adm = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, opts: { body?: unknown; raw?: Buffer; headers?: Record<string, string>; ctype?: string } = {}) => {
    const hasBody = opts.body !== undefined || opts.raw !== undefined;
    const res = await app.inject({ method, url, headers: { 'x-folego': '1', ...(hasBody ? { 'content-type': opts.ctype ?? 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...opts.headers }, payload: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
    const set = res.headers['set-cookie'];
    const c = Array.isArray(set) ? set[0] : set;
    if (c) cookie = c.split(';')[0]!;
    let json: any = null;
    try { json = res.body ? JSON.parse(res.body) : null; } catch { json = null; }
    return { status: res.statusCode, json, raw: res.rawPayload, headers: res.headers };
  };
  assert.equal((await adm('GET', '/api/gestao/wa/account')).status, 401, 'sem login não entra');
  mailbox.sent.length = 0;
  await adm('POST', '/api/gestao/setup-code', { body: { email: 'dono@exemplo.com' } });
  const code = /\b(\d{6})\b/.exec(mailbox.sent.at(-1)!.text)![1]!;
  await adm('POST', '/api/gestao/setup', { body: { email: 'dono@exemplo.com', code, password: PW } });
  assert.equal((await adm('POST', '/api/gestao/login-password', { body: { email: 'dono@exemplo.com', password: PW } })).status, 200);

  const acc = await adm('GET', '/api/gestao/wa/account');
  assert.equal(acc.json.configured, true);
  assert.equal(acc.json.provider, 'bird');
  assert.equal(acc.json.displayPhone, '+5511913792370');
  assert.equal(acc.json.verifyToken, undefined);
  assert.equal(acc.json.webhookUrl, `${config.publicUrl}/webhooks/bird`);

  // o parceiro interno não aparece na lista de parceiros
  const partners = await adm('GET', '/api/gestao/parcerias/parceiros');
  assert.equal(JSON.stringify(partners.json).includes('Fôlego (interno)'), false);

  // mensagem de texto e foto do cliente (webhook assinado da Bird)
  assert.equal(await birdHook({ type: 'whatsapp.received', timestamp: new Date().toISOString(), data: { id: 'wam_1', from: { phone_number: '+5541999990009' }, display_name: 'Ana Prumo', text: { body: 'Oi, quero saber do Prumo' } } }), 200);
  downloads.waf_1 = { bytes: JPG, mime: 'image/jpeg' };
  assert.equal(await birdHook({ type: 'whatsapp.received', timestamp: new Date().toISOString(), data: { id: 'wam_2', from: { phone_number: '+5541999990009' }, display_name: 'Ana Prumo', image: { id: 'waf_1', url: 'https://platform.bird.com/v1/whatsapp/messages/wam_2/media/waf_1', mime_type: 'image/jpeg', caption: 'comprovante' } } }), 200);
  assert.equal(await birdHook({ type: 'whatsapp.received', timestamp: new Date().toISOString(), data: { id: 'wam_1', from: { phone_number: '+5541999990009' }, text: { body: 'Oi, quero saber do Prumo' } } }), 200, 'reenvio da Bird não duplica');
  const threads = await adm('GET', '/api/gestao/wa/threads');
  assert.equal(threads.json.items.length, 1);
  const th = threads.json.items[0];
  assert.deepEqual([th.name, th.unread, th.windowOpen], ['Ana Prumo', 2, true]);
  assert.equal(th.preview, 'Foto: comprovante');
  const detail = await adm('GET', `/api/gestao/wa/threads/${th.id}`);
  assert.equal(detail.json.messages.length, 2);
  const pic = detail.json.messages.find((m: any) => m.kind === 'image');
  assert.equal(Buffer.compare((await adm('GET', `/api/gestao/wa/media/${pic.media.id}`)).raw, JPG), 0);

  // a equipe responde com texto e com um PDF; o número usado é o do Fôlego
  const reply = await adm('POST', `/api/gestao/wa/threads/${th.id}/messages`, { body: { text: 'Oi, Ana! Posso ajudar.' } });
  assert.equal(reply.status, 200, JSON.stringify(reply.json));
  assert.deepEqual([sentText.at(-1)!.from, sentText.at(-1)!.to, sentText.at(-1)!.text], ['+5511913792370', '5541999990009', 'Oi, Ana! Posso ajudar.']);
  const noLogin = await call('POST', '/api/gestao/wa/media', { headers: { 'x-mime': 'application/pdf', 'x-filename': 'guia.pdf' }, raw: PDF, ctype: 'application/octet-stream' });
  assert.equal(noLogin.status, 401, 'enviar arquivo exige login');
  const pdfUp = await adm('POST', '/api/gestao/wa/media', { raw: PDF, ctype: 'application/octet-stream', headers: { 'x-mime': 'application/pdf', 'x-filename': 'guia.pdf' } });
  assert.equal(pdfUp.status, 201, JSON.stringify(pdfUp.json));
  await adm('POST', `/api/gestao/wa/threads/${th.id}/messages`, { body: { mediaId: pdfUp.json.id, caption: 'Guia do Prumo' } });
  const media = sentMedia.at(-1)!;
  assert.deepEqual([media.kind, media.from, media.to], ['document', '+5511913792370', '5541999990009']);
  // a Bird baixa o arquivo por um link assinado, sem sessão; assinatura errada ou vencida não serve
  const url = new URL(media.url);
  const ok = await app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'application/pdf');
  assert.equal(Buffer.compare(ok.rawPayload, PDF), 0);
  assert.equal((await app.inject({ method: 'GET', url: `${url.pathname}?e=${url.searchParams.get('e')}&s=assinatura-falsa` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: url.pathname })).statusCode, 404);
  const expired = signedMediaUrl({ db, config, gateway: new FakeGateway('x') }, pdfUp.json.id, -10);
  assert.equal((await app.inject({ method: 'GET', url: expired.replace(config.publicUrl, '') })).statusCode, 404, 'link vencido');

  // status: "entregue" e depois "falhou" atrasado não desfaz
  const sentMsg = (await adm('GET', `/api/gestao/wa/threads/${th.id}`)).json.messages.find((m: any) => m.direction === 'out' && m.kind === 'text');
  assert.equal(sentText.at(-1)!.ref, sentMsg.id, 'a Bird recebe a nossa referência para devolver nos avisos');
  assert.equal(await birdHook({ type: 'whatsapp.delivered', timestamp: new Date().toISOString(), data: { id: 'wam_x', metadata: { ref: sentMsg.id } } }), 200);
  assert.equal(await birdHook({ type: 'whatsapp.failed', timestamp: new Date().toISOString(), data: { id: 'wam_x', metadata: { ref: sentMsg.id } } }), 200);
  const after = (await adm('GET', `/api/gestao/wa/threads/${th.id}`)).json.messages.find((m: any) => m.id === sentMsg.id);
  assert.equal(after.status, 'entregue');
  assert.equal(await birdHook({ type: 'whatsapp.received', timestamp: new Date().toISOString(), data: { id: 'wam_9' } }, Buffer.from('outro-segredo-qualquer-0123456789')), 401);

  // SAIR: a conversa vira "não contatar" e nada mais sai
  assert.equal(await birdHook({ type: 'whatsapp.received', timestamp: new Date().toISOString(), data: { id: 'wam_3', from: { phone_number: '+5541999990009' }, text: { body: 'SAIR' } } }), 200);
  const blocked = await adm('POST', `/api/gestao/wa/threads/${th.id}/messages`, { body: { text: 'Mais uma?' } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, 'opted_out');

  // número novo e perfil do contato no backoffice
  const added = await adm('POST', '/api/gestao/wa/threads/new', { body: { phone: '(11) 98888-1111', name: 'Bruno', optin: false } });
  assert.equal(added.status, 200, JSON.stringify(added.json));
  const prof = await adm('PATCH', `/api/gestao/wa/threads/${added.json.threadId}/profile`, { body: { notes: 'indicado pela Ana' } });
  assert.equal(prof.status, 200);
  assert.equal((await adm('GET', `/api/gestao/wa/threads/${added.json.threadId}`)).json.notes, 'indicado pela Ana');
  // o perfil do número é da Bird: aqui só informa
  const bp = await adm('GET', '/api/gestao/wa/business-profile');
  assert.equal(bp.json.editable, false);
  assert.equal((await db.query(`SELECT 1 FROM app.partners WHERE id = $1 AND internal`, [HOUSE_PARTNER_ID])).rows.length, 1);
});
