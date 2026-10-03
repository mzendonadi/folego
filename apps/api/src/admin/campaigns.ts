// E-mail de campanha para ASSINANTES (têm conta e e-mail; compradores avulsos são anônimos e nunca entram).
// Travas: quem se descadastrou nunca recebe; no máximo 1 campanha por pessoa a cada 7 dias; teto diário de envios;
// o envio só sai depois que alguém com a permissão "enviar campanhas" aprova, depois de ver o tamanho do público e
// de mandar um teste para si; todo e-mail leva link de descadastro (e o cabeçalho List-Unsubscribe).
import { AppError, notFound } from '../errors.ts';
import { hmac, safeEqual } from '../crypto.ts';
import { layout } from '../email.ts';
import type { Ctx } from '../services.ts';
import { audit, num } from '../services.ts';
import type { AdminUser } from './auth.ts';

const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);
const FREQUENCY_DAYS = 7;
const ACTIVE = `s.status = 'active' AND s.current_period_end > now()`;

/** Públicos de assinantes. `where` é SQL fixo (nunca vem do usuário). */
export const AUDIENCES: { id: string; name: string; where: string }[] = [
  { id: 'renovar_7d', name: 'Assinantes que vencem em 7 dias', where: `${ACTIVE} AND NOT s.cancel_at_period_end AND s.current_period_end < now() + interval '7 days'` },
  { id: 'em_debito', name: 'Assinantes em débito (venceram sem renovar)', where: `NOT (${ACTIVE})` },
  { id: 'recuperar_30d', name: 'Assinaturas vencidas nos últimos 30 dias (recuperar)', where: `NOT (${ACTIVE}) AND s.current_period_end > now() - interval '30 days'` },
  { id: 'sem_uso_14d', name: 'Assinantes sem lançamento há 14 dias', where: `${ACTIVE} AND NOT EXISTS (SELECT 1 FROM app.ledger_entries l WHERE l.subscriber_id = s.subscriber_id AND l.created_at > now() - interval '14 days')` },
  { id: 'upgrade_ousado', name: 'Plano Controle há mais de 20 dias (candidatos ao Ousado)', where: `${ACTIVE} AND s.plan = 'controle' AND s.created_at < now() - interval '20 days'` },
  { id: 'todos_ativos', name: 'Todos os assinantes ativos', where: ACTIVE },
];
const audienceOf = (id: string) => AUDIENCES.find((a) => a.id === id);

const FROM = `FROM app.subscriptions s JOIN app.subscribers b ON b.id = s.subscriber_id AND b.deleted_at IS NULL AND b.marketing_opt_out_at IS NULL`;
const NOT_RECENT = `NOT EXISTS (SELECT 1 FROM app.email_sends e WHERE e.subscriber_id = s.subscriber_id AND e.status = 'sent' AND e.sent_at > now() - interval '${FREQUENCY_DAYS} days')`;

export async function audienceSizes(ctx: Ctx) {
  const out: { id: string; name: string; total: number; eligible: number }[] = [];
  for (const a of AUDIENCES) {
    const r = await ctx.db.query<{ total: string; eligible: string }>(`SELECT count(*)::text AS total, count(*) FILTER (WHERE ${NOT_RECENT})::text AS eligible ${FROM} WHERE ${a.where}`);
    out.push({ id: a.id, name: a.name, total: num(r.rows[0]?.total ?? 0), eligible: num(r.rows[0]?.eligible ?? 0) });
  }
  return out;
}

// ---------- descadastro (link assinado por assinante; vale sem login) ----------
const unsubToken = (ctx: Ctx, subscriberId: string) => `${subscriberId}.${hmac(ctx.config.secret, `unsub:${subscriberId}`).toString('base64url').slice(0, 32)}`;
export const unsubscribeUrl = (ctx: Ctx, subscriberId: string) => `${ctx.config.publicUrl}/#/descadastrar/${unsubToken(ctx, subscriberId)}`;

export async function unsubscribe(ctx: Ctx, token: string): Promise<void> {
  const [id, sig] = token.split('.');
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id) || !safeEqual(sig, hmac(ctx.config.secret, `unsub:${id}`).toString('base64url').slice(0, 32))) throw new AppError(400, 'invalid_link', 'Este link de cancelamento não é válido.');
  await ctx.db.query(`UPDATE app.subscribers SET marketing_opt_out_at = coalesce(marketing_opt_out_at, now()) WHERE id = $1`, [id]);
  await audit(ctx.db, `subscriber:${id}`, 'marketing_unsubscribe', 'subscriber', id);
}

// ---------- campanhas ----------
export interface CampaignInput {
  name: string;
  audience: string;
  subject: string;
  body: string;
  buttonLabel?: string | null | undefined;
  buttonUrl?: string | null | undefined;
}

function validate(ctx: Ctx, input: CampaignInput) {
  if (!audienceOf(input.audience)) throw new AppError(422, 'invalid_audience', 'Público inválido.');
  if (input.buttonUrl) {
    let u: URL;
    try {
      u = new URL(input.buttonUrl);
    } catch {
      throw new AppError(422, 'invalid_url', 'O endereço do botão não é válido.');
    }
    if (u.origin !== new URL(ctx.config.publicUrl).origin) throw new AppError(422, 'invalid_url', 'O botão só pode apontar para o próprio site (folego.online).');
  }
  if ((input.buttonUrl && !input.buttonLabel) || (!input.buttonUrl && input.buttonLabel)) throw new AppError(422, 'invalid_button', 'Preencha o texto e o endereço do botão (ou deixe os dois vazios).');
  if (/https?:\/\//i.test(`${input.subject}`)) throw new AppError(422, 'invalid_subject', 'O assunto não pode ter link.');
}

export async function listCampaigns(ctx: Ctx) {
  const r = await ctx.db.query<{ id: string; name: string; audience: string; subject: string; status: string; recipients: number; created_at: Date; sent_started_at: Date | null; finished_at: Date | null; sent: string; failed: string; skipped: string; queued: string; opted: string }>(
    `SELECT c.id, c.name, c.audience, c.subject, c.status, c.recipients, c.created_at, c.sent_started_at, c.finished_at,
            count(e.*) FILTER (WHERE e.status='sent')::text AS sent, count(e.*) FILTER (WHERE e.status='failed')::text AS failed,
            count(e.*) FILTER (WHERE e.status='skipped')::text AS skipped, count(e.*) FILTER (WHERE e.status='queued')::text AS queued,
            (SELECT count(*) FROM app.audit_log a WHERE a.action = 'marketing_unsubscribe' AND c.sent_started_at IS NOT NULL AND a.occurred_at >= c.sent_started_at AND (c.finished_at IS NULL OR a.occurred_at <= c.finished_at + interval '3 days'))::text AS opted
       FROM app.email_campaigns c LEFT JOIN app.email_sends e ON e.campaign_id = c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50`,
  );
  return r.rows.map((c) => ({ id: c.id, name: c.name, audience: c.audience, audienceName: audienceOf(c.audience)?.name ?? c.audience, subject: c.subject, status: c.status, recipients: c.recipients, createdAt: iso(c.created_at), startedAt: iso(c.sent_started_at), finishedAt: iso(c.finished_at), sent: num(c.sent), failed: num(c.failed), skipped: num(c.skipped), queued: num(c.queued), unsubscribedAfter: num(c.opted) }));
}

export async function getCampaign(ctx: Ctx, id: string) {
  const r = await ctx.db.query<{ id: string; name: string; audience: string; subject: string; body: string; button_label: string | null; button_url: string | null; status: string }>(`SELECT id, name, audience, subject, body, button_label, button_url, status FROM app.email_campaigns WHERE id = $1`, [id]);
  const c = r.rows[0];
  if (!c) throw notFound();
  return { id: c.id, name: c.name, audience: c.audience, subject: c.subject, body: c.body, buttonLabel: c.button_label, buttonUrl: c.button_url, status: c.status };
}

export async function saveCampaign(ctx: Ctx, admin: AdminUser, id: string | null, input: CampaignInput): Promise<string> {
  validate(ctx, input);
  if (id) {
    const cur = await ctx.db.query<{ status: string }>(`SELECT status FROM app.email_campaigns WHERE id = $1`, [id]);
    if (!cur.rows[0]) throw notFound();
    if (cur.rows[0].status !== 'draft') throw new AppError(409, 'not_draft', 'Só dá para editar campanha em rascunho.');
    await ctx.db.query(`UPDATE app.email_campaigns SET name=$2, audience=$3, subject=$4, body=$5, button_label=$6, button_url=$7 WHERE id=$1`, [id, input.name, input.audience, input.subject, input.body, input.buttonLabel || null, input.buttonUrl || null]);
    await audit(ctx.db, `admin:${admin.id}`, 'admin_campaign_update', 'campaign', id, { by: admin.email });
    return id;
  }
  const r = await ctx.db.query<{ id: string }>(`INSERT INTO app.email_campaigns(name, audience, subject, body, button_label, button_url, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [input.name, input.audience, input.subject, input.body, input.buttonLabel || null, input.buttonUrl || null, admin.id]);
  await audit(ctx.db, `admin:${admin.id}`, 'admin_campaign_create', 'campaign', r.rows[0]!.id, { name: input.name, by: admin.email });
  return r.rows[0]!.id;
}

export async function deleteCampaign(ctx: Ctx, admin: AdminUser, id: string): Promise<void> {
  const r = await ctx.db.query(`DELETE FROM app.email_campaigns WHERE id = $1 AND status = 'draft'`, [id]);
  if (r.rowCount === 0) throw new AppError(409, 'not_draft', 'Só dá para apagar campanha em rascunho.');
  await audit(ctx.db, `admin:${admin.id}`, 'admin_campaign_delete', 'campaign', id, { by: admin.email });
}

function build(ctx: Ctx, c: { subject: string; body: string; button_label: string | null; button_url: string | null }, subscriberId: string, to: string) {
  const url = unsubscribeUrl(ctx, subscriberId);
  const paragraphs = c.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const { text, html } = layout(c.subject, paragraphs, c.button_label && c.button_url ? { label: c.button_label, url: c.button_url } : undefined, { unsubscribeUrl: url });
  return { to, subject: c.subject, text, html, // Um clique no "cancelar inscrição" do Gmail/Outlook faz POST direto neste endereço (a rota é liberada da checagem anti-CSRF).
  headers: { 'List-Unsubscribe': `<${ctx.config.publicUrl}/api/unsubscribe?t=${unsubToken(ctx, subscriberId)}>, <${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

/** Manda uma prévia para o e-mail de quem está logado no backoffice (com um link de descadastro de mentira que não afeta ninguém). */
export async function sendTest(ctx: Ctx, admin: AdminUser, id: string): Promise<void> {
  if (!ctx.email) throw new AppError(503, 'email_off', 'O envio de e-mail não está configurado.');
  const c = await ctx.db.query<{ subject: string; body: string; button_label: string | null; button_url: string | null }>(`SELECT subject, body, button_label, button_url FROM app.email_campaigns WHERE id = $1`, [id]);
  if (!c.rows[0]) throw notFound();
  const msg = build(ctx, c.rows[0], '00000000-0000-0000-0000-000000000000', admin.email);
  await ctx.email.send({ ...msg, subject: `[TESTE] ${msg.subject}` });
  await ctx.db.query(`UPDATE app.email_campaigns SET approved_by = NULL WHERE id = $1`, [id]);
  await audit(ctx.db, `admin:${admin.id}`, 'admin_campaign_test', 'campaign', id, { by: admin.email });
}

/** Aprova e enfileira o envio para quem está elegível agora. Exige que um teste tenha sido enviado antes. */
export async function startSending(ctx: Ctx, admin: AdminUser, id: string, expectedRecipients: number): Promise<{ recipients: number }> {
  if (!ctx.email) throw new AppError(503, 'email_off', 'O envio de e-mail não está configurado.');
  const tested = await ctx.db.query(`SELECT 1 FROM app.audit_log WHERE action = 'admin_campaign_test' AND entity = 'campaign' AND entity_id = $1 LIMIT 1`, [id]);
  if (tested.rows.length === 0) throw new AppError(409, 'test_required', 'Envie um teste para o seu e-mail antes de enviar para o público.');
  return ctx.db.tx(async (q) => {
    const cur = await q.query<{ audience: string; status: string }>(`SELECT audience, status FROM app.email_campaigns WHERE id = $1 FOR UPDATE`, [id]);
    const c = cur.rows[0];
    if (!c) throw notFound();
    if (c.status !== 'draft') throw new AppError(409, 'not_draft', 'Esta campanha já foi enviada ou está em envio.');
    const a = audienceOf(c.audience)!;
    const rows = await q.query<{ subscriber_id: string }>(`SELECT s.subscriber_id ${FROM} WHERE ${a.where} AND ${NOT_RECENT}`);
    const n = rows.rows.length;
    if (n === 0) throw new AppError(422, 'empty_audience', 'Ninguém está elegível neste público agora.');
    if (n !== expectedRecipients) throw new AppError(409, 'audience_changed', `O público mudou (agora são ${n} pessoas). Confira e confirme de novo.`);
    for (const r of rows.rows) await q.query(`INSERT INTO app.email_sends(campaign_id, subscriber_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, r.subscriber_id]);
    await q.query(`UPDATE app.email_campaigns SET status = 'sending', recipients = $2, approved_by = $3, sent_started_at = now() WHERE id = $1`, [id, n, admin.id]);
    await audit(q, `admin:${admin.id}`, 'admin_campaign_send', 'campaign', id, { recipients: n, by: admin.email });
    return { recipients: n };
  });
}

export async function cancelCampaign(ctx: Ctx, admin: AdminUser, id: string): Promise<void> {
  const r = await ctx.db.query(`UPDATE app.email_campaigns SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status = 'sending'`, [id]);
  if (r.rowCount === 0) throw new AppError(409, 'not_sending', 'Só dá para parar uma campanha que está em envio.');
  await ctx.db.query(`UPDATE app.email_sends SET status = 'skipped', reason = 'campanha_cancelada' WHERE campaign_id = $1 AND status = 'queued'`, [id]);
  await audit(ctx.db, `admin:${admin.id}`, 'admin_campaign_cancel', 'campaign', id, { by: admin.email });
}

/**
 * Worker: manda um lote da fila. Reconfere a cada pessoa se ainda pode receber (descadastro, conta apagada, outra campanha
 * na última semana) e respeita o teto diário. Devolve true se havia trabalho.
 */
export async function dispatchCampaigns(ctx: Ctx, opts: { batch?: number; log?: (e: Record<string, unknown>) => void } = {}): Promise<boolean> {
  if (!ctx.email) return false;
  const cap = ctx.config.campaignDailyCap;
  const sentToday = num((await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.email_sends WHERE status = 'sent' AND sent_at >= date_trunc('day', now())`)).rows[0]?.n ?? 0);
  let room = Math.max(0, cap - sentToday);
  if (room === 0) return false;
  const batch = Math.min(opts.batch ?? 20, room);
  const jobs = await ctx.db.query<{ campaign_id: string; subscriber_id: string; email: string | null; opted: boolean; recent: boolean; subject: string; body: string; button_label: string | null; button_url: string | null }>(
    `SELECT e.campaign_id, e.subscriber_id, b.email::text AS email, (b.marketing_opt_out_at IS NOT NULL OR b.deleted_at IS NOT NULL) AS opted,
            EXISTS (SELECT 1 FROM app.email_sends o WHERE o.subscriber_id = e.subscriber_id AND o.status = 'sent' AND o.sent_at > now() - interval '${FREQUENCY_DAYS} days') AS recent,
            c.subject, c.body, c.button_label, c.button_url
       FROM app.email_sends e JOIN app.email_campaigns c ON c.id = e.campaign_id AND c.status = 'sending'
       JOIN app.subscribers b ON b.id = e.subscriber_id
      WHERE e.status = 'queued' ORDER BY c.sent_started_at, e.subscriber_id LIMIT ${batch}`,
  );
  for (const j of jobs.rows) {
    if (j.opted || !j.email) await ctx.db.query(`UPDATE app.email_sends SET status = 'skipped', reason = 'descadastrado' WHERE campaign_id = $1 AND subscriber_id = $2`, [j.campaign_id, j.subscriber_id]);
    else if (j.recent) await ctx.db.query(`UPDATE app.email_sends SET status = 'skipped', reason = 'recebeu_outra_campanha_na_semana' WHERE campaign_id = $1 AND subscriber_id = $2`, [j.campaign_id, j.subscriber_id]);
    else {
      try {
        await ctx.email.send(build(ctx, j, j.subscriber_id, j.email));
        await ctx.db.query(`UPDATE app.email_sends SET status = 'sent', sent_at = now() WHERE campaign_id = $1 AND subscriber_id = $2`, [j.campaign_id, j.subscriber_id]);
      } catch {
        await ctx.db.query(`UPDATE app.email_sends SET status = 'failed', reason = 'erro_de_envio' WHERE campaign_id = $1 AND subscriber_id = $2`, [j.campaign_id, j.subscriber_id]);
        opts.log?.({ evento: 'campanha_envio_falhou' });
      }
      await new Promise((r) => setTimeout(r, ctx.config.env === 'test' ? 0 : 600)); // folga para o limite do provedor
    }
  }
  await ctx.db.query(
    `UPDATE app.email_campaigns c SET status = 'sent', finished_at = now()
      WHERE c.status = 'sending' AND NOT EXISTS (SELECT 1 FROM app.email_sends e WHERE e.campaign_id = c.id AND e.status = 'queued')`,
  );
  return jobs.rows.length > 0;
}
