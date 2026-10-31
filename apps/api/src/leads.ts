// Propostas de parceiros (leads), depois da entrega. Ligado pela variável LEADS_ENABLED (revisão jurídica concluída, D-123).
// Princípios: consentimento específico e separado (nunca embutido nos termos nem condição de compra), caixa desmarcada,
// só categorias em que a troca/renegociação faz sentido para a pessoa, CPF nunca é coletado por nós, revogação a qualquer
// momento, e o Mapa continua honesto mesmo quando isso não gera lead.
import { createHmac } from 'node:crypto';
import type { DebtInput, Diagnosis } from './engine.ts';
import { decryptText, encryptText, hashPassword, hmac, newToken, safeEqual, sha256, signToken, verifyPassword, verifyToken } from './crypto.ts';
import { AppError, notFound } from './errors.ts';
import type { Ctx } from './services.ts';
import { audit, num, ownedCase } from './services.ts';

export const LEAD_TERMS_VERSION = 'minuta-propostas-2026-09-27';
export const MAX_PARTNERS_PER_LEAD = 3;
export const OFFERED_CATEGORIES = ['consignado', 'renegotiation'] as const;
export type LeadCategory = (typeof OFFERED_CATEGORIES)[number];
const MAX_ATTEMPTS = 5;

interface CaseRow {
  inputs: { debts?: DebtInput[] };
  employment_type: string;
  net_income_cents: string;
  age_band: string;
  uf: string;
  diagnosis: Diagnosis | null;
}

async function loadCase(ctx: Ctx, caseId: string): Promise<CaseRow> {
  const r = await ctx.db.query<CaseRow>(
    `SELECT c.inputs, c.employment_type, c.net_income_cents, c.age_band, c.uf,
            (SELECT d.content FROM app.deliverables d WHERE d.case_id = c.id AND d.product_code = 'recovery_map') AS diagnosis
       FROM app.cases c WHERE c.id = $1`,
    [caseId],
  );
  const row = r.rows[0];
  if (!row) throw notFound();
  return row;
}

/** Categorias que podemos oferecer a esta pessoa (honestas): consignado só se a troca reduz o custo; renegociação se há dívida em atraso. */
export function offeredCategories(diagnosis: Diagnosis, debts: DebtInput[]): LeadCategory[] {
  // As duas opções ficam sempre disponíveis e a pessoa marca o que quiser: o consignado (o parceiro avalia margem e vínculo) e a renegociação
  // (ajuda para negociar e buscar recursos com consciência). A estimativa de economia só aparece quando a troca de fato reduz o custo.
  void diagnosis;
  void debts;
  return ['consignado', 'renegotiation'];
}

export interface LeadState {
  enabled: boolean;
  available: boolean;
  categories: LeadCategory[];
  estimatedSavingsCents: number;
  active: { categories: string[]; since: number } | null;
  /** Perfil com mais chance de aprovar crédito consignado: renda ≥ R$ 2.500, 18 a 74 anos e CLT por prazo indeterminado, aposentado/pensionista ou servidor. Só muda a conversa da tela, não o que é oferecido. */
  priority?: boolean;
}

const PRIORITY_MIN_INCOME_CENTS = 250_000;
const PRIORITY_AGE_BANDS = new Set(['18-24', '25-34', '35-44', '45-54', '55-64', '65-74']); // '75+' fica de fora: a faixa não separa 75 de mais velhos
/** Regra do dono (18/10/2026). CLT só conta com contrato por prazo indeterminado; autônomo/MEI, outra situação e CLT temporário ficam de fora. */
export function fitsPartnerProfile(p: { employmentType: string; netIncomeCents: number; ageBand: string; cltContract?: string | null }): boolean {
  if (p.netIncomeCents < PRIORITY_MIN_INCOME_CENTS || !PRIORITY_AGE_BANDS.has(p.ageBand)) return false;
  if (p.employmentType === 'inss_retiree' || p.employmentType === 'public_servant') return true;
  return p.employmentType === 'clt' && p.cltContract === 'permanent';
}

export async function leadState(ctx: Ctx, caseId: string, diagnosis: Diagnosis, debts: DebtInput[]): Promise<LeadState> {
  if (!ctx.config.leadsEnabled) return { enabled: false, available: false, categories: [], estimatedSavingsCents: 0, active: null };
  const categories = offeredCategories(diagnosis, debts);
  const cur = await ctx.db.query<{ action: string; scope: { categories?: string[] }; created_at: Date | string }>(
    `SELECT action, scope, created_at FROM app.v_current_consents WHERE case_id = $1 AND purpose = 'lead_sharing'`,
    [caseId],
  );
  const c = cur.rows[0];
  const active = c && c.action === 'grant' ? { categories: c.scope.categories ?? [], since: new Date(c.created_at).getTime() } : null;
  const pf = await ctx.db.query<{ employment_type: string; net_income_cents: string; age_band: string; clt: string | null }>(
    `SELECT employment_type, net_income_cents, age_band, inputs->>'cltContract' AS clt FROM app.cases WHERE id = $1`,
    [caseId],
  );
  const p = pf.rows[0];
  const priority = p ? fitsPartnerProfile({ employmentType: p.employment_type, netIncomeCents: Number(p.net_income_cents), ageBand: p.age_band, cltContract: p.clt }) : false;
  return { enabled: true, available: categories.length > 0, categories, estimatedSavingsCents: diagnosis.refinance.suitabilityOk ? diagnosis.refinance.estimatedSavingsCents : 0, active, priority };
}

/** Estado do formulário de parceiro para um diagnóstico (pago ou não): a prévia grátis usa isto para mostrar o convite. */
export async function leadStateFor(ctx: Ctx, sessionId: string, caseId: string): Promise<LeadState> {
  if (!ctx.config.leadsEnabled) return { enabled: false, available: false, categories: [], estimatedSavingsCents: 0, active: null };
  await ownedCase(ctx.db, sessionId, caseId);
  const c = await loadCase(ctx, caseId);
  if (!c.diagnosis) return { enabled: false, available: false, categories: [], estimatedSavingsCents: 0, active: null };
  return leadState(ctx, caseId, c.diagnosis, c.inputs.debts ?? []);
}

const normalizePhone =(raw: string): string | null => {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2);
  return /^[1-9]{2}9?\d{8}$/.test(d) ? d : null;
};

const bandOf = (cents: number, edges: number[]): string => {
  const reais = cents / 100;
  const i = edges.findIndex((e) => reais < e);
  if (i === -1) return `${edges[edges.length - 1]}+`;
  return `${i === 0 ? 0 : edges[i - 1]}-${edges[i]}`;
};

export async function leadDocumentId(ctx: Ctx, q: Ctx['db']): Promise<string> {
  await q.query(`INSERT INTO app.legal_documents(kind, version, content_sha256) VALUES ('lead_sharing', $1, $2) ON CONFLICT (kind, version) DO NOTHING`, [LEAD_TERMS_VERSION, sha256(LEAD_TERMS_VERSION)]);
  const r = await q.query<{ id: string }>(`SELECT id FROM app.legal_documents WHERE kind = 'lead_sharing' AND version = $1`, [LEAD_TERMS_VERSION]);
  return r.rows[0]!.id;
}

export interface LeadInput {
  name: string;
  phone: string;
  email?: string | undefined;
  categories: string[];
  consent: true;
}

export async function submitLead(ctx: Ctx, args: { sessionId: string; caseId: string; ipHash: Buffer | null; userAgent: string | null; input: LeadInput }): Promise<{ partners: number }> {
  if (!ctx.config.leadsEnabled) throw notFound();
  // Vale também para quem só fez o diagnóstico grátis: os dados do perfil já vieram do formulário do diagnóstico (nada é pedido de novo, só nome e telefone).
  await ownedCase(ctx.db, args.sessionId, args.caseId);
  const c = await loadCase(ctx, args.caseId);
  const debts = c.inputs.debts ?? [];
  if (!c.diagnosis) throw new AppError(409, 'not_ready', 'O Mapa ainda está sendo preparado');

  const offered = offeredCategories(c.diagnosis, debts);
  const categories = [...new Set(args.input.categories)].filter((k): k is LeadCategory => (offered as string[]).includes(k));
  if (categories.length === 0 || categories.length !== new Set(args.input.categories).size) throw new AppError(422, 'not_applicable', 'Escolha só categorias oferecidas para o seu caso');
  const phone = normalizePhone(args.input.phone);
  if (!phone) throw new AppError(422, 'invalid_phone', 'Confira o telefone com DDD');

  const state = await leadState(ctx, args.caseId, c.diagnosis, debts);
  if (state.active) throw new AppError(409, 'already_active', 'Você já autorizou o recebimento de propostas');

  const creditOk = c.diagnosis.refinance.suitabilityOk;
  const income = num(c.net_income_cents);
  const total = debts.reduce((s, d) => s + d.balanceCents, 0);
  const secret = ctx.config.secret;

  const deliveries = await ctx.db.tx(async (q) => {
    const docId = await leadDocumentId(ctx, q as Ctx['db']);
    const consent = await q.query<{ id: string }>(
      `INSERT INTO app.consents(case_id, legal_document_id, purpose, action, scope, ip_hash, user_agent) VALUES ($1,$2,'lead_sharing','grant',$3::jsonb,$4,$5) RETURNING id`,
      [args.caseId, docId, JSON.stringify({ categories }), args.ipHash, args.userAgent ? args.userAgent.slice(0, 300) : null],
    );
    const consentId = consent.rows[0]!.id;
    await q.query(
      `INSERT INTO app.lead_contacts(case_id, full_name_enc, phone_enc, email_enc, phone_hmac) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (case_id) DO UPDATE SET full_name_enc = EXCLUDED.full_name_enc, phone_enc = EXCLUDED.phone_enc, email_enc = EXCLUDED.email_enc, phone_hmac = EXCLUDED.phone_hmac`,
      [args.caseId, encryptText(secret, args.input.name.trim()), encryptText(secret, phone), args.input.email ? encryptText(secret, args.input.email.trim().toLowerCase()) : null, hmac(secret, `phone:${phone}`)],
    );
    await q.query(
      `INSERT INTO app.lead_profiles(case_id, employment_type, income_band, age_band, uf, debt_band, debt_kinds, debt_to_income_pct, suitability_ok, suitability_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (case_id) DO UPDATE SET income_band = EXCLUDED.income_band, debt_band = EXCLUDED.debt_band, debt_kinds = EXCLUDED.debt_kinds, debt_to_income_pct = EXCLUDED.debt_to_income_pct, suitability_ok = EXCLUDED.suitability_ok`,
      [
        args.caseId, c.employment_type, bandOf(income, [1500, 2500, 4000, 7000, 12000]), c.age_band, c.uf, bandOf(total, [2000, 5000, 15000, 40000]),
        [...new Set(debts.map((d) => d.kind))], income > 0 ? Math.round((c.diagnosis!.budget.declaredPaymentsCents / income) * 10000) / 100 : null, creditOk, creditOk ? 'troca reduz o custo' : c.diagnosis!.refinance.reason,
      ],
    );
    await q.query(`SELECT 1 FROM app.lead_profiles WHERE case_id = $1 FOR UPDATE`, [args.caseId]); // limite de parceiros por lead

    const camps = await q.query<{ id: string; partner_id: string; price_per_lead_cents: string }>(
      `SELECT c.id, c.partner_id, c.price_per_lead_cents
         FROM app.partner_campaigns c JOIN app.partners p ON p.id = c.partner_id AND p.status = 'active'
        WHERE c.status = 'active' AND c.consent_category = ANY($1::text[])
          AND (cardinality(c.employment_types) = 0 OR $2 = ANY(c.employment_types))
          AND (cardinality(c.ufs) = 0 OR $3::char(2) = ANY(c.ufs))
          AND (c.min_income_cents IS NULL OR $4::bigint >= c.min_income_cents)
          AND (c.max_income_cents IS NULL OR $4::bigint <= c.max_income_cents)
          AND (SELECT count(*) FROM app.lead_deliveries d WHERE d.campaign_id = c.id AND d.created_at >= date_trunc('day', now())) < c.daily_cap
          AND (c.monthly_budget_cents IS NULL OR (SELECT coalesce(sum(d.price_cents), 0) FROM app.lead_deliveries d WHERE d.campaign_id = c.id AND d.created_at >= date_trunc('month', now())) + c.price_per_lead_cents <= c.monthly_budget_cents)
        ORDER BY c.price_per_lead_cents DESC, c.created_at`,
      [categories, c.employment_type, c.uf, income],
    );
    const seen = new Set<string>();
    let n = 0;
    for (const camp of camps.rows) {
      if (seen.has(camp.partner_id) || n >= MAX_PARTNERS_PER_LEAD) continue;
      seen.add(camp.partner_id);
      const ins = await q.query(
        `INSERT INTO app.lead_deliveries(case_id, partner_id, campaign_id, consent_id, price_cents) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (case_id, partner_id) DO NOTHING`,
        [args.caseId, camp.partner_id, camp.id, consentId, num(camp.price_per_lead_cents)],
      );
      if (ins.rowCount > 0) n += 1;
    }
    await audit(q, `session:${args.sessionId}`, 'lead_consent_granted', 'case', args.caseId, { categories, partners: n });
    return n;
  });
  return { partners: deliveries };
}

/** Revoga: apaga contato e perfil, cancela o que não foi enviado e registra a revogação (o parceiro que já recebeu vê "titular revogou"). */
export async function revokeLead(ctx: Ctx, sessionId: string, caseId: string): Promise<void> {
  if (!ctx.config.leadsEnabled) throw notFound();
  await ownedCase(ctx.db, sessionId, caseId);
  await ctx.db.tx(async (q) => {
    const docId = await leadDocumentId(ctx, q as Ctx['db']);
    const cur = await q.query<{ action: string }>(`SELECT action FROM app.v_current_consents WHERE case_id = $1 AND purpose = 'lead_sharing'`, [caseId]);
    if (cur.rows[0]?.action !== 'grant') throw new AppError(409, 'not_active', 'Não há autorização ativa');
    await q.query(`INSERT INTO app.consents(case_id, legal_document_id, purpose, action, scope) VALUES ($1,$2,'lead_sharing','revoke','{}'::jsonb)`, [caseId, docId]);
    await q.query(`DELETE FROM app.lead_contacts WHERE case_id = $1`, [caseId]);
    await q.query(`DELETE FROM app.lead_profiles WHERE case_id = $1`, [caseId]);
    await q.query(`UPDATE app.lead_deliveries SET status = 'rejected' WHERE case_id = $1 AND status IN ('queued','failed')`, [caseId]);
    // A cópia que o parceiro guarda na entrega também some: quem revogou deixa de aparecer na lista dele.
    await q.query(`UPDATE app.lead_deliveries SET kept_name_enc = NULL, kept_phone_enc = NULL, kept_email_enc = NULL, kept_phone_hmac = NULL, kept_uf = NULL, kept_employment_type = NULL, kept_income_band = NULL, kept_debt_band = NULL WHERE case_id = $1`, [caseId]);
    // O contrato fechado continua nos números (valor e comissão), mas sem o nome do titular que revogou.
    await q.query(`UPDATE app.partner_deals SET client_name = NULL WHERE delivery_id IN (SELECT id FROM app.lead_deliveries WHERE case_id = $1)`, [caseId]);
    await q.query(`DELETE FROM app.partner_events WHERE delivery_id IN (SELECT id FROM app.lead_deliveries WHERE case_id = $1)`, [caseId]);
    await audit(q, `session:${sessionId}`, 'lead_consent_revoked', 'case', caseId);
  });
}

// ---------------------------------------------------------------------------
// Entrega ao parceiro (webhook assinado). Chamada pelo worker.
// ---------------------------------------------------------------------------
export function assertPublicHttpsUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError(422, 'invalid_webhook', 'Endereço de webhook inválido');
  }
  const host = u.hostname.toLowerCase();
  const privateHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local') || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':') || !host.includes('.');
  if (u.protocol !== 'https:' || privateHost || u.username || u.password) throw new AppError(422, 'invalid_webhook', 'O webhook precisa ser https, com nome de domínio público');
  return u;
}

/**
 * O parceiro é dono do contato que recebeu: a entrega guarda a própria cópia (criptografada) para o lead não sumir do painel
 * dele quando o caso do Fôlego é expurgado por prazo. A revogação do titular e o "apagar meus dados" apagam essa cópia.
 */
export async function keepLeadCopy(db: Ctx['db'], deliveryId: string): Promise<void> {
  await db.query(
    `UPDATE app.lead_deliveries d
        SET kept_name_enc = lc.full_name_enc, kept_phone_enc = lc.phone_enc, kept_email_enc = lc.email_enc, kept_phone_hmac = lc.phone_hmac,
            kept_uf = lp.uf, kept_employment_type = lp.employment_type, kept_income_band = lp.income_band, kept_debt_band = lp.debt_band
       FROM app.lead_contacts lc LEFT JOIN app.lead_profiles lp ON lp.case_id = lc.case_id
      WHERE d.id = $1 AND lc.case_id = d.case_id`,
    [deliveryId],
  );
}

export async function deliverPendingLeads(ctx: Ctx, opts: { fetchFn?: typeof fetch; limit?: number; log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.config.leadsEnabled) return 0;
  const fetchFn = opts.fetchFn ?? fetch;
  const claimed = await ctx.db.query<{ id: string; case_id: string; campaign_id: string; consent_id: string; attempts: number }>(
    `UPDATE app.lead_deliveries
        SET attempts = attempts + 1, next_attempt_at = now() + make_interval(mins => (attempts + 1) * 2)
      WHERE id IN (
        SELECT id FROM app.lead_deliveries
         WHERE status IN ('queued','failed') AND attempts < ${MAX_ATTEMPTS} AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
      RETURNING id, case_id, campaign_id, consent_id, attempts`,
    [opts.limit ?? 20],
  );
  for (const d of claimed.rows) {
    const info = await ctx.db.query<{ webhook_url: string | null; webhook_secret_enc: Buffer | null; category: string; consented_at: Date | string }>(
      `SELECT c.webhook_url, c.webhook_secret_enc, c.consent_category AS category, (SELECT created_at FROM app.consents WHERE id = $2) AS consented_at FROM app.partner_campaigns c WHERE c.id = $1`,
      [d.campaign_id, d.consent_id],
    );
    const contact = await ctx.db.query<{ full_name_enc: Buffer; phone_enc: Buffer; email_enc: Buffer | null }>(`SELECT full_name_enc, phone_enc, email_enc FROM app.lead_contacts WHERE case_id = $1`, [d.case_id]);
    const profile = await ctx.db.query<{ employment_type: string; income_band: string; age_band: string; uf: string; debt_band: string; debt_kinds: string[] }>(`SELECT employment_type, income_band, age_band, uf, debt_band, debt_kinds FROM app.lead_profiles WHERE case_id = $1`, [d.case_id]);
    const camp = info.rows[0];
    const ct = contact.rows[0];
    const pf = profile.rows[0];
    if (!camp || !ct || !pf) {
      await ctx.db.query(`UPDATE app.lead_deliveries SET status = 'rejected' WHERE id = $1`, [d.id]); // revogado
      continue;
    }
    if (!camp.webhook_url || !camp.webhook_secret_enc) {
      // Campanha só de portal (sem webhook): o contato já está disponível na tela do parceiro.
      await ctx.db.query(`UPDATE app.lead_deliveries SET status = 'delivered', delivered_at = now() WHERE id = $1`, [d.id]);
      await keepLeadCopy(ctx.db, d.id);
      opts.log?.({ evento: 'lead_no_portal', entrega: d.id });
      continue;
    }
    const secret = ctx.config.secret;
    const payload = JSON.stringify({
      leadId: d.id,
      category: camp.category,
      consentedAt: new Date(camp.consented_at).toISOString(),
      name: decryptText(secret, ct.full_name_enc),
      phone: decryptText(secret, ct.phone_enc),
      email: ct.email_enc ? decryptText(secret, ct.email_enc) : null,
      uf: pf.uf,
      employmentType: pf.employment_type,
      ageBand: pf.age_band,
      incomeBand: pf.income_band,
      debtBand: pf.debt_band,
      debtKinds: pf.debt_kinds,
    });
    try {
      const url = assertPublicHttpsUrl(camp.webhook_url);
      const signature = createHmac('sha256', decryptText(secret, camp.webhook_secret_enc)).update(payload).digest('hex');
      const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-folego-signature': `sha256=${signature}` }, body: payload, signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (res.ok) {
        await ctx.db.query(`UPDATE app.lead_deliveries SET status = 'delivered', delivered_at = now(), last_response_code = $2 WHERE id = $1`, [d.id, res.status]);
        await keepLeadCopy(ctx.db, d.id);
        opts.log?.({ evento: 'lead_entregue', entrega: d.id });
      } else {
        await ctx.db.query(`UPDATE app.lead_deliveries SET status = 'failed', last_response_code = $2 WHERE id = $1`, [d.id, res.status]);
        opts.log?.({ evento: 'lead_falhou', entrega: d.id, codigo: res.status });
      }
    } catch (error) {
      await ctx.db.query(`UPDATE app.lead_deliveries SET status = 'failed', last_response_code = 0 WHERE id = $1`, [d.id]);
      opts.log?.({ evento: 'lead_erro', entrega: d.id, erro: error instanceof Error ? error.message.slice(0, 100) : 'erro' });
    }
  }
  return claimed.rows.length;
}

// ---------------------------------------------------------------------------
// Parceiros: cadastro (administrador), login e portal (só os leads do próprio parceiro)
// ---------------------------------------------------------------------------
export interface NewPartner {
  legalName: string;
  cnpj: string;
  category: 'consignado' | 'bank' | 'fintech' | 'renegotiation';
  email: string;
  tradeName?: string | undefined;
  phone?: string | undefined;
  city?: string | undefined;
  uf?: string | undefined;
  address?: string | undefined;
  campaign: {
    name: string;
    consentCategory: LeadCategory;
    employmentTypes: string[];
    ufs: string[];
    minIncomeCents?: number | undefined;
    maxIncomeCents?: number | undefined;
    pricePerLeadCents: number;
    commissionBps?: number | undefined;
    dailyCap: number;
    monthlyBudgetCents?: number | undefined;
    webhookUrl?: string | undefined;
  };
}

export async function createPartner(ctx: Ctx, input: NewPartner): Promise<{ partnerId: string; password: string; webhookSecret: string }> {
  if (input.campaign.webhookUrl) assertPublicHttpsUrl(input.campaign.webhookUrl);
  const password = newToken().slice(0, 20);
  const webhookSecret = newToken();
  const partnerId = await ctx.db.tx(async (q) => {
    const p = await q.query<{ id: string }>(
      `INSERT INTO app.partners(legal_name, cnpj, category, status, trade_name, phone, city, uf, address) VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8) RETURNING id`,
      [input.legalName, input.cnpj, input.category, input.tradeName ?? null, input.phone ?? null, input.city ?? null, input.uf ?? null, input.address ?? null],
    );
    const id = p.rows[0]!.id;
    await q.query(`INSERT INTO app.partner_users(partner_id, email, password_hash, role) VALUES ($1,$2,$3,'admin')`, [id, input.email, hashPassword(password)]);
    const c = input.campaign;
    await q.query(
      `INSERT INTO app.partner_campaigns(partner_id, name, status, consent_category, employment_types, ufs, min_income_cents, max_income_cents, price_per_lead_cents, commission_bps, daily_cap, monthly_budget_cents, webhook_url, webhook_secret_enc)
       VALUES ($1,$2,'active',$3,$4::text[],$5::char(2)[],$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, c.name, c.consentCategory, c.employmentTypes, c.ufs, c.minIncomeCents ?? null, c.maxIncomeCents ?? null, c.pricePerLeadCents, c.commissionBps ?? 0, c.dailyCap, c.monthlyBudgetCents ?? null, c.webhookUrl ?? null, c.webhookUrl ? encryptText(ctx.config.secret, webhookSecret) : null],
    );
    await audit(q, 'admin', 'partner_created', 'partner', id, { category: input.category });
    return id;
  });
  return { partnerId, password, webhookSecret };
}

const DUMMY_HASH = hashPassword('nao-existe');

export async function partnerLogin(ctx: Ctx, email: string, password: string): Promise<{ token: string; partnerName: string; tradeName: string | null }> {
  const r = await ctx.db.query<{ id: string; partner_id: string; password_hash: string; legal_name: string; trade_name: string | null; status: string }>(
    `SELECT u.id, u.partner_id, u.password_hash, p.legal_name, p.trade_name, p.status FROM app.partner_users u JOIN app.partners p ON p.id = u.partner_id WHERE u.email = $1`,
    [email],
  );
  const u = r.rows[0];
  const ok = verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok || u.status !== 'active') throw new AppError(401, 'invalid_credentials', 'E-mail ou senha incorretos');
  return { token: signToken(ctx.config.secret, { pid: u.partner_id, uid: u.id }, 12 * 3600), partnerName: u.legal_name, tradeName: u.trade_name };
}

export function partnerFromToken(ctx: Ctx, header: string | undefined): string {
  const m = /^Bearer (.+)$/.exec(header ?? '');
  const payload = m ? verifyToken(ctx.config.secret, m[1]!) : null;
  if (!payload || typeof payload.pid !== 'string') throw new AppError(401, 'unauthorized', 'Entre novamente');
  return payload.pid;
}

export async function partnerLeads(ctx: Ctx, partnerId: string): Promise<Record<string, unknown>[]> {
  const r = await ctx.db.query<{
    id: string; status: string; created_at: Date | string; delivered_at: Date | string | null; price_cents: string; category: string; campaign: string; commission_bps: number; deals_n: string; deals_cents: string;
    full_name_enc: Buffer | null; phone_enc: Buffer | null; email_enc: Buffer | null; uf: string | null; employment_type: string | null; income_band: string | null; debt_band: string | null;
  }>(
    `SELECT d.id, d.status, d.created_at, d.delivered_at, d.price_cents, c.consent_category AS category, c.name AS campaign, c.commission_bps,
            (SELECT count(*) FROM app.partner_deals pd WHERE pd.delivery_id = d.id AND pd.status = 'fechado')::text AS deals_n,
            (SELECT coalesce(sum(pd.amount_cents), 0) FROM app.partner_deals pd WHERE pd.delivery_id = d.id AND pd.status = 'fechado')::text AS deals_cents,
            coalesce(lc.full_name_enc, d.kept_name_enc) AS full_name_enc, coalesce(lc.phone_enc, d.kept_phone_enc) AS phone_enc, coalesce(lc.email_enc, d.kept_email_enc) AS email_enc,
            coalesce(lp.uf, d.kept_uf) AS uf, coalesce(lp.employment_type, d.kept_employment_type) AS employment_type, coalesce(lp.income_band, d.kept_income_band) AS income_band, coalesce(lp.debt_band, d.kept_debt_band) AS debt_band
       FROM app.lead_deliveries d
       JOIN app.partner_campaigns c ON c.id = d.campaign_id
       LEFT JOIN app.lead_contacts lc ON lc.case_id = d.case_id
       LEFT JOIN app.lead_profiles lp ON lp.case_id = d.case_id
      WHERE d.partner_id = $1 AND (lc.case_id IS NOT NULL OR d.kept_phone_enc IS NOT NULL) ORDER BY d.created_at DESC LIMIT 200`, // sem contato nem cópia = o titular revogou ou apagou os dados (a cópia da entrega é apagada junto) e some da lista; o expurgo por prazo NÃO tira o lead do parceiro
    [partnerId],
  );
  return r.rows.map((x) => {
    const revoked = !x.phone_enc;
    const visible = !revoked && x.status !== 'queued' && x.status !== 'failed' && x.status !== 'rejected';
    return {
      id: x.id, status: x.status, category: x.category, campaign: x.campaign, createdAt: new Date(x.created_at).getTime(), priceCents: num(x.price_cents),
      commissionBps: x.commission_bps, dealsCount: num(x.deals_n), dealsCents: num(x.deals_cents),
      revoked, // titular revogou: o parceiro deve apagar os dados
      uf: revoked ? null : x.uf, employmentType: revoked ? null : x.employment_type, incomeBand: revoked ? null : x.income_band, debtBand: revoked ? null : x.debt_band,
      name: visible && x.full_name_enc ? decryptText(ctx.config.secret, x.full_name_enc) : null,
      phone: visible && x.phone_enc ? decryptText(ctx.config.secret, x.phone_enc) : null,
      email: visible && x.email_enc ? decryptText(ctx.config.secret, x.email_enc) : null,
    };
  });
}

export async function partnerSetStatus(ctx: Ctx, partnerId: string, deliveryId: string, status: 'contacted' | 'converted' | 'rejected'): Promise<void> {
  const r = await ctx.db.query(`UPDATE app.lead_deliveries SET status = $3 WHERE id = $1 AND partner_id = $2 AND status IN ('delivered','contacted')`, [deliveryId, partnerId, status]);
  if (r.rowCount === 0) throw notFound();
  await audit(ctx.db, `partner:${partnerId}`, 'lead_status', 'lead_delivery', deliveryId, { status });
}

export const isAdminToken = (ctx: Ctx, header: string | string[] | undefined): boolean => {
  const expected = ctx.config.partnerAdminToken;
  return typeof header === 'string' && expected !== null && expected.length >= 32 && safeEqual(header, expected);
};
