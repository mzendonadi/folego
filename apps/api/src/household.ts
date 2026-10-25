// Conta compartilhada: o(a) titular (plano Ousado ou Desbravador) convida pessoas pelo e-mail: 1 no Ousado, até 3 no Desbravador.
// Quem aceita entra com o próprio e-mail e passa a ver a MESMA conta (lançamentos, dívidas, metas, lembretes...), com um de dois acessos:
// "edita" (vê e lança) ou "consulta" (só vê). Só o titular paga, cancela, convida e apaga a conta. Nada é copiado: os dados continuam do titular.
import { AppError, notFound } from './errors.ts';
import { layout } from './email.ts';
import type { Ctx } from './services.ts';
import { requireFeature, accountView } from './subscriptions.ts';
import type { AccountView } from './subscriptions.ts';

export type Access = 'edita' | 'consulta';
/** Quantas pessoas o titular pode convidar, por plano. */
export const MEMBER_LIMIT: Record<string, number> = { ousado: 1, desbravador: 3 };

/** Id da conta cujos dados esta pessoa usa: o do titular, se ela for membro; senão, o dela. */
export async function effectiveAccountId(ctx: Ctx, selfId: string): Promise<string> {
  const r = await ctx.db.query<{ owner_id: string }>(`SELECT owner_id FROM app.household_members WHERE member_id = $1 AND status = 'active'`, [selfId]);
  return r.rows[0]?.owner_id ?? selfId;
}

/** Acesso de quem usa a conta de outra pessoa; null se a pessoa usa a própria conta. */
export async function memberAccess(ctx: Ctx, selfId: string): Promise<Access | null> {
  const r = await ctx.db.query<{ role: Access }>(`SELECT role FROM app.household_members WHERE member_id = $1 AND status = 'active'`, [selfId]);
  return r.rows[0]?.role ?? null;
}

export interface AccountViewWithRole extends AccountView {
  role: 'owner' | 'member';
  ownerEmail: string | null;
  access: Access | null;
}

/** /api/account: para membro mostra a assinatura do titular (e o e-mail do próprio membro). */
export async function accountViewFor(ctx: Ctx, selfId: string): Promise<AccountViewWithRole> {
  const owner = await effectiveAccountId(ctx, selfId);
  const own = await accountView(ctx, selfId);
  if (owner === selfId) return { ...own, role: 'owner', ownerEmail: null, access: null };
  const shared = await accountView(ctx, owner);
  return { email: own.email, subscription: shared.subscription, billing: shared.billing, profile: own.profile, demo: shared.demo, role: 'member', ownerEmail: shared.email, access: await memberAccess(ctx, selfId) };
}

export async function assertNotMember(ctx: Ctx, selfId: string): Promise<void> {
  if ((await effectiveAccountId(ctx, selfId)) !== selfId) throw new AppError(409, 'shared_member', 'Você usa a conta compartilhada de outra pessoa. Saia dela para assinar por conta própria.');
}

interface MemberRow {
  id: string;
  owner_id: string;
  email: string;
  member_id: string | null;
  status: 'pending' | 'active';
  role: Access;
}

export async function householdView(ctx: Ctx, selfId: string) {
  const me = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [selfId]);
  const email = me.rows[0]?.email ?? '';
  const asMember = await ctx.db.query<{ owner_email: string; role: Access }>(`SELECT s.email::text AS owner_email, h.role FROM app.household_members h JOIN app.subscribers s ON s.id = h.owner_id WHERE h.member_id = $1 AND h.status = 'active'`, [selfId]);
  if (asMember.rows[0]) return { role: 'member' as const, ownerEmail: asMember.rows[0].owner_email, access: asMember.rows[0].role, members: [], limit: 0, invite: null, canInvite: false };
  const mine = await ctx.db.query<MemberRow>(`SELECT id, owner_id, email::text AS email, member_id, status, role FROM app.household_members WHERE owner_id = $1 ORDER BY invited_at, id`, [selfId]);
  const invited = await ctx.db.query<{ owner_email: string; role: Access }>(`SELECT s.email::text AS owner_email, h.role FROM app.household_members h JOIN app.subscribers s ON s.id = h.owner_id WHERE lower(h.email::text) = lower($1) AND h.status = 'pending'`, [email]);
  let limit = 0;
  try {
    limit = MEMBER_LIMIT[await requireFeature(ctx, selfId, 'household')] ?? 1;
  } catch {
    limit = 0;
  }
  return {
    role: 'owner' as const,
    ownerEmail: null,
    access: null,
    members: mine.rows.map((m) => ({ id: m.id, email: m.email, status: m.status, access: m.role })),
    limit,
    invite: invited.rows[0] ? { ownerEmail: invited.rows[0].owner_email, access: invited.rows[0].role } : null,
    canInvite: limit > 0 && mine.rows.length < limit,
  };
}

export async function invite(ctx: Ctx, ownerId: string, rawEmail: string, access: Access = 'edita'): Promise<void> {
  if ((await effectiveAccountId(ctx, ownerId)) !== ownerId) throw new AppError(409, 'shared_member', 'Você está na conta compartilhada de outra pessoa.');
  const plan = await requireFeature(ctx, ownerId, 'household');
  const email = rawEmail.trim().toLowerCase();
  const self = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [ownerId]);
  if (self.rows[0]?.email.toLowerCase() === email) throw new AppError(422, 'self_invite', 'Convide outra pessoa: este é o seu próprio e-mail.');
  const limit = MEMBER_LIMIT[plan] ?? 1;
  const count = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.household_members WHERE owner_id = $1`, [ownerId]);
  if (Number(count.rows[0]?.n ?? 0) >= limit) {
    throw new AppError(409, 'already_invited', limit === 1 ? 'Você já tem uma pessoa na conta. Remova antes de convidar outra, ou passe para o plano Desbravador (até 3 pessoas).' : `Sua conta já tem ${limit} pessoas, o limite do plano. Remova alguém para convidar outra.`);
  }
  const busy = await ctx.db.query(`SELECT 1 FROM app.household_members WHERE lower(email::text) = $1 OR member_id IN (SELECT id FROM app.subscribers WHERE lower(email::text) = $1)`, [email]);
  if (busy.rows.length > 0) throw new AppError(409, 'invitee_busy', 'Esta pessoa já foi convidada para outra conta compartilhada.');
  await ctx.db.query(`INSERT INTO app.household_members(owner_id, email, role) VALUES ($1,$2,$3)`, [ownerId, email, access]);
  if (ctx.email) {
    const body = layout('Você foi convidado(a) para uma conta no Fôlego', [
      `${self.rows[0]?.email} convidou você para compartilhar a conta de finanças do Prumo (lançamentos, dívidas, metas e lembretes).`,
      access === 'consulta'
        ? 'Para aceitar, entre no Prumo com este e-mail e clique em "Aceitar convite" na aba Compartilhar. Você terá acesso só para consultar: vê tudo, mas quem lança é o titular.'
        : 'Para aceitar, entre no Prumo com este e-mail e clique em "Aceitar convite" na aba Compartilhar. Quem aceita vê e edita os dados da conta; só o titular paga e cancela.',
      'Se você não conhece quem convidou, é só ignorar este e-mail.',
    ], { label: 'Abrir o Prumo', url: `${ctx.config.publicUrl}/conta/familia` });
    await ctx.email.send({ to: email, subject: 'Convite para a conta compartilhada no Fôlego', ...body }).catch(() => undefined);
  }
}

/** Titular remove um convite/membro. Sem `id`, remove o único que existir (compatível com o desenho de uma pessoa só). */
export async function removeMember(ctx: Ctx, ownerId: string, id?: string): Promise<void> {
  if (!id) {
    const all = await ctx.db.query<{ id: string }>(`SELECT id FROM app.household_members WHERE owner_id = $1`, [ownerId]);
    if (all.rows.length === 0) throw notFound();
    if (all.rows.length > 1) throw new AppError(422, 'which_member', 'Escolha quem remover.');
    id = all.rows[0]!.id;
  }
  const r = await ctx.db.query(`DELETE FROM app.household_members WHERE owner_id = $1 AND id = $2`, [ownerId, id]);
  if (r.rowCount === 0) throw notFound();
}

/** Titular troca o acesso de uma pessoa (edita ou consulta). */
export async function setAccess(ctx: Ctx, ownerId: string, id: string, access: Access): Promise<void> {
  const r = await ctx.db.query(`UPDATE app.household_members SET role = $3 WHERE owner_id = $1 AND id = $2`, [ownerId, id, access]);
  if (r.rowCount === 0) throw notFound();
}

export async function accept(ctx: Ctx, selfId: string): Promise<void> {
  const me = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [selfId]);
  const mine = await ctx.db.query(`SELECT 1 FROM app.household_members WHERE owner_id = $1`, [selfId]);
  if (mine.rows.length > 0) throw new AppError(409, 'has_member', 'Você é titular de uma conta compartilhada. Remova as pessoas convidadas antes de entrar na de outra.');
  const r = await ctx.db.query(`UPDATE app.household_members SET member_id = $1, status = 'active', accepted_at = now() WHERE lower(email::text) = lower($2) AND status = 'pending'`, [selfId, me.rows[0]?.email ?? '']);
  if (r.rowCount === 0) throw new AppError(404, 'no_invite', 'Não há convite pendente para o seu e-mail.');
}

/** Membro sai da conta compartilhada (volta a usar a própria). */
export async function leave(ctx: Ctx, selfId: string): Promise<void> {
  const r = await ctx.db.query(`DELETE FROM app.household_members WHERE member_id = $1`, [selfId]);
  if (r.rowCount === 0) throw notFound();
}
