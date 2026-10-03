// Rotas do backoffice (/api/gestao/*). Todas exigem sessão de administrador (código por e-mail) e a permissão da seção.
import * as accountData from '../account-data.ts';
import { purgeSchema } from '../schemas.ts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.ts';
import { currentSettings, refreshRuntime, runtimeSchema, saveRuntime } from '../runtime.ts';
import type { Ctx } from '../services.ts';
import { audit } from '../services.ts';
import { adminLogout, adminOf, can, changePassword, completeSetup, releasePasswordReset, requestSetupCode, passwordLogin, requirePermission } from './auth.ts';
import type { AdminUser } from './auth.ts';
import * as campaigns from './campaigns.ts';
import * as customers from './customers.ts';
import * as manage from './manage.ts';
import * as marketing from './marketing.ts';
import * as metrics from './metrics.ts';
import { ROLE_LABEL, ROLE_PRESETS, ROLES, SECTIONS, SECTION_LABEL } from './permissions.ts';
import type { Section } from './permissions.ts';

export interface AdminRouteDeps {
  ctx: Ctx;
  scale: number;
  requireSession: (req: FastifyRequest) => Promise<string>;
  createSession: (req: FastifyRequest, reply: import('fastify').FastifyReply) => Promise<string>;
  idParam: (v: unknown) => string;
}

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
const passwordLoginSchema = emailSchema.extend({ password: z.string().min(1).max(200) });
const changePasswordSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) });
const loginSchema = emailSchema.extend({ code: z.string().regex(/^\d{6}$/) });
const daysQuery = (q: unknown) => metrics.clampDays((q as { dias?: string }).dias);
const pageQuery = (q: unknown) => Math.max(0, Math.floor(Number((q as { pagina?: string }).pagina) || 0));

const productPatch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  priceCents: z.number().int().min(0).max(1_000_000).optional(),
  accessDays: z.number().int().min(1).max(365).optional(),
  active: z.boolean().optional(),
  usesAi: z.boolean().optional(),
  description: z.string().max(400).optional(),
});
const userCreate = z.object({ email: z.string().trim().toLowerCase().email().max(200), name: z.string().trim().max(80).default(''), role: z.enum(ROLES), permissions: z.array(z.string()).max(20).optional() });
const userPatch = z.object({ resetPassword: z.boolean().optional(), name: z.string().trim().max(80).optional(), role: z.enum(ROLES).optional(), permissions: z.array(z.string()).max(20).optional(), active: z.boolean().optional() });
const subAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('extend'), days: z.number().int().min(1).max(365), reason: z.string().trim().min(3).max(200) }),
  z.object({ type: z.literal('set_plan'), plan: z.enum(['controle', 'ousado', 'desbravador']), reason: z.string().trim().min(3).max(200) }),
  z.object({ type: z.literal('cancel'), cancel: z.boolean(), reason: z.string().trim().min(3).max(200) }),
]);
const campaignSchema = z.object({
  name: z.string().trim().min(3).max(100),
  audience: z.string().min(1).max(40),
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(20).max(4000),
  buttonLabel: z.string().trim().max(40).nullable().optional(),
  buttonUrl: z.string().trim().max(300).nullable().optional(),
});
const planSchema = z.object({
  title: z.string().trim().min(3).max(140),
  goal: z.string().max(400).optional(),
  segment: z.string().max(200).optional(),
  channel: z.string().max(120).optional(),
  status: z.enum(marketing.PLAN_STATUS).optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).optional(),
});

export function registerGestao(app: FastifyInstance, deps: AdminRouteDeps): void {
  const { ctx, scale, requireSession, createSession, idParam } = deps;
  const P = '/api/gestao';

  const admin = async (req: FastifyRequest, ...anyOf: Section[]): Promise<AdminUser> => {
    const sessionId = await requireSession(req).catch(() => {
      throw new AppError(401, 'not_logged_in', 'Entre no backoffice para continuar.');
    });
    const a = await adminOf(ctx, sessionId);
    if (!a) throw new AppError(401, 'not_logged_in', 'Entre no backoffice para continuar.');
    if (anyOf.length > 0 && !anyOf.some((s) => can(a, s))) requirePermission(a, anyOf[0]!);
    return a;
  };

  // ---------- entrada ----------
  // Etapa 1: e-mail + senha (o código só é enviado se a senha estiver certa). Etapa 2: o código, em /login.
  app.post(`${P}/login-password`, { config: { rateLimit: { max: 8 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { email, password } = passwordLoginSchema.parse(req.body);
    const sessionId = await createSession(req, reply);
    return { user: await passwordLogin(ctx, sessionId, email, password) };
  });
  // Primeiro acesso (ou senha liberada pelo dono): código por e-mail + senha nova. Não entra: depois faz o login normal.
  app.post(`${P}/setup-code`, { config: { rateLimit: { max: 5 * scale, timeWindow: '10 minutes' } } }, async (req) => requestSetupCode(ctx, emailSchema.parse(req.body).email));
  app.post(`${P}/setup`, { config: { rateLimit: { max: 8 * scale, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const { email, code, password } = loginSchema.extend({ password: z.string().min(1).max(200) }).parse(req.body);
    await completeSetup(ctx, email, code, password);
    return reply.status(204).send();
  });
  app.post(`${P}/password`, async (req, reply) => {
    const sessionId = await requireSession(req).catch(() => {
      throw new AppError(401, 'not_logged_in', 'Entre no backoffice para continuar.');
    });
    const a = await admin(req);
    const { current, next } = changePasswordSchema.parse(req.body);
    await changePassword(ctx, sessionId, a, current, next);
    return reply.status(204).send();
  });
  app.post(`${P}/logout`, async (req, reply) => {
    const sessionId = await requireSession(req).catch(() => null);
    if (sessionId) await adminLogout(ctx, sessionId);
    return reply.status(204).send();
  });
  app.get(`${P}/me`, async (req) => {
    const a = await admin(req);
    return {
      user: a,
      sections: SECTIONS.map((s) => ({ id: s, label: SECTION_LABEL[s], allowed: can(a, s) })),
      roles: ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r], permissions: ROLE_PRESETS[r] })),
    };
  });

  // ---------- indicadores e jornada ----------
  app.get(`${P}/dashboard`, async (req) => {
    await admin(req, 'dashboard');
    return metrics.dashboard(ctx, daysQuery(req.query));
  });
  app.get(`${P}/jornada/resumo`, async (req) => {
    await admin(req, 'jornada', 'dashboard');
    const days = daysQuery(req.query);
    const [funnel, traffic] = await Promise.all([metrics.funnel(ctx, days), metrics.traffic(ctx, days)]);
    return { days, funnel, traffic };
  });
  app.get(`${P}/jornada/caso/:id`, async (req) => {
    await admin(req, 'jornada', 'clientes');
    return { timeline: await customers.caseTimeline(ctx, idParam((req.params as { id: string }).id)) };
  });
  app.get(`${P}/jornada/assinante/:id`, async (req) => {
    await admin(req, 'jornada', 'assinaturas', 'clientes');
    return { timeline: await customers.subscriberTimeline(ctx, idParam((req.params as { id: string }).id)) };
  });

  // ---------- clientes ----------
  app.get(`${P}/clientes/avulsos`, async (req) => {
    await admin(req, 'clientes');
    const q = req.query as { filtro?: string; q?: string; tipo?: string };
    return customers.listCases(ctx, { filter: q.filtro ?? 'todos', q: q.q, kind: q.tipo ?? 'map', page: pageQuery(req.query) });
  });
  app.get(`${P}/clientes/avulsos/:id`, async (req) => {
    await admin(req, 'clientes');
    return customers.caseDetail(ctx, idParam((req.params as { id: string }).id));
  });
  app.post(`${P}/contato/:caseId`, { config: { rateLimit: { max: 30 * scale, timeWindow: '1 minute' } } }, async (req) => {
    const a = await admin(req, 'clientes_pii');
    return customers.revealContact(ctx, a, idParam((req.params as { caseId: string }).caseId));
  });

  // ---------- assinaturas ----------
  app.get(`${P}/assinaturas`, async (req) => {
    await admin(req, 'assinaturas', 'clientes');
    const q = req.query as { status?: string; q?: string };
    return customers.listSubscribers(ctx, { status: q.status ?? 'todos', q: q.q, page: pageQuery(req.query) });
  });
  app.get(`${P}/assinaturas/resumo`, async (req) => {
    await admin(req, 'assinaturas', 'dashboard');
    return metrics.subscriptions(ctx, daysQuery(req.query));
  });
  // Ex-assinantes (cancelados): baixar TODOS os dados (.zip) e, depois, excluir. Só quem tem a permissão de dados.
  app.get(`${P}/assinaturas/cancelados`, async (req) => {
    await admin(req, 'assinaturas', 'dados_exportar');
    return accountData.listCanceled(ctx);
  });
  app.get(`${P}/assinaturas/cancelados/:id/dados.zip`, async (req, reply) => {
    const a = await admin(req, 'dados_exportar');
    const { zip, filename } = await accountData.buildSubscriberPackage(ctx, idParam((req.params as { id: string }).id), a.id, a.email);
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Cache-Control', 'no-store');
    return reply.send(zip);
  });
  app.delete(`${P}/assinaturas/cancelados/:id`, async (req) => {
    const a = await admin(req, 'dados_exportar');
    return accountData.adminPurge(ctx, idParam((req.params as { id: string }).id), a.id, purgeSchema.parse(req.body).confirmEmail);
  });
  app.get(`${P}/assinaturas/:id`, async (req) => {
    await admin(req, 'assinaturas', 'clientes');
    return customers.subscriberDetail(ctx, idParam((req.params as { id: string }).id));
  });
  app.post(`${P}/assinaturas/:id/acao`, async (req) => {
    const a = await admin(req, 'assinaturas');
    await customers.subscriptionAction(ctx, a, idParam((req.params as { id: string }).id), subAction.parse(req.body));
    return { ok: true };
  });

  // ---------- parcerias ----------
  app.get(`${P}/parcerias`, async (req) => {
    await admin(req, 'parcerias');
    return metrics.partnerships(ctx, daysQuery(req.query));
  });
  app.get(`${P}/parcerias/contatos`, async (req) => {
    await admin(req, 'parcerias');
    return { items: await customers.consentedContacts(ctx, { category: (req.query as { categoria?: string }).categoria, page: pageQuery(req.query) }) };
  });

  // ---------- produtos e preços ----------
  app.get(`${P}/produtos`, async (req) => {
    await admin(req, 'precos');
    return manage.listProducts(ctx);
  });
  app.put(`${P}/produtos/:code`, async (req) => {
    const a = await admin(req, 'precos');
    await manage.updateProduct(ctx, a, String((req.params as { code: string }).code).slice(0, 60), productPatch.parse(req.body));
    return manage.listProducts(ctx);
  });

  // ---------- configurações do site e das assinaturas ----------
  app.get(`${P}/config`, async (req) => {
    await admin(req, 'config_site');
    await refreshRuntime(ctx.db, ctx.config, true);
    const c = ctx.config;
    return {
      settings: currentSettings(c),
      environment: {
        emailConfigured: Boolean(ctx.email),
        gateway: ctx.gateway.name,
        aiKeyConfigured: Boolean(c.anthropicApiKey),
        aiModel: c.aiModel,
        aiWorkspaceConfigured: Boolean(c.anthropicWorkspaceId),
        publicUrl: c.publicUrl,
        env: c.env,
      },
    };
  });
  app.put(`${P}/config`, async (req) => {
    const a = await admin(req, 'config_site');
    const patch = runtimeSchema.parse(req.body);
    if (patch.subscriptionsEnabled === true && !ctx.email) throw new AppError(422, 'email_off', 'Não dá para ligar assinaturas sem o envio de e-mail configurado.');
    const saved = await saveRuntime(ctx.db, ctx.config, patch, a.id);
    
    await audit(ctx.db, `admin:${a.id}`, 'admin_config_update', 'settings', 'runtime', { patch, by: a.email });
    return { settings: saved };
  });

  // ---------- usuários e permissões ----------
  app.get(`${P}/usuarios`, async (req) => {
    await admin(req, 'config_usuarios');
    return { users: await manage.listUsers(ctx), sections: SECTIONS.map((s) => ({ id: s, label: SECTION_LABEL[s] })), roles: ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r], permissions: ROLE_PRESETS[r] })) };
  });
  app.post(`${P}/usuarios`, async (req, reply) => {
    const a = await admin(req, 'config_usuarios');
    const id = await manage.createUser(ctx, a, userCreate.parse(req.body));
    return reply.status(201).send({ id });
  });
  app.put(`${P}/usuarios/:id`, async (req) => {
    const a = await admin(req, 'config_usuarios');
    const id = idParam((req.params as { id: string }).id);
    const body = userPatch.parse(req.body);
    if (body.resetPassword) await releasePasswordReset(ctx, a, id);
    await manage.updateUser(ctx, a, id, body);
    return { ok: true };
  });

  // ---------- auditoria ----------
  app.get(`${P}/auditoria`, async (req) => {
    await admin(req, 'auditoria');
    return { items: await manage.listAudit(ctx, { scope: (req.query as { escopo?: string }).escopo, page: pageQuery(req.query) }) };
  });

  // ---------- marketing ----------
  app.get(`${P}/marketing/insights`, async (req) => {
    await admin(req, 'marketing');
    const days = daysQuery(req.query);
    const [ins, aud] = await Promise.all([marketing.insights(ctx, days), marketing.audiences(ctx)]);
    return { ...ins, audiences: aud, calendar: marketing.CALENDAR };
  });
  // ---------- e-mails de campanha (só para assinantes; descadastro em /api/unsubscribe) ----------
  app.get(`${P}/marketing/emails`, async (req) => {
    const a = await admin(req, 'marketing');
    return { campaigns: await campaigns.listCampaigns(ctx), audiences: await campaigns.audienceSizes(ctx), canSend: can(a, 'marketing_envio'), emailConfigured: Boolean(ctx.email), dailyCap: ctx.config.campaignDailyCap };
  });
  app.get(`${P}/marketing/emails/:id`, async (req) => {
    await admin(req, 'marketing');
    return campaigns.getCampaign(ctx, idParam((req.params as { id: string }).id));
  });
  app.post(`${P}/marketing/emails`, async (req, reply) => {
    const a = await admin(req, 'marketing');
    return reply.status(201).send({ id: await campaigns.saveCampaign(ctx, a, null, campaignSchema.parse(req.body)) });
  });
  app.put(`${P}/marketing/emails/:id`, async (req) => {
    const a = await admin(req, 'marketing');
    await campaigns.saveCampaign(ctx, a, idParam((req.params as { id: string }).id), campaignSchema.parse(req.body));
    return { ok: true };
  });
  app.delete(`${P}/marketing/emails/:id`, async (req, reply) => {
    const a = await admin(req, 'marketing');
    await campaigns.deleteCampaign(ctx, a, idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
  app.post(`${P}/marketing/emails/:id/teste`, { config: { rateLimit: { max: 10 * scale, timeWindow: '10 minutes' } } }, async (req) => {
    const a = await admin(req, 'marketing');
    await campaigns.sendTest(ctx, a, idParam((req.params as { id: string }).id));
    return { ok: true, to: a.email };
  });
  app.post(`${P}/marketing/emails/:id/enviar`, { config: { rateLimit: { max: 5 * scale, timeWindow: '10 minutes' } } }, async (req) => {
    const a = await admin(req, 'marketing_envio');
    return campaigns.startSending(ctx, a, idParam((req.params as { id: string }).id), z.object({ recipients: z.number().int().min(1) }).parse(req.body).recipients);
  });
  app.post(`${P}/marketing/emails/:id/parar`, async (req) => {
    const a = await admin(req, 'marketing_envio');
    await campaigns.cancelCampaign(ctx, a, idParam((req.params as { id: string }).id));
    return { ok: true };
  });

  app.get(`${P}/marketing/planos`, async (req) => {
    await admin(req, 'marketing');
    return { plans: await marketing.listPlans(ctx) };
  });
  app.post(`${P}/marketing/planos`, async (req, reply) => {
    const a = await admin(req, 'marketing');
    return reply.status(201).send({ id: await marketing.createPlan(ctx, a, planSchema.parse(req.body)) });
  });
  app.put(`${P}/marketing/planos/:id`, async (req) => {
    const a = await admin(req, 'marketing');
    await marketing.updatePlan(ctx, a, idParam((req.params as { id: string }).id), planSchema.partial().parse(req.body));
    return { ok: true };
  });
  app.delete(`${P}/marketing/planos/:id`, async (req, reply) => {
    const a = await admin(req, 'marketing');
    await marketing.deletePlan(ctx, a, idParam((req.params as { id: string }).id));
    return reply.status(204).send();
  });
}
