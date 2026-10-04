// Contas conectadas (Open Finance) via agregador regulado. Só leitura: saldos e extrato de contas bancárias; o Fôlego nunca movimenta dinheiro.
// Plano Desbravador. Fica DESLIGADO enquanto não houver contrato e chaves do agregador (PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET).
// A integração segue a API pública do Pluggy; foi testada aqui com respostas simuladas e PRECISA de um teste no ambiente de testes
// (sandbox) do agregador antes de ser ligada para clientes.
import { AppError, notFound } from './errors.ts';
import type { Ctx } from './services.ts';
import { audit, num, todaySaoPaulo } from './services.ts';
import { categorize, planAtLeast } from './engine.ts';
import { requireFeature } from './subscriptions.ts';

export const OF_CONSENT_VERSION = 'of-2026-10-03';
const MAX_CONNECTIONS = 5;
const FIRST_SYNC_DAYS = 90;

export interface OfAccount {
  id: string;
  name: string;
  type: string; // BANK | CREDIT
  subtype: string; // CHECKING_ACCOUNT | SAVINGS_ACCOUNT | CREDIT_CARD ...
  balance: number; // em reais, como o agregador devolve
}
export interface OfTransaction {
  id: string;
  date: string; // ISO
  description: string;
  amount: number; // em reais, sempre positivo; o sentido vem de `type`
  type: string; // CREDIT (entrou) | DEBIT (saiu)
}
export interface OfItem {
  id: string;
  status: string;
  institution: string;
}

export interface OpenFinanceProvider {
  readonly name: string;
  createConnectToken(clientUserId: string): Promise<string>;
  getItem(itemId: string): Promise<OfItem>;
  deleteItem(itemId: string): Promise<void>;
  listAccounts(itemId: string): Promise<OfAccount[]>;
  listTransactions(accountId: string, fromIso: string, toIso: string): Promise<OfTransaction[]>;
}

export interface PluggyConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

/** Adaptador do Pluggy (REST). `fetchFn` é injetável para teste. */
export class PluggyProvider implements OpenFinanceProvider {
  readonly name = 'pluggy';
  private apiKey: { value: string; at: number } | null = null;
  private cfg: PluggyConfig;
  private fetchFn: typeof fetch;
  constructor(cfg: PluggyConfig, fetchFn: typeof fetch = fetch) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }

  private async key(): Promise<string> {
    if (this.apiKey && Date.now() - this.apiKey.at < 90 * 60_000) return this.apiKey.value; // a chave dura 2 h
    const res = await this.fetchFn(`${this.cfg.baseUrl}/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new AppError(502, 'openfinance_auth', 'Não consegui falar com o serviço de contas conectadas agora.');
    const j = (await res.json()) as { apiKey?: string };
    if (!j.apiKey) throw new AppError(502, 'openfinance_auth', 'Resposta inesperada do serviço de contas conectadas.');
    this.apiKey = { value: j.apiKey, at: Date.now() };
    return j.apiKey;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.cfg.baseUrl}${path}`, { method, headers: { 'content-type': 'application/json', 'X-API-KEY': await this.key() }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) throw notFound();
    if (!res.ok) throw new AppError(502, 'openfinance_error', 'O serviço de contas conectadas respondeu com erro. Tente de novo em instantes.');
    return (res.status === 204 ? ({} as T) : ((await res.json()) as T));
  }

  async createConnectToken(clientUserId: string): Promise<string> {
    const r = await this.call<{ accessToken: string }>('POST', '/connect_token', { options: { clientUserId } });
    return r.accessToken;
  }
  async getItem(itemId: string): Promise<OfItem> {
    const r = await this.call<{ id: string; status: string; connector?: { name?: string } }>('GET', `/items/${encodeURIComponent(itemId)}`);
    return { id: r.id, status: r.status, institution: r.connector?.name ?? '' };
  }
  async deleteItem(itemId: string): Promise<void> {
    await this.call('DELETE', `/items/${encodeURIComponent(itemId)}`);
  }
  async listAccounts(itemId: string): Promise<OfAccount[]> {
    const r = await this.call<{ results: { id: string; name?: string; type: string; subtype: string; balance?: number }[] }>('GET', `/accounts?itemId=${encodeURIComponent(itemId)}`);
    return r.results.map((a) => ({ id: a.id, name: a.name ?? '', type: a.type, subtype: a.subtype, balance: Number(a.balance ?? 0) }));
  }
  async listTransactions(accountId: string, fromIso: string, toIso: string): Promise<OfTransaction[]> {
    const out: OfTransaction[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const r = await this.call<{ results: { id: string; date: string; description?: string; descriptionRaw?: string; amount: number; type: string }[]; totalPages?: number }>(
        'GET', `/transactions?accountId=${encodeURIComponent(accountId)}&from=${fromIso}&to=${toIso}&pageSize=500&page=${page}`,
      );
      for (const t of r.results) out.push({ id: t.id, date: t.date, description: t.description ?? t.descriptionRaw ?? '', amount: Math.abs(Number(t.amount)), type: t.type });
      if (page >= (r.totalPages ?? 1)) break;
    }
    return out;
  }
}

const provider = (ctx: Ctx): OpenFinanceProvider => {
  if (!ctx.openFinance) throw new AppError(503, 'openfinance_off', 'As contas conectadas ainda não estão ativas.');
  return ctx.openFinance;
};

/** Só o plano mais alto, e só com o serviço ligado neste servidor. */
async function requirePlan(ctx: Ctx, subscriberId: string): Promise<void> {
  provider(ctx);
  const plan = await requireFeature(ctx, subscriberId, 'ledger');
  if (!planAtLeast(plan, 'desbravador')) throw new AppError(403, 'plan_upgrade', 'Contas conectadas são do plano Desbravador.');
}

const cents = (reais: number) => Math.round(reais * 100);

export async function connectToken(ctx: Ctx, subscriberId: string): Promise<{ accessToken: string; consentVersion: string }> {
  await requirePlan(ctx, subscriberId);
  return { accessToken: await provider(ctx).createConnectToken(subscriberId), consentVersion: OF_CONSENT_VERSION };
}

export async function listConnections(ctx: Ctx, subscriberId: string) {
  const r = await ctx.db.query<{ id: string; institution: string; status: string; last_sync_at: Date | null; last_error: string | null; consent_at: Date; accounts: string }>(
    `SELECT c.id, c.institution, c.status, c.last_sync_at, c.last_error, c.consent_at, (SELECT count(*)::text FROM app.wallets w WHERE w.connection_id = c.id) AS accounts
       FROM app.of_connections c WHERE c.subscriber_id = $1 AND c.status <> 'revoked' ORDER BY c.created_at`,
    [subscriberId],
  );
  return {
    enabled: Boolean(ctx.openFinance),
    consentVersion: OF_CONSENT_VERSION,
    widgetUrl: ctx.config.openFinanceWidgetUrl,
    connections: r.rows.map((c) => ({ id: c.id, institution: c.institution, status: c.status, lastSyncAt: c.last_sync_at ? new Date(c.last_sync_at).toISOString() : null, lastError: c.last_error, consentAt: new Date(c.consent_at).toISOString(), accounts: num(c.accounts) })),
  };
}

/** Depois do widget do agregador: confere o item no servidor, grava o consentimento e já faz a primeira sincronização. */
export async function addConnection(ctx: Ctx, subscriberId: string, itemId: string): Promise<{ id: string; imported: number }> {
  await requirePlan(ctx, subscriberId);
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.of_connections WHERE subscriber_id = $1 AND status <> 'revoked'`, [subscriberId]);
  if (num(n.rows[0]?.n ?? 0) >= MAX_CONNECTIONS) throw new AppError(422, 'too_many', `Limite de ${MAX_CONNECTIONS} conexões.`);
  const item = await provider(ctx).getItem(itemId); // o servidor confirma que o item existe no agregador
  const created = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.of_connections(subscriber_id, provider, item_id, institution, consent_version) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (provider, item_id) DO UPDATE SET status = 'active', consent_at = now(), consent_version = EXCLUDED.consent_version, institution = EXCLUDED.institution
       WHERE app.of_connections.subscriber_id = EXCLUDED.subscriber_id
     RETURNING id`,
    [subscriberId, provider(ctx).name, item.id, item.institution.slice(0, 60), OF_CONSENT_VERSION],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new AppError(409, 'already_connected', 'Esta conexão já pertence a outra conta.');
  await audit(ctx.db, `subscriber:${subscriberId}`, 'openfinance_connected', 'subscriber', subscriberId, { institution: item.institution });
  const imported = await syncConnection(ctx, id);
  return { id, imported };
}

export async function revokeConnection(ctx: Ctx, subscriberId: string, id: string): Promise<void> {
  const r = await ctx.db.query<{ item_id: string }>(`UPDATE app.of_connections SET status = 'revoked' WHERE id = $1 AND subscriber_id = $2 AND status <> 'revoked' RETURNING item_id`, [id, subscriberId]);
  if (!r.rows[0]) throw notFound();
  try {
    await provider(ctx).deleteItem(r.rows[0].item_id); // corta o acesso também no agregador
  } catch {
    /* o acesso local já foi revogado; o item sai do agregador por expiração do consentimento */
  }
  await audit(ctx.db, `subscriber:${subscriberId}`, 'openfinance_revoked', 'subscriber', subscriberId);
}

/** Traz saldos e extrato (só contas bancárias) para as carteiras e os lançamentos da pessoa. Repetível: não duplica. */
export async function syncConnection(ctx: Ctx, connectionId: string): Promise<number> {
  const conn = await ctx.db.query<{ id: string; subscriber_id: string; item_id: string; institution: string; last_sync_at: Date | null }>(
    `SELECT id, subscriber_id, item_id, institution, last_sync_at FROM app.of_connections WHERE id = $1 AND status = 'active'`,
    [connectionId],
  );
  const c = conn.rows[0];
  if (!c) return 0;
  const p = provider(ctx);
  let imported = 0;
  try {
    const today = todaySaoPaulo();
    const since = c.last_sync_at ? new Date(new Date(c.last_sync_at).getTime() - 7 * 86_400_000) : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
    const from = since.toISOString().slice(0, 10);
    const accounts = (await p.listAccounts(c.item_id)).filter((a) => a.type === 'BANK' && (a.subtype === 'CHECKING_ACCOUNT' || a.subtype === 'SAVINGS_ACCOUNT'));
    for (const a of accounts) {
      const kind = a.subtype === 'SAVINGS_ACCOUNT' ? 'poupanca' : 'conta';
      const label = `${c.institution} ${a.name}`.trim().replace(/\s+/g, ' ').slice(0, 40) || 'Conta conectada';
      const w = await ctx.db.query<{ id: string }>(
        `INSERT INTO app.wallets(subscriber_id, name, kind, external_id, connection_id) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (subscriber_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET connection_id = EXCLUDED.connection_id RETURNING id`,
        [c.subscriber_id, label, kind, `${p.name}:${a.id}`, c.id],
      );
      const walletId = w.rows[0]!.id;
      const txs = await p.listTransactions(a.id, from, today);
      for (const t of txs) {
        const amount = cents(t.amount) * (t.type === 'CREDIT' ? 1 : -1);
        if (amount === 0) continue;
        const note = (t.description || 'Movimentação').trim().slice(0, 120);
        const r = await ctx.db.query(
          `INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, wallet_id, external_id)
           VALUES ($1,$2::date,$3,$4,$5,'openfinance',$6,$7) ON CONFLICT (subscriber_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
          [c.subscriber_id, t.date.slice(0, 10), amount, categorize(note, amount), note, walletId, `${p.name}:${t.id}`],
        );
        imported += r.rowCount ?? 0;
      }
      // o saldo da carteira passa a ser o saldo real do banco: saldo de partida = saldo do banco - soma dos lançamentos
      await ctx.db.query(
        `UPDATE app.wallets SET opening_balance_cents = $2 - coalesce((SELECT sum(amount_cents) FROM app.ledger_entries WHERE wallet_id = app.wallets.id), 0) WHERE id = $1`,
        [walletId, cents(a.balance)],
      );
    }
    await ctx.db.query(`UPDATE app.of_connections SET last_sync_at = now(), last_error = NULL, status = 'active' WHERE id = $1`, [c.id]);
  } catch (error) {
    const msg = error instanceof Error ? error.message.slice(0, 200) : 'erro';
    await ctx.db.query(`UPDATE app.of_connections SET last_error = $2 WHERE id = $1`, [c.id, msg]);
    throw error;
  }
  return imported;
}

export async function syncNow(ctx: Ctx, subscriberId: string, id: string): Promise<{ imported: number }> {
  await requirePlan(ctx, subscriberId);
  const own = await ctx.db.query(`SELECT 1 FROM app.of_connections WHERE id = $1 AND subscriber_id = $2 AND status = 'active'`, [id, subscriberId]);
  if (own.rows.length === 0) throw notFound();
  return { imported: await syncConnection(ctx, id) };
}

/** Worker: atualiza as conexões ativas (no máximo uma vez a cada 6 horas cada). */
export async function syncDueConnections(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.openFinance) return 0;
  const due = await ctx.db.query<{ id: string }>(
    `SELECT c.id FROM app.of_connections c
       JOIN app.subscriptions s ON s.subscriber_id = c.subscriber_id AND s.status = 'active' AND s.current_period_end > now() AND s.plan = 'desbravador'
      WHERE c.status = 'active' AND (c.last_sync_at IS NULL OR c.last_sync_at < now() - interval '6 hours') ORDER BY c.last_sync_at NULLS FIRST LIMIT 20`,
  );
  let total = 0;
  for (const r of due.rows) {
    try {
      total += await syncConnection(ctx, r.id);
    } catch (error) {
      opts.log?.({ evento: 'openfinance_sync_erro', erro: error instanceof Error ? error.message.slice(0, 160) : 'erro' });
    }
  }
  return total;
}
