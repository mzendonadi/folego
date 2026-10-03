// Conta compartilhada: o(a) titular (plano Ousado ou Desbravador) convida UMA pessoa pelo e-mail. Quem aceita entra
// com o próprio e-mail e passa a ver e editar a MESMA conta (lançamentos, dívidas, metas, lembretes...). Só o titular
// paga, cancela, convida e apaga a conta. Nada é copiado: os dados continuam do titular (subscriber_id dele).
import { AppError, notFound } from './errors.ts';
import { layout } from './email.ts';
import type { Ctx } from './services.ts';
import { requireFeature, accountView } from './subscriptions.ts';
import type { AccountView } from './subscriptions.ts';

/** Id da conta cujos dados esta pessoa usa: o do titular, se ela for membro; senão, o dela. */
export async function effectiveAccountId(ctx: Ctx, selfId: string): Promise<string> {
  const r = await ctx.db.query<{ owner_id: string }>(`SELECT owner_id FROM app.household_members WHERE member_id = $1 AND status = 'active'`, [selfId]);
  return r.rows[0]?.owner_id ?? selfId;
}

export interface AccountViewWithRole extends AccountView {
  role: 'owner' | 'member';
  ownerEmail: string | null;
}

/** /api/account: para membro mostra a assinatura do titular (e o e-mail do próprio membro). */
export async function accountViewFor(ctx: Ctx, selfId: string): Promise<AccountViewWithRole> {
  const owner = await effectiveAccountId(ctx, selfId);
  const own = await accountView(ctx, selfId);
  if (owner === selfId) return { ...own, role: 'owner', ownerEmail: null };
  const shared = await accountView(ctx, owner);
  return { email: own.email, subscription: shared.subscription, billing: shared.billing, profile: own.profile, role: 'member', ownerEmail: shared.email };
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
}

export async function householdView(ctx: Ctx, selfId: string) {
  const me = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [selfId]);
  const email = me.rows[0]?.email ?? '';
  const asMember = await ctx.db.query<{ owner_email: string }>(`SELECT s.email::text AS owner_email FROM app.household_members h JOIN app.subscribers s ON s.id = h.owner_id WHERE h.member_id = $1 AND h.status = 'active'`, [selfId]);
  if (asMember.rows[0]) return { role: 'member' as const, ownerEmail: asMember.rows[0].owner_email, member: null, invite: null, canInvite: false };
  const mine = await ctx.db.query<MemberRow>(`SELECT id, owner_id, email::text AS email, member_id, status FROM app.household_members WHERE owner_id = $1`, [selfId]);
  const invited = await ctx.db.query<{ owner_email: string }>(`SELECT s.email::text AS owner_email FROM app.household_members h JOIN app.subscribers s ON s.id = h.owner_id WHERE lower(h.email::text) = lower($1) AND h.status = 'pending'`, [email]);
  let canInvite = false;
  try {
    await requireFeature(ctx, selfId, 'household');
    canInvite = true;
  } catch {
    canInvite = false;
  }
  return {
    role: 'owner' as const,
    ownerEmail: null,
    member: mine.rows[0] ? { email: mine.rows[0].email, status: mine.rows[0].status } : null,
    invite: invited.rows[0] ? { ownerEmail: invited.rows[0].owner_email } : null,
    canInvite,
  };
}

export async function invite(ctx: Ctx, ownerId: string, rawEmail: string): Promise<void> {
  if ((await effectiveAccountId(ctx, ownerId)) !== ownerId) throw new AppError(409, 'shared_member', 'Você está na conta compartilhada de outra pessoa.');
  await requireFeature(ctx, ownerId, 'household');
  const email = rawEmail.trim().toLowerCase();
  const self = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [ownerId]);
  if (self.rows[0]?.email.toLowerCase() === email) throw new AppError(422, 'self_invite', 'Convide outra pessoa: este é o seu próprio e-mail.');
  const exists = await ctx.db.query(`SELECT 1 FROM app.household_members WHERE owner_id = $1`, [ownerId]);
  if (exists.rows.length > 0) throw new AppError(409, 'already_invited', 'Você já tem uma pessoa na conta. Remova antes de convidar outra.');
  const busy = await ctx.db.query(`SELECT 1 FROM app.household_members WHERE lower(email::text) = $1 OR member_id IN (SELECT id FROM app.subscribers WHERE lower(email::text) = $1)`, [email]);
  if (busy.rows.length > 0) throw new AppError(409, 'invitee_busy', 'Esta pessoa já foi convidada para outra conta compartilhada.');
  await ctx.db.query(`INSERT INTO app.household_members(owner_id, email) VALUES ($1,$2)`, [ownerId, email]);
  if (ctx.email) {
    const body = layout('Você foi convidado(a) para uma conta no Fôlego', [
      `${self.rows[0]?.email} convidou você para compartilhar a conta de finanças do Prumo (lançamentos, dívidas, metas e lembretes).`,
      'Para aceitar, entre no Prumo com este e-mail e clique em "Aceitar convite" na aba Compartilhar. Quem aceita vê e edita os dados da conta; só o titular paga e cancela.',
      'Se você não conhece quem convidou, é só ignorar este e-mail.',
    ], { label: 'Abrir o Prumo', url: `${ctx.config.publicUrl}/#/conta/familia` });
    await ctx.email.send({ to: email, subject: 'Convite para a conta compartilhada no Fôlego', ...body }).catch(() => undefined);
  }
}

/** Titular remove o convite/membro. */
export async function removeMember(ctx: Ctx, ownerId: string): Promise<void> {
  const r = await ctx.db.query(`DELETE FROM app.household_members WHERE owner_id = $1`, [ownerId]);
  if (r.rowCount === 0) throw notFound();
}

export async function accept(ctx: Ctx, selfId: string): Promise<void> {
  const me = await ctx.db.query<{ email: string }>(`SELECT email::text AS email FROM app.subscribers WHERE id = $1`, [selfId]);
  const mine = await ctx.db.query(`SELECT 1 FROM app.household_members WHERE owner_id = $1`, [selfId]);
  if (mine.rows.length > 0) throw new AppError(409, 'has_member', 'Você é titular de uma conta compartilhada. Remova a pessoa convidada antes de entrar na de outra.');
  const r = await ctx.db.query(`UPDATE app.household_members SET member_id = $1, status = 'active', accepted_at = now() WHERE lower(email::text) = lower($2) AND status = 'pending'`, [selfId, me.rows[0]?.email ?? '']);
  if (r.rowCount === 0) throw new AppError(404, 'no_invite', 'Não há convite pendente para o seu e-mail.');
}

/** Membro sai da conta compartilhada (volta a usar a própria). */
export async function leave(ctx: Ctx, selfId: string): Promise<void> {
  const r = await ctx.db.query(`DELETE FROM app.household_members WHERE member_id = $1`, [selfId]);
  if (r.rowCount === 0) throw notFound();
}
