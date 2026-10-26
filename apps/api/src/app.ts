import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { sendCapi } from './capi.ts';
import staticPlugin from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ZodError, z } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { FakeGateway } from './gateway.ts';
import type { PaymentGateway } from './gateway.ts';
import type { EmailSender } from './email.ts';
import { hmac } from './crypto.ts';
import { AppError, notFound } from './errors.ts';
import * as leads from './leads.ts';
import * as sub from './subscriptions.ts';
import { registerGestao } from './admin/routes.ts';
import * as campaigns from './admin/campaigns.ts';
import * as extras from './account-extras.ts';
import * as push from './push.ts';
import * as vault from './vault.ts';
import * as assistant from './assistant.ts';
import * as avatar from './avatar.ts';
import * as cards from './cards.ts';
import * as trips from './trips.ts';
import * as debts from './account-debts.ts';
import { askPlanner } from './planner.ts';
import * as program from './coach-program.ts';
import * as household from './household.ts';
import * as billing from './billing.ts';
import * as planChange from './plan-change.ts';
import * as accountData from './account-data.ts';
import * as referrals from './referrals.ts';
import { classicToEvent, handleBirdEvent, verifyBirdClassicSignature, verifyBirdSignature, verifyBirdToken } from './bird.ts';
import { loadMedia, mediaHeaders, validMediaSig } from './wa-media.ts';
import { referralWhatsappSchema, FBP_RE, FBC_RE } from './schemas.ts';
import * as insights from './insights.ts';
import { verifyTurnstile, turnstileEnabled } from './turnstile.ts';
import * as chatbot from './chatbot.ts';
import { deepHealth } from './health.ts';
import { eventSchema, recordEvent } from './admin/events.ts';
import { publicCatalog } from './admin/manage.ts';
import * as redo from './redo.ts';
import { mapOffer } from './map-offer.ts';
import * as demoAccounts from './demo.ts';
import { refreshRuntime } from './runtime.ts';
import * as partnerPortal from './partner-portal.ts';
import { contactSchema, sendContact } from './contact.ts';
import * as waPortal from './wa-portal.ts';
import { handleWebhook as handleWhatsAppWebhook, loadAccount, validSignature } from './whatsapp.ts';
import type { WebhookBody } from './whatsapp.ts';
import { cardSchema, cardPatchSchema, cardPurchaseSchema, cardPaymentSchema, cardImportSchema, cardFinanceSchema, walletAnchorSchema, tripSchema, tripCheckSchema, accessSchema, addEntriesSchema, cancelSchema, contributionSchema, createCaseSchema, entryWalletSchema, accountDebtSchema, accountDebtPatchSchema, debtPaymentSchema, monthLimitSchema, plannerSchema, objectiveSchema, inviteSchema, memberAccessSchema, checkoutSchema, profileSchema, referralLeadSchema, referralInviteSchema, recurringDecisionSchema, reminderPatchSchema, reminderSchema, walletSchema, walletPatchSchema, createOrderSchema, emailLinkSchema, emailOnlySchema, goalSchema, incomeInterviewSchema, leadSchema, loginCodeSchema, newPartnerSchema, partnerLoginSchema, partnerStatusSchema, setCategorySchema, categoryNameSchema, setLimitSchema, simulateSchema, subscriptionOrderSchema, toggleIncomeTaskSchema, translationSchema, guidedSchema, uuidParam, monthParam } from './schemas.ts';
import { EngineInputError } from './engine.ts';
import { GUIDED_KINDS } from './guided.ts';
import * as openFinance from './openfinance.ts';
import { CSP } from './security.ts';
import * as svc from './services.ts';
import type { Ctx } from './services.ts';

const SESSION_COOKIE = 'folego_sid';
const MONTH_SECONDS = 30 * 24 * 3600;

export interface AppDeps {
  config: Config;
  db: Db;
  gateway: PaymentGateway;
  /** Sem isto, o envio de e-mail fica desligado. */
  email?: EmailSender;
  /** Ausente = contas conectadas (Open Finance) desligadas. */
  openFinance?: import('./openfinance.ts').OpenFinanceProvider;
  /** Transporte do WhatsApp (ausente = Cloud API da Meta). */
  whatsapp?: import('./whatsapp.ts').WaTransport;
  /** Agente de IA de vendas do WhatsApp (ausente = só atendimento humano). */
  salesAgent?: import('./whatsapp.ts').SalesAgent;
  /** WhatsApp do Fôlego pela Bird (ausente = Bird real se configurada; senão desligado). */
  bird?: import('./bird.ts').BirdTransport;
  /** 'relaxed' só para testes que criam muitas requisições do mesmo IP. */
  rateLimits?: 'strict' | 'relaxed';
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const scale = deps.rateLimits === 'relaxed' ? 1000 : 1;
  const ctx: Ctx = deps;

  const app = Fastify({
    logger: config.env === 'test' ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: config.env === 'production',
    bodyLimit: 64 * 1024,
  });

  const clientIp = (req: FastifyRequest): string => {
    if (config.trustCloudflare) {
      const cf = req.headers['cf-connecting-ip'];
      if (typeof cf === 'string' && cf) return cf;
    }
    return req.ip;
  };
  const ipHash = (req: FastifyRequest): Buffer => hmac(config.secret, clientIp(req));

  // O Gmail/Outlook mandam o descadastro de um clique como formulário (List-Unsubscribe=One-Click): só lemos como texto; a rota usa o token da URL.
  // Upload do eBook (backoffice): o PDF chega cru, até 15 MB. O limite global de 64 KB continua valendo para todo o resto.
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: 16 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  // Arquivos do WhatsApp (foto, áudio, documento): chegam crus como octet-stream, até 16 MB; o tipo real vai no cabeçalho x-mime e é conferido no servidor.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 16 * 1024 * 1024 }, (_req, body, done) => done(null, body));
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, {}));
  await app.register(cookie);
  // PageView para a Meta (IP e navegador do visitante): só com o ACEITE do aviso de cookies (cookie folego_ads=1). Sem aceite, nada sai.
  const ADS_COOKIE = 'folego_ads';
  // Em produção o nginx entrega o HTML direto do disco (a API não vê o GET /), então quem avisa a cada visita é o navegador: POST /api/pageview.
  app.post('/api/pageview', { config: { rateLimit: { max: 60 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { path, eventId, fbp, fbc } = z.strictObject({ path: z.string().max(200).regex(/^\/[^\s]*$/).default('/'), eventId: z.string().uuid().optional(), fbp: FBP_RE.optional(), fbc: FBC_RE.optional() }).parse(req.body ?? {});
    const ck = req.headers.cookie ?? '';
    if (config.metaPageView && config.metaCapiToken && new RegExp(`(?:^|;\\s*)${ADS_COOKIE}=1(?:;|$)`).test(ck)) {
      const ua = req.headers['user-agent'];
      void sendCapi(ctx, { name: 'PageView', eventId: eventId ?? randomUUID(), ip: clientIp(req), userAgent: typeof ua === 'string' ? ua : undefined, url: `${config.publicUrl}${path}`, fbc: fbc ?? /_fbc=([^;]+)/.exec(ck)?.[1], fbp: fbp ?? /_fbp=([^;]+)/.exec(ck)?.[1] });
    }
    return reply.status(204).send();
  });
  await app.register(rateLimit, { global: true, max: 300 * scale, timeWindow: '1 minute', keyGenerator: clientIp });

  // Cabeçalhos comuns e proteção CSRF: toda escrita em /api precisa do cabeçalho x-folego (um formulário de
  // outro site não consegue enviá-lo) além do cookie SameSite=Lax.
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/webhooks/')) {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Referrer-Policy', 'no-referrer');
    }
    const write = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (write && req.url.startsWith('/api/') && !req.url.startsWith('/api/unsubscribe') && req.headers['x-folego'] !== '1') {
      throw new AppError(403, 'csrf', 'Requisição não permitida');
    }
  });

  // Configurações mudadas no backoffice (recursos ligados/desligados, vendas pausadas...) valem sem reiniciar: releitura a cada 10 s.
  // As rotas de conta e de parceiros ficam sempre registradas e respondem "não existe" enquanto o recurso está desligado.
  await refreshRuntime(deps.db, config, true);
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/')) return;
    await refreshRuntime(deps.db, config);
    const path = req.url.split('?')[0] ?? '';
    if (path.startsWith('/api/account') && !config.subscriptionsEnabled) throw notFound();
    if ((path.startsWith('/api/partner') || path === '/api/admin/partners') && !config.leadsEnabled) throw notFound();
  });

  app.setErrorHandler((error: unknown, req, reply) => {
    if (error instanceof AppError) return reply.status(error.status).send({ error: error.code, message: error.message });
    // Entrada que o motor de cálculo recusa (dados incoerentes): é do cliente, não do servidor.
    if (error instanceof EngineInputError) return reply.status(422).send({ error: 'invalid_input', message: 'Os dados informados não fecham. Confira os valores e tente de novo.', issues: error.issues });
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'invalid_input', message: 'Dados inválidos', issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const e = error as { statusCode?: number; code?: string; message?: string };
    // Erros do framework (JSON quebrado, corpo grande...) com mensagem nossa, em português e no mesmo formato.
    if (e.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || e.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') return reply.status(400).send({ error: 'invalid_json', message: 'O corpo da requisição não é um JSON válido.' });
    if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.status(413).send({ error: 'too_large', message: 'A requisição é grande demais.' });
    if (e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return reply.status(415).send({ error: 'unsupported_media', message: 'Tipo de conteúdo não aceito.' });
    // Texto que o banco recusa (caractere nulo, data impossível): é dado inválido do cliente.
    if (typeof e.code === 'string' && ['22021', '22P05', '22007', '22008', '22P02', '22003'].includes(e.code)) return reply.status(400).send({ error: 'invalid_input', message: 'Dados inválidos' });
    if (typeof e.statusCode === 'number' && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.code ?? 'bad_request', message: e.message ?? 'Requisição inválida' });
    req.log.error({ err: error }, 'erro interno');
    return reply.status(500).send({ error: 'internal', message: 'Algo deu errado. Tente de novo.' });
  });

  // Rota inexistente: mesmo formato e idioma dos outros erros (o 404 padrão do framework vaza o texto em inglês).
  // Endereços limpos do site (/conta, /pagamento...) entregam a mesma página; o roteador do navegador escolhe a tela.
  const SITE_PATH = /^\/(diagnostico|processando|resultado|pagamento|mapa|complemento|ferramentas|tradutor|guia|parceiros|conta|descadastrar|acesso)(\/[^?]*)?$/;
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    const send = (reply as unknown as { sendFile?: (f: string) => FastifyReply }).sendFile;
    if (req.method === 'GET' && typeof send === 'function') {
      if (SITE_PATH.test(path)) return send.call(reply, 'index.html');
      if (/^\/gestao\/.+/.test(path)) return send.call(reply, 'gestao/index.html');
    }
    return reply.status(404).send({ error: 'not_found', message: 'Não encontrado' });
  });
  // O caractere nulo (\u0000) quebra o Postgres: recusa na entrada, antes de chegar ao banco.
  app.addHook('preValidation', async (req) => {
    // O tradutor recebe texto de foto (OCR), que pode trazer \u0000: ali o schema limpa o texto em vez de recusar.
    if (req.url.startsWith('/api/translations') || /^\/api\/orders\/[^/]+\/redo\/translation/.test(req.url)) return;
    if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && JSON.stringify(req.body).includes('\\u0000')) {
      throw new AppError(400, 'invalid_input', 'O texto contém um caractere inválido.');
    }
  });

  // ---------- sessão ----------
  const createSession = async (req: FastifyRequest, reply: FastifyReply): Promise<string> => {
    const r = await svc.resolveSession(ctx, req.cookies[SESSION_COOKIE], ipHash(req));
    if (r.newToken) {
      reply.setCookie(SESSION_COOKIE, r.newToken, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: MONTH_SECONDS });
    }
    return r.sessionId;
  };
  const requireSession = async (req: FastifyRequest): Promise<string> => {
    const id = await svc.findSession(ctx, req.cookies[SESSION_COOKIE]);
    if (!id) throw notFound();
    return id;
  };
  const idParam = (value: unknown): string => uuidParam.parse(value);
  const guidedKindParam = z.enum(GUIDED_KINDS);

  // ---------- rotas ----------
  // Saúde "profunda" para o monitoramento externo: banco, worker, fila, webhooks, backup e disco. 503 = algo precisa de atenção.
  app.get('/api/health/deep', async (_req, reply) => {
    const h = await deepHealth(ctx);
    return reply.status(h.ok ? 200 : 503).send(h);
  });
  app.get('/api/health', async () => ({ ok: true, gateway: deps.gateway.name, db: deps.db.dialect, env: config.env }));

  app.post('/api/cases', { config: { rateLimit: { max: 12 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
    await verifyTurnstile(config, req.headers['x-turnstile'], clientIp(req));
    const input = createCaseSchema.parse(req.body);
    const sessionId = await createSession(req, reply);
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const created = await svc.createCase(ctx, { sessionId, ipHash: ipHash(req), input, userAgent });
    return reply.status(201).send(created);
  });

  app.get('/api/cases/:id/preview', async (req) => {
    const sessionId = await requireSession(req);
    return svc.getPreview(ctx, sessionId, idParam((req.params as { id: string }).id));
  });

  app.delete('/api/cases/:id', async (req, reply) => {
    const sessionId = await requireSession(req);
    await svc.deleteCase(ctx, sessionId, idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });

  app.post('/api/orders', { config: { rateLimit: { max: 20 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
    const sessionId = await requireSession(req);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw new AppError(400, 'idempotency_key', 'Cabeçalho Idempotency-Key obrigatório (de 8 a 100 caracteres)');
    const body = createOrderSchema.parse(req.body);
    const order = await svc.createOrder(ctx, { sessionId, caseId: body.caseId, products: body.products ?? ['recovery_map', ...(body.withLetters ? ['defense_letters'] : [])], idempotencyKey: key, contact: body.contact, ip: clientIp(req), userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined });
    return reply.status(201).send(order);
  });

  app.get('/api/orders/:id', async (req) => {
    const sessionId = await requireSession(req);
    return svc.getOrder(ctx, sessionId, idParam((req.params as { id: string }).id));
  });

  app.get('/api/orders/:id/delivery', async (req) => {
    const sessionId = await requireSession(req);
    return svc.getDelivery(ctx, sessionId, idParam((req.params as { id: string }).id));
  });

  // Tradutor de cobrança: o texto é analisado na hora e NÃO é guardado; só o resultado fica (7 dias, ou 30 se pago).
  app.post('/api/translations', { config: { rateLimit: { max: 10 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
    const input = translationSchema.parse(req.body);
    const sessionId = await createSession(req, reply);
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const created = await svc.createTranslation(ctx, { sessionId, ipHash: ipHash(req), text: input.text, userAgent });
    return reply.status(201).send(created);
  });

  // Guias pagos sob medida: prévia grátis (POST) e conteúdo completo depois do pagamento (GET).
  app.post('/api/guided/:kind', { config: { rateLimit: { max: 12 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
    const kind = guidedKindParam.parse((req.params as { kind: string }).kind);
    const body = guidedSchema.parse(req.body);
    const sessionId = await createSession(req, reply);
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    return reply.status(201).send(await svc.createGuided(ctx, { sessionId, ipHash: ipHash(req), kind, input: body.input, userAgent }));
  });
  app.get('/api/orders/:id/guided', async (req) => {
    const sessionId = await requireSession(req);
    return svc.getGuided(ctx, sessionId, idParam((req.params as { id: string }).id));
  });

  // Refazer com novos dados dentro do prazo de acesso (30 dias por padrão): não cobra de novo e não muda a data final.
  const redoLimit = { config: { rateLimit: { max: 10 * scale, timeWindow: '1 minute' } } };
  app.post('/api/orders/:id/redo/map', redoLimit, async (req) => redo.redoMap(ctx, await requireSession(req), idParam((req.params as { id: string }).id), req.body));
  app.post('/api/orders/:id/redo/translation', redoLimit, async (req) => redo.redoTranslator(ctx, await requireSession(req), idParam((req.params as { id: string }).id), req.body));
  app.post('/api/orders/:id/redo/guided', redoLimit, async (req) => redo.redoGuided(ctx, await requireSession(req), idParam((req.params as { id: string }).id), req.body));

  app.get('/api/orders/:id/translation', async (req) => {
    const sessionId = await requireSession(req);
    return svc.getTranslation(ctx, sessionId, idParam((req.params as { id: string }).id));
  });

  // O que está ligado neste servidor (o front-end esconde o que não estiver).
  // Preços e avisos que o site mostra: vêm do banco (o dono edita no backoffice), nunca fixos no navegador.
  app.get('/api/catalog', async () => publicCatalog(ctx));

  // Eventos de navegação (funil e jornada). Sem dado pessoal; robôs são ignorados.
  app.post('/api/events', { config: { rateLimit: { max: 90 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
    const input = eventSchema.parse(req.body);
    const sessionId = await createSession(req, reply);
    await recordEvent(ctx, sessionId, input, typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined);
    return reply.status(204).send();
  });

  registerGestao(app, { ctx, scale, requireSession, createSession, idParam });

  // Descadastro de e-mails de campanha: link assinado, vale sem login (aceita POST de um clique, como o Gmail faz).
  app.post('/api/unsubscribe', { config: { rateLimit: { max: 30 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const q = req.query as { t?: string };
    const body = (req.body ?? {}) as { token?: string };
    const token = String(body.token ?? q.t ?? '');
    if (token.startsWith('r.')) await referrals.referralOptOut(ctx, token);
    else await campaigns.unsubscribe(ctx, token);
    return reply.status(204).send();
  });

  app.post('/api/referrals/lead', { config: { rateLimit: { max: 5 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const sessionId = await requireSession(req);
    const b = referralLeadSchema.parse(req.body);
    return referrals.inviteLead(ctx, { sessionId, friendEmail: b.friendEmail, yourName: b.yourName });
  });

  // Fale conosco da landing: vira e-mail para o suporte (nada é gravado). Limite baixo e anti-robô (Turnstile + isca).
  app.post('/api/contact', { config: { rateLimit: { max: 4 * scale, timeWindow: '10 minutes' } } }, async (req) => {
    await verifyTurnstile(config, req.headers['x-turnstile'], clientIp(req));
    return sendContact(ctx, contactSchema.parse(req.body));
  });

  // Aviso de cookies: guarda a escolha sobre compartilhar dados de navegação com a Meta (publicidade). Aceitar liga o PageView; recusar apaga o cookie.
  app.post('/api/consent', { config: { rateLimit: { max: 20 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { ads, eventId, fbp, fbc } = z.strictObject({ ads: z.boolean(), eventId: z.string().uuid().optional(), fbp: FBP_RE.optional(), fbc: FBC_RE.optional() }).parse(req.body);
    if (ads) {
      reply.setCookie(ADS_COOKIE, '1', { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: 180 * 24 * 3600 });
      if (config.metaPageView && config.metaCapiToken) {
        const ck = req.headers.cookie ?? '';
        const ua = req.headers['user-agent'];
        void sendCapi(ctx, { name: 'PageView', eventId: eventId ?? randomUUID(), ip: clientIp(req), userAgent: typeof ua === 'string' ? ua : undefined, url: `${config.publicUrl}/`, fbc: fbc ?? /_fbc=([^;]+)/.exec(ck)?.[1], fbp: fbp ?? /_fbp=([^;]+)/.exec(ck)?.[1] });
      }
    } else reply.clearCookie(ADS_COOKIE, { path: '/' });
    return { ok: true, ads };
  });

  // Chatbot (FôlIA): celular com DDD e e-mail obrigatórios para abrir a conversa. Limites por IP; a conversa tem token próprio de 24 h.
  app.post('/api/chat/start', { config: { rateLimit: { max: 8 * scale, timeWindow: '10 minutes' } } }, async (req) => {
    await verifyTurnstile(config, req.headers['x-turnstile'], clientIp(req));
    return chatbot.startChat(ctx, chatbot.startSchema.parse(req.body));
  });
  const chatToken = (req: { headers: Record<string, unknown> }) => {
    const h = String(req.headers.authorization ?? '');
    return h.startsWith('Bearer ') ? h.slice(7) : undefined;
  };
  app.get('/api/chat/history', { config: { rateLimit: { max: 30 * scale, timeWindow: '1 minute' } } }, async (req) => chatbot.chatHistory(ctx, chatToken(req)));
  app.post('/api/chat/message', { config: { rateLimit: { max: 12 * scale, timeWindow: '1 minute' } } }, async (req) => chatbot.chatMessage(ctx, chatToken(req), chatbot.messageSchema.parse(req.body).text));

  app.get('/api/features', async () => ({ chatbot: true,email: Boolean(deps.email), leads: config.leadsEnabled, subscriptions: config.subscriptionsEnabled && Boolean(deps.email), referrals: config.referralEnabled && Boolean(deps.email), openFinance: Boolean(deps.openFinance), turnstileSiteKey: turnstileEnabled(config) ? config.turnstileSiteKey : null }));


  // Manda o link de acesso por e-mail. O endereço é usado para enviar e descartado (não é gravado).
  app.post('/api/orders/:id/email-link', { config: { rateLimit: { max: 5 * scale, timeWindow: '10 minutes' } } }, async (req) => {
    await verifyTurnstile(config, req.headers['x-turnstile'], clientIp(req));
    const sessionId = await requireSession(req);
    const { email } = emailLinkSchema.parse(req.body);
    return svc.emailAccessLink(ctx, sessionId, idParam((req.params as { id: string }).id), email);
  });

  // ---------- Criador de Renda Extra: entrevista pós-compra e progresso ----------
  app.post('/api/cases/:id/income-interview', { config: { rateLimit: { max: 5 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const sessionId = await requireSession(req);
    const input = incomeInterviewSchema.parse(req.body);
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    await svc.submitIncomeInterview(ctx, sessionId, idParam((req.params as { id: string }).id), { input, ipHash: ipHash(req), userAgent });
    return reply.status(202).send({ ok: true });
  });

  app.post('/api/cases/:id/income-progress', async (req) => {
    const sessionId = await requireSession(req);
    const { key, done } = toggleIncomeTaskSchema.parse(req.body);
    await svc.toggleIncomeTask(ctx, sessionId, idParam((req.params as { id: string }).id), key, done);
    return { ok: true };
  });

  // ---------- propostas de parceiros (desligado por padrão) ----------
  app.get('/api/cases/:id/leads', async (req) => {
    const sessionId = await requireSession(req);
    return leads.leadStateFor(ctx, sessionId, idParam((req.params as { id: string }).id));
  });

  app.post('/api/cases/:id/leads', { config: { rateLimit: { max: 5 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const sessionId = await requireSession(req);
    const input = leadSchema.parse(req.body);
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
    const out = await leads.submitLead(ctx, { sessionId, caseId: idParam((req.params as { id: string }).id), ipHash: ipHash(req), userAgent, input });
    return reply.status(201).send(out);
  });

  app.delete('/api/cases/:id/leads', async (req, reply) => {
    const sessionId = await requireSession(req);
    await leads.revokeLead(ctx, sessionId, idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });

  {
    // Cadastro de parceiro: só o administrador (token no cabeçalho). O parceiro recebe a senha e o segredo do webhook UMA vez.
    app.post('/api/admin/partners', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
      if (!leads.isAdminToken(ctx, req.headers['x-admin-token'])) return reply.status(404).send({ error: 'not_found', message: 'Não encontrado' });
      return reply.status(201).send(await leads.createPartner(ctx, newPartnerSchema.parse(req.body)));
    });
    app.post('/api/partner/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req) => {
      const { email, password } = partnerLoginSchema.parse(req.body);
      return leads.partnerLogin(ctx, email, password);
    });
    app.get('/api/partner/leads', async (req) => ({ leads: await leads.partnerLeads(ctx, leads.partnerFromToken(ctx, req.headers.authorization)) }));
    app.post('/api/partner/leads/:id/status', async (req) => {
      const partnerId = leads.partnerFromToken(ctx, req.headers.authorization);
      await leads.partnerSetStatus(ctx, partnerId, idParam((req.params as { id: string }).id), partnerStatusSchema.parse(req.body).status);
      return { ok: true };
    });

    // Portal de gestão do parceiro (Euro Multiplan & Fôlego): painel, contatos do Fôlego, base própria (planilhas), contratos e comissão.
    const pid = (req: { headers: { authorization?: string | undefined } }) => leads.partnerFromToken(ctx, req.headers.authorization);
    const pp = partnerPortal;
    const qs = (req: { query: unknown }) => req.query as Record<string, string | undefined>;
    app.get('/api/partner/me', async (req) => pp.partnerProfile(ctx, pid(req)));
    app.get('/api/partner/summary', async (req) => pp.summary(ctx, pid(req)));
    app.get('/api/partner/leads/:id', async (req) => pp.leadDetail(ctx, pid(req), idParam((req.params as { id: string }).id)));
    app.post('/api/partner/leads/:id/events', async (req) => pp.addEvent(ctx, pid(req), { deliveryId: idParam((req.params as { id: string }).id) }, pp.eventSchema.parse(req.body)));
    app.get('/api/partner/contacts', async (req) => {
      const q = qs(req);
      return pp.listContacts(ctx, pid(req), { q: q.q, stage: q.etapa, orgUf: q.orgao, uf: q.uf, status: q.situacao, minMarginCents: q.margem ? Math.round(Number(q.margem) * 100) || undefined : undefined, due: q.vencidas === '1', sort: q.ordem, page: Number(q.pagina) || 0 });
    });
    app.get('/api/partner/contacts/facets', async (req) => pp.contactFacets(ctx, pid(req)));
    app.get('/api/partner/contacts/:id', async (req) => pp.contactDetail(ctx, pid(req), idParam((req.params as { id: string }).id)));
    app.patch('/api/partner/contacts/:id', async (req) => pp.patchContact(ctx, pid(req), idParam((req.params as { id: string }).id), pp.contactPatchSchema.parse(req.body)));
    app.post('/api/partner/contacts/:id/events', async (req) => pp.addEvent(ctx, pid(req), { contactId: idParam((req.params as { id: string }).id) }, pp.eventSchema.parse(req.body)));
    app.get('/api/partner/imports', async (req) => pp.listImports(ctx, pid(req)));
    app.post('/api/partner/imports', async (req, reply) => reply.status(201).send(await pp.startImport(ctx, pid(req), pp.importStartSchema.parse(req.body))));
    // Lotes pequenos (o nginx corta corpos acima de 64 KB): um arquivo grande vira muitas chamadas, então o limite de uso desta rota é maior.
    app.post('/api/partner/imports/:id/rows', { bodyLimit: 6 * 1024 * 1024, config: { rateLimit: { max: 1500 * scale, timeWindow: '1 minute' } } }, async (req) => pp.importBatch(ctx, pid(req), idParam((req.params as { id: string }).id), pp.importBatchSchema.parse(req.body).rows));
    app.post('/api/partner/imports/:id/finish', async (req) => pp.finishImport(ctx, pid(req), idParam((req.params as { id: string }).id)));
    app.get('/api/partner/deals', async (req) => pp.listDeals(ctx, pid(req), { month: qs(req).mes, origin: qs(req).origem, status: qs(req).situacao }));
    app.post('/api/partner/deals', async (req, reply) => reply.status(201).send(await pp.createDeal(ctx, pid(req), pp.dealSchema.parse(req.body))));
    // WhatsApp do parceiro (API oficial da Meta): conexão, conversas, modelos, disparos e agente de IA (gancho).
    const wa = waPortal;
    const pidParam = (req: { params: unknown }) => idParam((req.params as { id: string }).id);
    app.get('/api/partner/wa/account', async (req) => wa.accountView(ctx, pid(req)));
    app.put('/api/partner/wa/account', { config: { rateLimit: { max: 20 * scale, timeWindow: '1 minute' } } }, async (req) => wa.saveAccount(ctx, pid(req), wa.accountSchema.parse(req.body)));
    app.post('/api/partner/wa/account/test', { config: { rateLimit: { max: 10 * scale, timeWindow: '1 minute' } } }, async (req) => wa.testAccount(ctx, pid(req)));
    app.put('/api/partner/wa/agent', async (req) => wa.saveAgent(ctx, pid(req), wa.agentSchema.parse(req.body)));
    app.get('/api/partner/wa/templates', async (req) => wa.listTemplates(ctx, pid(req)));
    app.post('/api/partner/wa/templates', async (req, reply) => reply.status(201).send(await wa.createTemplate(ctx, pid(req), wa.templateSchema.parse(req.body))));
    app.put('/api/partner/wa/templates/:id', async (req) => wa.updateTemplate(ctx, pid(req), pidParam(req), wa.templateUpdateSchema.parse(req.body)));
    app.patch('/api/partner/wa/templates/:id', async (req) => wa.setTemplateStatus(ctx, pid(req), pidParam(req), wa.templatePatchSchema.parse(req.body).status));
    app.delete('/api/partner/wa/templates/:id', async (req) => wa.deleteTemplate(ctx, pid(req), pidParam(req)));
    app.get('/api/partner/wa/threads', async (req) => {
      const q = qs(req);
      return wa.listThreads(ctx, pid(req), { filtro: q.filtro, q: q.q, page: Number(q.pagina) || 0 });
    });
    app.get('/api/partner/wa/threads/:id', async (req) => wa.threadDetail(ctx, pid(req), pidParam(req)));
    app.post('/api/partner/wa/threads/:id/messages', { config: { rateLimit: { max: 120 * scale, timeWindow: '1 minute' } } }, async (req) => wa.sendInThread(ctx, pid(req), pidParam(req), wa.sendSchema.parse(req.body)));
    app.patch('/api/partner/wa/threads/:id', async (req) => wa.patchThread(ctx, pid(req), pidParam(req), wa.threadPatchSchema.parse(req.body)));
    app.post('/api/partner/wa/start', { config: { rateLimit: { max: 120 * scale, timeWindow: '1 minute' } } }, async (req) => wa.startConversation(ctx, pid(req), wa.startSchema.parse(req.body)));
    app.get('/api/partner/wa/broadcasts', async (req) => wa.listBroadcasts(ctx, pid(req)));
    app.post('/api/partner/wa/broadcasts/preview', async (req) => wa.previewBroadcast(ctx, pid(req), wa.broadcastSchema.parse(req.body)));
    app.post('/api/partner/wa/broadcasts', { config: { rateLimit: { max: 10 * scale, timeWindow: '1 minute' } } }, async (req, reply) => reply.status(201).send(await wa.createBroadcast(ctx, pid(req), wa.broadcastSchema.parse(req.body))));
    app.post('/api/partner/wa/broadcasts/:id/cancel', async (req) => wa.cancelBroadcast(ctx, pid(req), pidParam(req)));
    // Caixa de entrada completa: arquivos, encaminhar, número novo, perfil do contato e perfil da empresa.
    app.post('/api/partner/wa/media', { bodyLimit: 17 * 1024 * 1024, config: { rateLimit: { max: 60 * scale, timeWindow: '1 minute' } } }, async (req, reply) => reply.status(201).send(await wa.uploadMedia(ctx, pid(req), wa.readUpload(req))));
    app.get('/api/partner/wa/media/:id', async (req, reply) => {
      const f = await wa.mediaFile(ctx, pid(req), pidParam(req));
      return reply.headers(mediaHeaders(f)).send(f.bytes);
    });
    app.post('/api/partner/wa/threads/new', { config: { rateLimit: { max: 60 * scale, timeWindow: '1 minute' } } }, async (req) => wa.newThread(ctx, pid(req), wa.newThreadSchema.parse(req.body)));
    app.post('/api/partner/wa/threads/:id/forward', { config: { rateLimit: { max: 30 * scale, timeWindow: '1 minute' } } }, async (req) => wa.forwardMessages(ctx, pid(req), pidParam(req), wa.forwardSchema.parse(req.body)));
    app.patch('/api/partner/wa/threads/:id/profile', async (req) => wa.patchProfile(ctx, pid(req), pidParam(req), wa.profileSchema.parse(req.body)));
    app.get('/api/partner/wa/business-profile', async (req) => wa.getBusinessProfile(ctx, pid(req)));
    app.put('/api/partner/wa/business-profile', { config: { rateLimit: { max: 20 * scale, timeWindow: '1 minute' } } }, async (req) => wa.saveBusinessProfile(ctx, pid(req), wa.businessProfileSchema.parse(req.body)));
    app.put('/api/partner/wa/business-profile/photo', { config: { rateLimit: { max: 10 * scale, timeWindow: '1 minute' } } }, async (req) => wa.saveBusinessPhoto(ctx, pid(req), z.object({ mediaId: z.string().uuid() }).parse(req.body).mediaId));
    app.patch('/api/partner/deals/:id', async (req) => pp.patchDeal(ctx, pid(req), idParam((req.params as { id: string }).id), pp.dealPatchSchema.parse(req.body)));
  }

  // ---------- assinatura (desligada por padrão; exige e-mail configurado) ----------
  /** A pessoa que está logada (sempre ela mesma). */
  const requireSelf = async (req: FastifyRequest): Promise<string> => {
    // sem sessão nenhuma também é "não entrou" (401), como depois do logout
    const sessionId = await requireSession(req).catch(() => {
      throw new AppError(401, 'not_logged_in', 'Entre com seu e-mail para continuar.');
    });
    const subscriberId = await sub.subscriberOf(ctx, sessionId);
    if (!subscriberId) throw new AppError(401, 'not_logged_in', 'Entre com seu e-mail para continuar.');
    return subscriberId;
  };
  /** A conta cujos dados ela usa: a do titular, se ela for membro de uma conta compartilhada. */
  const requireSubscriber = async (req: FastifyRequest): Promise<string> => {
    const self = await requireSelf(req);
    const account = await household.effectiveAccountId(ctx, self);
    // Quem só consulta a conta de outra pessoa vê tudo, mas não grava nada (vale para toda rota de dados que não seja GET).
    if (account !== self && req.method !== 'GET' && (await household.memberAccess(ctx, self)) === 'consulta') {
      throw new AppError(403, 'read_only', 'Seu acesso a esta conta é só de consulta. Peça ao titular para liberar a edição.');
    }
    return account;
  };

  app.post('/api/account/login-code', { config: { rateLimit: { max: 5 * scale, timeWindow: '10 minutes' } } }, async (req) => {
    await verifyTurnstile(config, req.headers['x-turnstile'], clientIp(req));
    const { email } = emailOnlySchema.parse(req.body);
    return sub.requestLoginCode(ctx, email);
  });
  app.post('/api/account/login', { config: { rateLimit: { max: 10 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { email, code } = loginCodeSchema.parse(req.body);
    const sessionId = await createSession(req, reply);
    await sub.verifyLoginCode(ctx, sessionId, email, code);
    return household.accountViewFor(ctx, await sub.subscriberOf(ctx, sessionId) as string);
  });
  // Entrada com senha: só para a conta de teste que o dono deixou LIGADA (qualquer outra pessoa entra por código no e-mail).
  app.post('/api/account/login-password', { config: { rateLimit: { max: 6 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { email, password } = z.strictObject({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(8).max(100) }).parse(req.body);
    const sessionId = await createSession(req, reply);
    await demoAccounts.passwordLogin(ctx, sessionId, email, password);
    return household.accountViewFor(ctx, (await sub.subscriberOf(ctx, sessionId)) as string);
  });
  app.post('/api/account/logout', async (req, reply) => {
    const sessionId = await requireSession(req);
    await sub.logout(ctx, sessionId);
    return reply.status(204).send();
  });
  app.get('/api/account', async (req) => household.accountViewFor(ctx, await requireSelf(req)));
  app.delete('/api/account', async (req, reply) => {
    const selfId = await requireSelf(req); // sem sessão: 401, como nas outras rotas da conta
    const sessionId = await requireSession(req);
    await accountData.purgeSubscriber(ctx, selfId, `session:${sessionId}`);
    return reply.status(204).send();
  });

  app.post('/api/account/subscription-order', { config: { rateLimit: { max: 10 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
    const subscriberId = await requireSelf(req);
    const sessionId = await requireSession(req);
    await household.assertNotMember(ctx, subscriberId);
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw new AppError(400, 'idempotency_key', 'Cabeçalho Idempotency-Key obrigatório (de 8 a 100 caracteres)');
    const { plan } = subscriptionOrderSchema.parse(req.body);
    return reply.status(201).send(await sub.createSubscriptionOrder(ctx, { sessionId, subscriberId, plan, idempotencyKey: key }));
  });
  // Assinatura mensal no cartão de crédito (Asaas): a pessoa aceita os termos e digita o cartão na página segura do provedor.
  app.post('/api/account/subscription-checkout', { config: { rateLimit: { max: 15 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const selfId = await requireSelf(req);
    await household.assertNotMember(ctx, selfId);
    const { plan, acceptTerms, referralCode, cpf, name, phone, adsConsent, fbc } = checkoutSchema.parse(req.body);
    return reply.status(201).send(await billing.startCardCheckout(ctx, { subscriberId: selfId, plan, acceptTerms, referralCode, cpf, name, phone, adsConsent, fbc, ip: clientIp(req), userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined }));
  });
  app.post('/api/account/subscription-cancel', async (req) => {
    const { cancel } = cancelSchema.parse(req.body);
    const selfId = await requireSelf(req);
    await household.assertNotMember(ctx, selfId);
    if (await billing.hasCardProfile(ctx, selfId)) {
      if (!cancel) throw new AppError(409, 'resubscribe', 'Para voltar, assine de novo depois do fim do mês já pago.');
      const out = await billing.cancelCardSubscription(ctx, selfId);
      const who = await accountViewForCancel(selfId);
      await billing.cancelEmail(ctx, who, new Date(out.accessUntil).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
      return { ok: true, accessUntil: out.accessUntil, purgeDays: ctx.config.canceledPurgeDays };
    }
    await sub.setCancel(ctx, selfId, cancel);
    return { ok: true };
  });
  const accountViewForCancel = async (id: string) => (await sub.accountView(ctx, id)).email;
  // Trocar de plano sem cancelar: pró-rata por dia (upgrade paga a diferença agora; downgrade vira crédito na próxima fatura).
  app.get('/api/account/plan-change/quote', { config: { rateLimit: { max: 30 * scale, timeWindow: '10 minutes' } } }, async (req) => {
    const selfId = await requireSelf(req);
    await household.assertNotMember(ctx, selfId);
    const { plan } = z.object({ plan: z.string().min(3).max(30) }).parse(req.query);
    return planChange.quotePlanChange(ctx, selfId, plan);
  });
  app.post('/api/account/plan-change', { config: { rateLimit: { max: 10 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const selfId = await requireSelf(req);
    await household.assertNotMember(ctx, selfId);
    const { plan, acceptTerms } = z.strictObject({ plan: z.string().min(3).max(30), acceptTerms: z.boolean() }).parse(req.body);
    return reply.status(201).send(await planChange.startPlanChange(ctx, { subscriberId: selfId, toPlan: plan, acceptTerms }));
  });
  // Exportação dos dados da própria pessoa (enquanto tem acesso, inclusive depois de cancelar, até o fim do mês pago).
  // Mapa da Virada para quem assina: oferta (Ousado), uso incluído (Desbravador) ou o Mapa ativo. O preço e o prazo que valem são sempre os do servidor.
  app.get('/api/account/map-offer', async (req) => {
    await requireSelf(req);
    return mapOffer(ctx, await requireSession(req));
  });
  app.get('/api/account/export', async (req) => accountData.accountReport(ctx, await requireSubscriber(req)));
  app.get('/api/account/export.xlsx', async (req, reply) => {
    const buf = await accountData.accountXlsx(ctx, await requireSubscriber(req));
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="prumo-meus-dados-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    reply.header('Cache-Control', 'no-store');
    return reply.send(buf);
  });
  // Indicações: assinante (com desconto na próxima fatura) e comprador de produto Pix (só gera lead).
  app.get('/api/account/referrals', async (req) => referrals.overview(ctx, await requireSubscriber(req)));
  app.post('/api/account/referrals', { config: { rateLimit: { max: 10 * scale, timeWindow: '10 minutes' } } }, async (req) => referrals.inviteBySubscriber(ctx, await requireSelf(req), referralInviteSchema.parse(req.body).email));
  // Convite pelo WhatsApp do Fôlego (Bird): entra na fila e sai em horário comercial.
  app.post('/api/account/referrals/whatsapp', { config: { rateLimit: { max: 10 * scale, timeWindow: '10 minutes' } } }, async (req) => {
    const b = referralWhatsappSchema.parse(req.body);
    return referrals.inviteBySubscriberWhatsApp(ctx, await requireSelf(req), b);
  });
  // Cobranças recorrentes (todos os planos) e base do simulador "e se...?" (Ousado e Desbravador).
  app.get('/api/account/recurring', async (req) => insights.recurringReport(ctx, await requireSubscriber(req)));
  app.put('/api/account/recurring/:key', async (req) => {
    await insights.setRecurringDecision(ctx, await requireSubscriber(req), decodeURIComponent((req.params as { key: string }).key), recurringDecisionSchema.parse(req.body).status);
    return { ok: true };
  });
  app.get('/api/account/scenario-base', async (req) => insights.scenarioBase(ctx, await requireSubscriber(req)));
  // Perfil e preferências de notificação.
  app.put('/api/account/profile', async (req) => {
    const selfId = await requireSelf(req);
    const p = profileSchema.parse(req.body);
    if (p.displayName !== undefined) await ctx.db.query(`UPDATE app.subscribers SET display_name = $2 WHERE id = $1`, [selfId, p.displayName && p.displayName.length ? p.displayName : null]);
    if (p.notifyDigest !== undefined) await ctx.db.query(`UPDATE app.subscribers SET notify_digest = $2 WHERE id = $1`, [selfId, p.notifyDigest]);
    if (p.notifyReminders !== undefined) await ctx.db.query(`UPDATE app.subscribers SET notify_reminders = $2 WHERE id = $1`, [selfId, p.notifyReminders]);
    if (p.marketing !== undefined) await ctx.db.query(`UPDATE app.subscribers SET marketing_opt_out_at = CASE WHEN $2 THEN NULL ELSE coalesce(marketing_opt_out_at, now()) END WHERE id = $1`, [selfId, p.marketing]);
    return (await household.accountViewFor(ctx, selfId)).profile;
  });

  app.get('/api/account/month/:month', async (req) => sub.monthView(ctx, await requireSubscriber(req), monthParam.parse((req.params as { month: string }).month)));
  app.post('/api/account/entries', async (req) => sub.addEntries(ctx, await requireSubscriber(req), addEntriesSchema.parse(req.body).entries));
  app.delete('/api/account/entries/:id', async (req, reply) => {
    await sub.deleteEntry(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
  app.post('/api/account/entries/:id/category', async (req) => {
    await sub.setEntryCategory(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), setCategorySchema.parse(req.body).category);
    return { ok: true };
  });
  // Categorias próprias (além das 10 do sistema): listar, criar e apagar (os lançamentos dela vão para "Outros").
  app.get('/api/account/categories', async (req) => sub.listCategories(ctx, await requireSubscriber(req)));
  app.post('/api/account/categories', { config: { rateLimit: { max: 30 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => reply.status(201).send(await sub.addCategory(ctx, await requireSubscriber(req), categoryNameSchema.parse(req.body).name)));
  app.post('/api/account/categories/remove', { config: { rateLimit: { max: 30 * scale, timeWindow: '10 minutes' } } }, async (req) => sub.removeCategory(ctx, await requireSubscriber(req), categoryNameSchema.parse(req.body).name));
  app.post('/api/account/limits/:category', async (req) => {
    await sub.setLimit(ctx, await requireSubscriber(req), (req.params as { category: string }).category, setLimitSchema.parse(req.body).limitCents);
    return { ok: true };
  });
  app.post('/api/account/goals', async (req, reply) => {
    await sub.saveGoal(ctx, await requireSubscriber(req), goalSchema.parse(req.body));
    return reply.status(201).send({ ok: true });
  });
  app.delete('/api/account/goals/:id', async (req, reply) => {
    await sub.deleteGoal(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
  app.post('/api/account/goals/:id/contributions', async (req, reply) => {
    await sub.addContribution(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), contributionSchema.parse(req.body));
    return reply.status(201).send({ ok: true });
  });
  app.delete('/api/account/goals/:id/contributions/:cid', async (req, reply) => {
    const p = req.params as { id: string; cid: string };
    await sub.deleteContribution(ctx, await requireSubscriber(req), idParam(p.id), idParam(p.cid));
    return reply.status(204).send();
  });
  // Dívidas da conta, plano de quitação e orçamento por mês
  app.get('/api/account/debts', async (req) => {
    const extra = Math.max(0, Math.min(100_000_000_00, Number((req.query as { extra?: string }).extra) || 0));
    return debts.listDebts(ctx, await requireSubscriber(req), extra);
  });
  app.post('/api/account/debts', async (req, reply) => reply.status(201).send({ id: await debts.createDebt(ctx, await requireSubscriber(req), accountDebtSchema.parse(req.body)) }));
  app.put('/api/account/debts/:id', async (req) => {
    await debts.updateDebt(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), accountDebtPatchSchema.parse(req.body));
    return { ok: true };
  });
  app.delete('/api/account/debts/:id', async (req, reply) => {
    await debts.deleteDebt(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
  app.post('/api/account/debts/:id/payments', async (req) => debts.payDebt(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), debtPaymentSchema.parse(req.body)));
  app.post('/api/account/budget/:month/limits/:category', async (req) => {
    const { month, category } = req.params as { month: string; category: string };
    if (!monthParam.safeParse(month).success) throw new AppError(400, 'invalid_month', 'Mês inválido.');
    await debts.setMonthLimit(ctx, await requireSubscriber(req), month, category, monthLimitSchema.parse(req.body).limitCents);
    return { ok: true };
  });
  app.post('/api/account/budget/:month/copy', async (req) => {
    const { month } = req.params as { month: string };
    if (!monthParam.safeParse(month).success) throw new AppError(400, 'invalid_month', 'Mês inválido.');
    return { copied: await debts.copyPreviousMonthLimits(ctx, await requireSubscriber(req), month) };
  });
  app.post('/api/account/planner', { config: { rateLimit: { max: 12, timeWindow: '10 minutes' } } }, async (req) => askPlanner(ctx, await requireSubscriber(req), plannerSchema.parse(req.body).question));
  // Conta compartilhada
  app.get('/api/account/household', async (req) => household.householdView(ctx, await requireSelf(req)));
  app.post('/api/account/household/invite', { config: { rateLimit: { max: 6 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = inviteSchema.parse(req.body);
    await household.invite(ctx, await requireSelf(req), b.email, b.access);
    return reply.status(204).send();
  });
  app.delete('/api/account/household/member', async (req, reply) => {
    const id = (req.query as { id?: string } | undefined)?.id;
    await household.removeMember(ctx, await requireSelf(req), id ? idParam(id) : undefined);
    return reply.status(204).send();
  });
  app.put('/api/account/household/member/:id', async (req, reply) => {
    await household.setAccess(ctx, await requireSelf(req), idParam((req.params as { id: string }).id), memberAccessSchema.parse(req.body).access);
    return reply.status(204).send();
  });
  app.post('/api/account/household/accept', async (req, reply) => {
    await household.accept(ctx, await requireSelf(req));
    return reply.status(204).send();
  });
  app.post('/api/account/household/leave', async (req, reply) => {
    await household.leave(ctx, await requireSelf(req));
    return reply.status(204).send();
  });
  // Coach: nota de saúde, jornadas, métodos e cenário econômico
  app.get('/api/account/coach/overview', async (req) => program.coachOverview(ctx, await requireSubscriber(req)));
  app.post('/api/account/coach/journeys/:id/start', async (req, reply) => {
    await program.startJourney(ctx, await requireSubscriber(req), (req.params as { id: string }).id);
    return reply.status(204).send();
  });
  app.delete('/api/account/coach/journeys/:id', async (req, reply) => {
    await program.stopJourney(ctx, await requireSubscriber(req), (req.params as { id: string }).id);
    return reply.status(204).send();
  });
  app.post('/api/account/coach/objective', async (req) => program.setObjective(ctx, await requireSubscriber(req), objectiveSchema.parse(req.body).objective));
  app.get('/api/account/goal-templates', async (req) => program.goalTemplatesFor(ctx, await requireSubscriber(req)));
  // Contas conectadas (Open Finance): só leitura, plano Desbravador, só com o serviço ligado no servidor.
  app.get('/api/account/openfinance', async (req) => openFinance.listConnections(ctx, await requireSubscriber(req)));
  app.post('/api/account/openfinance/connect-token', { config: { rateLimit: { max: 10 * scale, timeWindow: '10 minutes' } } }, async (req) => openFinance.connectToken(ctx, await requireSubscriber(req)));
  app.post('/api/account/openfinance/connections', { config: { rateLimit: { max: 10 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { itemId, acceptConsent } = z.strictObject({ itemId: z.string().min(8).max(100).regex(/^[A-Za-z0-9-]+$/), acceptConsent: z.literal(true) }).parse(req.body);
    void acceptConsent;
    return reply.status(201).send(await openFinance.addConnection(ctx, await requireSubscriber(req), itemId));
  });
  app.post('/api/account/openfinance/connections/:id/sync', { config: { rateLimit: { max: 6 * scale, timeWindow: '10 minutes' } } }, async (req) => openFinance.syncNow(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id)));
  // Reconectar (renovar o consentimento ou entrar de novo no banco): token em modo "atualizar" e conferência do estado depois do widget
  app.post('/api/account/openfinance/connections/:id/reconnect-token', { config: { rateLimit: { max: 10 * scale, timeWindow: '10 minutes' } } }, async (req) => openFinance.reconnectToken(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id)));
  app.post('/api/account/openfinance/connections/:id/refresh', { config: { rateLimit: { max: 10 * scale, timeWindow: '10 minutes' } } }, async (req) => openFinance.refreshConnection(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id)));
  app.delete('/api/account/openfinance/connections/:id', async (req, reply) => {
    await openFinance.revokeConnection(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
  app.get('/api/account/market', async (req) => program.marketView(ctx, await requireSubscriber(req)));
  // Carteiras e lembretes
  // Cartões de crédito: Ousado (cadastro, limite, fatura, parcelas) e Desbravador (também fatura em PDF e estratégias)
  // Planejar férias (Ousado) e roteiro com IA (Desbravador)
  app.get('/api/account/trips', async (req) => trips.listTrips(ctx, await requireSubscriber(req)));
  app.post('/api/account/trips', async (req, reply) => reply.status(201).send({ id: await trips.createTrip(ctx, await requireSubscriber(req), tripSchema.parse(req.body)) }));
  app.get('/api/account/trips/:id', async (req) => trips.getTrip(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id)));
  app.put('/api/account/trips/:id', async (req) => {
    await trips.updateTrip(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), tripSchema.parse(req.body));
    return { ok: true };
  });
  app.delete('/api/account/trips/:id', async (req, reply) => {
    await trips.deleteTrip(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
  app.post('/api/account/trips/:id/check', async (req) => {
    const b = tripCheckSchema.parse(req.body);
    await trips.checkTripItem(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), b.itemId, b.done);
    return { ok: true };
  });
  app.post('/api/account/trips/:id/itinerary', { config: { rateLimit: { max: 8 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => reply.status(202).send(await trips.generateItinerary(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id))));

  app.post('/api/account/cards/:id/invoices/:key/finance', async (req) => {
    const p = req.params as { id: string; key: string };
    return cards.financeInvoice(ctx, await requireSubscriber(req), idParam(p.id), p.key, cardFinanceSchema.parse(req.body));
  });
  app.get('/api/account/cards', async (req) => cards.listCards(ctx, await requireSubscriber(req)));
  app.post('/api/account/cards', async (req, reply) => reply.status(201).send({ id: await cards.createCard(ctx, await requireSubscriber(req), cardSchema.parse(req.body)) }));
  app.put('/api/account/cards/:id', async (req) => {
    await cards.updateCard(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), cardPatchSchema.parse(req.body));
    return { ok: true };
  });
  app.delete('/api/account/cards/:id', async (req, reply) => {
    await cards.deleteCard(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
  app.post('/api/account/cards/:id/purchases', { config: { rateLimit: { max: 60 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => reply.status(201).send(await cards.addPurchase(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), cardPurchaseSchema.parse(req.body))));
  app.delete('/api/account/cards/:id/installments/:planId', async (req, reply) => {
    const p = req.params as { id: string; planId: string };
    await cards.cancelInstallments(ctx, await requireSubscriber(req), idParam(p.id), idParam(p.planId));
    return reply.status(204).send();
  });
  app.post('/api/account/cards/:id/payments', { config: { rateLimit: { max: 30 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => reply.status(201).send({ id: await cards.addCardPayment(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), cardPaymentSchema.parse(req.body)) }));
  app.delete('/api/account/cards/:id/payments/:paymentId', async (req, reply) => {
    const p = req.params as { id: string; paymentId: string };
    await cards.deleteCardPayment(ctx, await requireSubscriber(req), idParam(p.id), idParam(p.paymentId));
    return reply.status(204).send();
  });
  app.get('/api/account/cards/:id/invoices/:key', async (req) => {
    const p = req.params as { id: string; key: string };
    return cards.invoiceDetail(ctx, await requireSubscriber(req), idParam(p.id), p.key);
  });
  app.get('/api/account/cards/:id/revolving', async (req) => {
    const fixed = Math.max(0, Math.min(100_000_000_00, Number((req.query as { fixed?: string }).fixed) || 0));
    return cards.rotativoSimulation(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), fixed);
  });
  app.post('/api/account/cards/:id/import', { config: { rateLimit: { max: 12 * scale, timeWindow: '10 minutes' } } }, async (req) => cards.importInvoice(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), cardImportSchema.parse(req.body)));
  app.post('/api/account/wallets/:id/anchor', async (req) => {
    const b = walletAnchorSchema.parse(req.body);
    return extras.anchorWallet(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), b.asOf, b.balanceCents);
  });
  app.get('/api/account/wallets', async (req) => extras.listWallets(ctx, await requireSubscriber(req)));
  app.post('/api/account/wallets', async (req, reply) => {
    return reply.status(201).send({ id: await extras.createWallet(ctx, await requireSubscriber(req), walletSchema.parse(req.body)) });
  });
  app.put('/api/account/wallets/:id', async (req) => {
    await extras.updateWallet(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), walletPatchSchema.parse(req.body));
    return { ok: true };
  });
  app.delete('/api/account/wallets/:id', async (req, reply) => {
    await extras.deleteWallet(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
  app.post('/api/account/entries/:id/wallet', async (req) => {
    await extras.setEntryWallet(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), entryWalletSchema.parse(req.body).walletId);
    return { ok: true };
  });
  app.get('/api/account/reminders', async (req) => ({ reminders: await extras.listReminders(ctx, await requireSubscriber(req)) }));
  app.post('/api/account/reminders', async (req, reply) => {
    return reply.status(201).send({ id: await extras.createReminder(ctx, await requireSubscriber(req), reminderSchema.parse(req.body)) });
  });
  app.put('/api/account/reminders/:id', async (req) => {
    await extras.updateReminder(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), reminderPatchSchema.parse(req.body));
    return { ok: true };
  });
  app.delete('/api/account/reminders/:id', async (req, reply) => {
    await extras.deleteReminder(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
  // Foto de perfil (ícone no topo do Prumo). O ?v=<data> da tela só serve para o navegador renovar a imagem quando ela muda.
  app.get('/api/account/avatar', async (req, reply) => {
    const f = await avatar.getAvatar(ctx, await requireSelf(req));
    return reply.headers({ 'content-type': f.mime, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox" }).send(f.bytes);
  });
  app.put('/api/account/avatar', { config: { rateLimit: { max: 20 * scale, timeWindow: '10 minutes' } } }, async (req) => avatar.saveAvatar(ctx, await requireSelf(req), avatar.avatarSchema.parse(req.body)));
  app.delete('/api/account/avatar', async (req, reply) => {
    await avatar.deleteAvatar(ctx, await requireSelf(req));
    return reply.status(204).send();
  });
  // Assistente do Prumo no WhatsApp: vincular o número (por código), ver o estado e desconectar. O resto acontece pelas mensagens (webhook da Bird).
  app.get('/api/account/assistant', async (req) => assistant.assistantView(ctx, await requireSelf(req)));
  app.post('/api/account/assistant/link', { config: { rateLimit: { max: 10 * scale, timeWindow: '10 minutes' } } }, async (req) => assistant.startLink(ctx, await requireSelf(req)));
  app.delete('/api/account/assistant', async (req, reply) => {
    await assistant.unlink(ctx, await requireSelf(req));
    return reply.status(204).send();
  });
  // Cofre de acordos e documentos de dívida (arquivo criptografado; busca no servidor)
  app.get('/api/account/vault', async (req) => vault.listDocs(ctx, await requireSubscriber(req), (req.query as { q?: string } | undefined)?.q?.slice(0, 80)));
  app.post('/api/account/vault', { bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 20 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => reply.status(201).send(await vault.addDoc(ctx, await requireSubscriber(req), vault.vaultSchema.parse(req.body))));
  app.put('/api/account/vault/:id', async (req) => {
    await vault.updateDoc(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id), vault.vaultPatchSchema.parse(req.body));
    return { ok: true };
  });
  app.delete('/api/account/vault/:id', async (req, reply) => {
    await vault.deleteDoc(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
  app.get('/api/account/vault/:id/file', { config: { rateLimit: { max: 60 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const f = await vault.getFile(ctx, await requireSubscriber(req), idParam((req.params as { id: string }).id));
    return reply.headers({ ...mediaHeaders({ mime: f.mime, filename: f.filename }), 'cache-control': 'private, no-store' }).send(f.bytes);
  });
  // Notificações no celular (app instalado). O aparelho é da pessoa que entrou (requireSelf), não da conta compartilhada.
  app.get('/api/account/push', async (req) => push.pushView(ctx, await requireSelf(req)));
  app.post('/api/account/push/subscribe', { config: { rateLimit: { max: 20 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    await push.subscribeDevice(ctx, await requireSelf(req), push.subscribeSchema.parse(req.body), req.headers['user-agent']);
    return reply.status(201).send({ ok: true });
  });
  app.post('/api/account/push/unsubscribe', async (req) => {
    await push.forgetDevice(ctx, await requireSelf(req), z.strictObject({ endpoint: z.string().max(1000) }).parse(req.body).endpoint);
    return { ok: true };
  });
  app.put('/api/account/push/prefs', async (req) => {
    await push.savePrefs(ctx, await requireSelf(req), push.prefsSchema.parse(req.body));
    return { ok: true };
  });
  app.post('/api/account/push/test', { config: { rateLimit: { max: 4 * scale, timeWindow: '10 minutes' } } }, async (req) => ({ sent: await push.sendTest(ctx, await requireSelf(req)) }));
  app.get('/api/account/coach', async (req) => sub.coach(ctx, await requireSubscriber(req)));
  app.post('/api/account/simulate', async (req) => sub.simulate(ctx, await requireSubscriber(req), simulateSchema.parse(req.body)));

  // Voltar ao Mapa: pelo cookie (mesmo navegador) ou pelo link de acesso (outro aparelho). Sem cadastro, sem senha.
  app.get('/api/me', async (req) => {
    const id = await svc.findSession(ctx, req.cookies[SESSION_COOKIE]);
    return { access: id ? await svc.meAccess(ctx, id) : null, translator: id ? await svc.meAccess(ctx, id, 'translator') : null, guided: id ? await svc.listGuidedAccess(ctx, id) : [] };
  });

  app.post('/api/orders/:id/access-link', { config: { rateLimit: { max: 10 * scale, timeWindow: '1 minute' } } }, async (req) => {
    const sessionId = await requireSession(req);
    return svc.createAccessLink(ctx, sessionId, idParam((req.params as { id: string }).id));
  });

  app.post('/api/access', { config: { rateLimit: { max: 10 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { token } = accessSchema.parse(req.body);
    const sessionId = await createSession(req, reply);
    return svc.redeemAccess(ctx, sessionId, token);
  });

  // Avisos do agregador de Open Finance (webhook): sem cookie, autenticado por segredo. Sempre 200 para não gerar reenvio à toa; sem segredo configurado, não existe (404).
  app.post('/webhooks/openfinance', { config: { rateLimit: { max: 120 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
    const outcome = await openFinance.handleOpenFinanceWebhook(ctx, req.headers, (req.query ?? {}) as Record<string, unknown>, req.body);
    if (outcome === 'disabled') throw notFound();
    if (outcome === 'invalid') return reply.status(401).send({ error: 'invalid_secret' });
    return reply.status(200).send({ ok: true, outcome });
  });

  // Webhook do gateway: sem cookie, autenticado pela assinatura do provedor.
  app.post('/webhooks/pix', async (req, reply) => {
    const outcome = await svc.handleWebhook(ctx, req.headers, req.body);
    if (outcome === 'invalid_signature') return reply.status(401).send({ error: 'invalid_signature' });
    return { ok: true, outcome };
  });

  // Webhook do WhatsApp (Meta): um endereço por parceiro. O corpo CRU é conferido com a assinatura X-Hub-Signature-256 e o segredo do app do parceiro.
  // A Meta reenvia se não receber 200 rápido, então depois de validar a assinatura respondemos sempre 200 (erros internos vão para o log).
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 512 * 1024 }, (_req, body, done) => done(null, body));
    scope.get('/webhooks/whatsapp/:partnerId', async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const answer = await waPortal.verifyChallenge(ctx, idParam((req.params as { partnerId: string }).partnerId), { mode: q['hub.mode'], token: q['hub.verify_token'], challenge: q['hub.challenge'] });
      if (answer === null) return reply.status(403).send({ error: 'forbidden' });
      return reply.type('text/plain').send(answer);
    });
    scope.post('/webhooks/whatsapp/:partnerId', { config: { rateLimit: { max: 1200 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
      const acc = await loadAccount(ctx, idParam((req.params as { partnerId: string }).partnerId));
      if (!acc) return reply.status(404).send({ error: 'not_found' });
      const raw = typeof req.body === 'string' ? req.body : '';
      const sig = req.headers['x-hub-signature-256'];
      if (!validSignature(acc.appSecret, raw, typeof sig === 'string' ? sig : undefined)) return reply.status(401).send({ error: 'invalid_signature' });
      let parsed: WebhookBody;
      try {
        parsed = JSON.parse(raw) as WebhookBody;
      } catch {
        return reply.status(400).send({ error: 'invalid_json' });
      }
      try {
        await handleWhatsAppWebhook(ctx, acc, parsed, { log: (e) => req.log.warn(e) });
      } catch (error) {
        req.log.error({ erro: error instanceof Error ? error.message.slice(0, 200) : 'erro' }, 'whatsapp_webhook_falhou');
      }
      return { ok: true };
    });
    // Avisos da Bird (status das mensagens e respostas, como "SAIR"): padrão Standard Webhooks. Sem o segredo configurado, o endereço não existe.
    scope.post('/webhooks/bird', { config: { rateLimit: { max: 600 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
      const secret = config.bird?.webhookSecret;
      if (!secret) return reply.status(404).send({ error: 'not_found' });
      const raw = typeof req.body === 'string' ? req.body : '';
      const h = req.headers;
      const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
      // Bird clássica (app.bird.com) assina com messagebird-signature; a plataforma nova usa Standard Webhooks (webhook-*).
      const classicHeader = one(h['messagebird-signature']) !== undefined;
      // Sem chave de assinatura no webhook da Bird, o aviso vem sem assinatura: o segredo pode ir no endereço (?k=), em HTTPS.
      const byToken = verifyBirdToken(secret, (req.query as { k?: string } | undefined)?.k);
      const valid = byToken || (classicHeader
        ? verifyBirdClassicSignature(secret, { signature: one(h['messagebird-signature']), timestamp: one(h['messagebird-request-timestamp']) }, `${config.publicUrl}/webhooks/bird`, raw)
        : verifyBirdSignature(secret, { id: one(h['webhook-id']), timestamp: one(h['webhook-timestamp']), signature: one(h['webhook-signature']) }, raw));
      const classic = classicHeader;
      // Registro dos avisos (aceitos e recusados, com o motivo) para o backoffice mostrar em WhatsApp > Conexão; nenhum dado pessoal.
      const skew = Math.round(Date.now() / 1000 - Number(one(h['messagebird-request-timestamp']) ?? one(h['webhook-timestamp']) ?? NaN));
      if (!valid) {
        await svc.audit(ctx.db, 'system', 'bird_aviso_recusado', 'bird_webhook', 'webhook', { formato: classic ? 'classica' : 'nova', temAssinatura: classic || one(h['webhook-signature']) !== undefined, atrasoSegundos: Number.isFinite(skew) ? skew : null, temCodigo: typeof (req.query as { k?: unknown } | undefined)?.k === 'string', tamanhoCodigo: String((req.query as { k?: unknown } | undefined)?.k ?? '').length, tamanhoSegredo: secret.length }).catch(() => {});
        return reply.status(401).send({ error: 'invalid_signature' });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return reply.status(400).send({ error: 'invalid_json' });
      }
      // O formato é o do corpo: o da Bird clássica tem "event" + "payload"; o da plataforma nova tem "type" + "data".
      const body = (parsed ?? {}) as { event?: unknown; payload?: unknown; type?: unknown };
      const isClassicBody = classic || (typeof body.event === 'string' && body.event.startsWith('whatsapp.') && body.payload !== undefined);
      const evento = String((isClassicBody ? body.event : body.type) ?? '').slice(0, 40);
      if (isClassicBody) parsed = classicToEvent(parsed);
      await svc.audit(ctx.db, 'system', 'bird_aviso_aceito', 'bird_webhook', 'webhook', { formato: isClassicBody ? 'classica' : 'nova', evento, via: byToken ? 'codigo no endereco' : 'assinatura' }).catch(() => {});
      try {
        await handleBirdEvent(ctx, parsed, { log: (e) => req.log.warn(e) });
      } catch (error) {
        req.log.error({ erro: error instanceof Error ? error.message.slice(0, 200) : 'erro' }, 'bird_webhook_falhou');
      }
      return { ok: true };
    });
  });

  // Arquivo que enviamos ao WhatsApp pela Bird: endereço público, assinado e de curta duração (a Bird só aceita mídia por URL https).
  app.get('/wa-media/:id', { config: { rateLimit: { max: 240 * scale, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = idParam((req.params as { id: string }).id);
    const q = req.query as { e?: string; s?: string };
    if (!validMediaSig(ctx, id, q.e, q.s)) return reply.status(404).send({ error: 'not_found' });
    const f = await loadMedia(ctx, id);
    return reply.headers(mediaHeaders(f, true)).send(f.bytes);
  });

  // Só desenvolvimento: faz o papel do banco confirmando o Pix, passando pelo MESMO caminho do webhook real.
  // Só existe com o gateway de MENTIRA (em produção, só com ALLOW_FAKE_GATEWAY_IN_PRODUCTION=1, pré-lançamento). Com o Asaas a rota some.
  if (deps.gateway instanceof FakeGateway) {
    const fake = deps.gateway;
    app.post('/api/dev/pay/:orderId', async (req) => {
      const sessionId = await requireSession(req);
      const orderId = idParam((req.params as { orderId: string }).orderId);
      const selfSub = await sub.subscriberOf(ctx, sessionId);
      const own = selfSub ? await deps.db.query(`SELECT 1 FROM app.orders WHERE id = $1 AND subscriber_id = $2`, [orderId, selfSub]) : { rows: [] };
      if (own.rows.length === 0) await svc.getOrder(ctx, sessionId, orderId); // garante que o pedido é desta sessão (ou da conta logada)
      const pay = await deps.db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [orderId]);
      const paymentId = pay.rows[0]?.provider_payment_id;
      if (!paymentId) throw notFound();
      fake.markPaid(paymentId);
      const outcome = await svc.handleWebhook(ctx, { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt_${randomUUID()}`, paymentId });
      return { ok: true, outcome };
    });
  }

  if (deps.gateway instanceof FakeGateway) {
    const fake = deps.gateway;
    // Só desenvolvimento: faz o papel do cartão renovando a mensalidade (webhook de uma cobrança nova da assinatura).
    app.post('/api/dev/renew', async (req) => {
      const selfId = await requireSelf(req);
      const bp = await deps.db.query<{ provider_subscription_id: string }>(`SELECT provider_subscription_id FROM app.billing_profiles WHERE subscriber_id = $1 AND status <> 'pending'`, [selfId]);
      if (!bp.rows[0]) throw notFound();
      const paymentId = fake.newRenewalPayment();
      fake.markPaid(paymentId);
      const value = fake.valueOf(bp.rows[0].provider_subscription_id);
      const outcome = await svc.handleWebhook(ctx, { 'x-webhook-secret': config.webhookSecret }, { eventId: `evt_${randomUUID()}`, paymentId, subscriptionId: bp.rows[0].provider_subscription_id, ...(value ? { valueCents: value } : {}) });
      return { ok: true, outcome };
    });
  }

  // Front-end estático (só desenvolvimento; em produção o Nginx serve).
  if (config.staticDir) {
    app.get('/assets/config.js', async (_req, reply) => {
      reply.header('Content-Type', 'text/javascript; charset=utf-8');
      reply.header('Cache-Control', 'no-store');
      return `export const API_BASE = '/api';\nexport const DEV = ${config.env !== 'production'};\n`;
    });
    if (config.env !== 'production') {
      // Só desenvolvimento: entrega o axe-core (auditoria de acessibilidade) que está em apps/web/node_modules.
      app.get('/__dev/axe.js', async (_req, reply) => {
        try {
          const file = new URL('../../web/node_modules/axe-core/axe.min.js', import.meta.url);
          reply.header('Content-Type', 'text/javascript; charset=utf-8');
          return await readFile(file);
        } catch {
          return reply.status(404).send('axe-core não instalado');
        }
      });
    }
    // Como o Nginx: /gestao (e /gestão) leva à página do backoffice.
    for (const p of ['/gestao', '/gest%C3%A3o']) app.get(p, async (_req, reply) => reply.redirect('/gestao/', 301));
    await app.register(staticPlugin, { root: config.staticDir, cacheControl: false, index: 'index.html' });
    // Mesmos cabeçalhos que o Nginx envia em produção, para testar o site sob a política real.
    app.addHook('onSend', async (_req, reply, payload) => {
      reply.header('Content-Security-Policy', CSP);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      reply.header('X-Frame-Options', 'DENY');
      return payload;
    });
  }

  return app;
}
