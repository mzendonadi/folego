// Contas conectadas (Open Finance) via agregador regulado. Só leitura: saldos, extrato e cartões de crédito; o Fôlego nunca movimenta dinheiro.
// Plano Desbravador. Fica DESLIGADO enquanto não houver contrato e chaves do agregador (PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET).
// A integração segue a API pública do Pluggy; foi testada aqui com respostas simuladas e PRECISA de um teste no ambiente de testes
// (sandbox) do agregador antes de ser ligada para clientes. Para testar o fluxo inteiro sem contrato, existe o banco de mentira
// (OPENFINANCE_FAKE=1, só fora de produção).
import { AppError, notFound } from './errors.ts';
import type { Ctx } from './services.ts';
import { audit, num, todaySaoPaulo } from './services.ts';
import { categorize, planAtLeast } from './engine.ts';
import { safeEqual } from './crypto.ts';
import { layout as emailLayout } from './email.ts';
import { requireFeature } from './subscriptions.ts';
import type { Config } from './config.ts';

export const OF_CONSENT_VERSION = 'of-2026-10-08';
const MAX_CONNECTIONS = 5;
const MAX_OF_CARDS = 10;
const FIRST_SYNC_DAYS = 90;
const CONSENT_MONTHS = 12;
const DAY = 86_400_000;

export interface OfCredit {
  limit: number;
  available: number;
  /** Dia do mês em que a fatura fecha e vence (quando o banco informa). */
  closeDay?: number | undefined;
  dueDay?: number | undefined;
}
export interface OfAccount {
  id: string;
  name: string;
  type: string; // BANK | CREDIT
  subtype: string; // CHECKING_ACCOUNT | SAVINGS_ACCOUNT | CREDIT_CARD ...
  balance: number; // em reais, como o agregador devolve
  credit?: OfCredit | undefined;
}
export interface OfTransaction {
  id: string;
  date: string; // ISO
  description: string;
  amount: number; // em reais, sempre positivo; o sentido vem de `type`
  type: string; // CREDIT (entrou) | DEBIT (saiu)
  installmentNumber?: number | null | undefined;
  totalInstallments?: number | null | undefined;
}
export interface OfItem {
  id: string;
  status: string;
  institution: string;
  /** Quando o consentimento (até 12 meses) vence, se o agregador informar. */
  consentExpiresAt?: string | undefined;
}

export interface OpenFinanceProvider {
  readonly name: string;
  /** `itemId` abre o widget em modo "reconectar" (renovar consentimento ou entrar de novo no banco). */
  createConnectToken(clientUserId: string, itemId?: string): Promise<string>;
  getItem(itemId: string): Promise<OfItem>;
  deleteItem(itemId: string): Promise<void>;
  /** Pede ao agregador que busque dados novos no banco (opcional). */
  refreshItem?(itemId: string): Promise<void>;
  listAccounts(itemId: string): Promise<OfAccount[]>;
  listTransactions(accountId: string, fromIso: string, toIso: string): Promise<OfTransaction[]>;
}

export interface PluggyConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

/** Item que o agregador diz precisar de uma ação da pessoa (entrar de novo no banco, responder um desafio). */
const ITEM_NEEDS_ACTION = new Set(['LOGIN_ERROR', 'WAITING_USER_INPUT', 'WAITING_USER_ACTION']);

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
    const send = async (): Promise<Response> => this.fetchFn(`${this.cfg.baseUrl}${path}`, { method, headers: { 'content-type': 'application/json', 'X-API-KEY': await this.key() }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    let res = await send();
    if (res.status === 401 || res.status === 403) {
      this.apiKey = null; // chave vencida ou revogada: pega outra uma vez
      res = await send();
    }
    if (res.status === 404) throw notFound();
    if (res.status === 429) throw new AppError(503, 'openfinance_busy', 'O serviço de contas conectadas está ocupado. Tente de novo em instantes.');
    if (!res.ok) throw new AppError(502, 'openfinance_error', 'O serviço de contas conectadas respondeu com erro. Tente de novo em instantes.');
    return res.status === 204 ? ({} as T) : ((await res.json()) as T);
  }

  async createConnectToken(clientUserId: string, itemId?: string): Promise<string> {
    const r = await this.call<{ accessToken: string }>('POST', '/connect_token', { ...(itemId ? { itemId } : {}), options: { clientUserId } });
    return r.accessToken;
  }
  async getItem(itemId: string): Promise<OfItem> {
    const r = await this.call<{ id: string; status: string; connector?: { name?: string }; consentExpiresAt?: string | null }>('GET', `/items/${encodeURIComponent(itemId)}`);
    return { id: r.id, status: r.status, institution: r.connector?.name ?? '', ...(r.consentExpiresAt ? { consentExpiresAt: r.consentExpiresAt } : {}) };
  }
  async deleteItem(itemId: string): Promise<void> {
    await this.call('DELETE', `/items/${encodeURIComponent(itemId)}`);
  }
  async refreshItem(itemId: string): Promise<void> {
    await this.call('PATCH', `/items/${encodeURIComponent(itemId)}`, {});
  }
  async listAccounts(itemId: string): Promise<OfAccount[]> {
    const r = await this.call<{ results: { id: string; name?: string; marketingName?: string; type: string; subtype: string; balance?: number; creditData?: { creditLimit?: number | null; availableCreditLimit?: number | null; balanceCloseDate?: string | null; balanceDueDate?: string | null } | null }[] }>('GET', `/accounts?itemId=${encodeURIComponent(itemId)}`);
    return r.results.map((a) => {
      const cd = a.creditData;
      const day = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? Number(iso.slice(8, 10)) : undefined);
      return {
        id: a.id,
        name: a.marketingName ?? a.name ?? '',
        type: a.type,
        subtype: a.subtype,
        balance: Number(a.balance ?? 0),
        ...(cd ? { credit: { limit: Number(cd.creditLimit ?? 0), available: Number(cd.availableCreditLimit ?? 0), closeDay: day(cd.balanceCloseDate), dueDay: day(cd.balanceDueDate) } } : {}),
      };
    });
  }
  async listTransactions(accountId: string, fromIso: string, toIso: string): Promise<OfTransaction[]> {
    const out: OfTransaction[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const r = await this.call<{ results: { id: string; date: string; description?: string; descriptionRaw?: string; amount: number; type: string; creditCardMetadata?: { installmentNumber?: number | null; totalInstallments?: number | null } | null }[]; totalPages?: number }>(
        'GET', `/transactions?accountId=${encodeURIComponent(accountId)}&from=${fromIso}&to=${toIso}&pageSize=500&page=${page}`,
      );
      for (const t of r.results) {
        const m = t.creditCardMetadata;
        out.push({ id: t.id, date: t.date, description: t.description ?? t.descriptionRaw ?? '', amount: Math.abs(Number(t.amount)), type: t.type, ...(m?.installmentNumber && m.totalInstallments ? { installmentNumber: m.installmentNumber, totalInstallments: m.totalInstallments } : {}) });
      }
      if (page >= (r.totalPages ?? 1)) break;
    }
    return out;
  }
}

/**
 * Banco de mentira para testar o fluxo inteiro (conectar, saldo, extrato, cartão, reconectar) SEM contrato com agregador.
 * Só existe fora de produção (OPENFINANCE_FAKE=1). Os dados são sintéticos e estáveis: a mesma conexão devolve sempre os mesmos lançamentos.
 */
export class FakeOpenFinanceProvider implements OpenFinanceProvider {
  readonly name = 'fake';
  static readonly BANKS: Record<string, string> = { 'fake-azul': 'Banco Azul (teste)', 'fake-verde': 'Banco Verde (teste)' };
  /** Itens que o teste mandou "pedir reconexão". */
  needsAction = new Set<string>();
  deleted: string[] = [];
  async createConnectToken(): Promise<string> {
    return 'fake-connect-token';
  }
  async getItem(itemId: string): Promise<OfItem> {
    const name = FakeOpenFinanceProvider.BANKS[itemId];
    if (!name) throw notFound();
    return { id: itemId, status: this.needsAction.has(itemId) ? 'LOGIN_ERROR' : 'UPDATED', institution: name, consentExpiresAt: new Date(Date.now() + 365 * DAY).toISOString() };
  }
  async deleteItem(itemId: string): Promise<void> {
    this.deleted.push(itemId);
  }
  async refreshItem(): Promise<void> {}
  async listAccounts(itemId: string): Promise<OfAccount[]> {
    return [
      { id: `${itemId}-cc`, name: 'Conta Corrente', type: 'BANK', subtype: 'CHECKING_ACCOUNT', balance: 1840.55 },
      { id: `${itemId}-pp`, name: 'Poupança', type: 'BANK', subtype: 'SAVINGS_ACCOUNT', balance: 5200 },
      { id: `${itemId}-cartao`, name: 'Cartão Gold', type: 'CREDIT', subtype: 'CREDIT_CARD', balance: 1250.4, credit: { limit: 9000, available: 7749.6, closeDay: 8, dueDay: 15 } },
    ];
  }
  async listTransactions(accountId: string, fromIso: string, toIso: string): Promise<OfTransaction[]> {
    const at = (offset: number) => new Date(Date.now() - offset * DAY).toISOString();
    const all: OfTransaction[] = accountId.endsWith('-cartao')
      ? [
        { id: `${accountId}-1`, date: at(3), description: 'AMAZON MARKETPLACE', amount: 189.9, type: 'DEBIT', installmentNumber: 2, totalInstallments: 5 },
        { id: `${accountId}-2`, date: at(6), description: 'IFOOD *RESTAURANTE', amount: 72.5, type: 'DEBIT' },
        { id: `${accountId}-3`, date: at(12), description: 'POSTO IPIRANGA', amount: 210, type: 'DEBIT' },
        { id: `${accountId}-4`, date: at(20), description: 'NETFLIX.COM', amount: 55.9, type: 'DEBIT' },
        { id: `${accountId}-5`, date: at(33), description: 'PAGAMENTO RECEBIDO', amount: 980.1, type: 'CREDIT' },
      ]
      : accountId.endsWith('-pp')
        ? [{ id: `${accountId}-1`, date: at(10), description: 'RENDIMENTO POUPANCA', amount: 14.2, type: 'CREDIT' }]
        : [
          { id: `${accountId}-1`, date: at(2), description: 'SALARIO EMPRESA XYZ', amount: 4200, type: 'CREDIT' },
          { id: `${accountId}-2`, date: at(4), description: 'SUPERMERCADO EXTRA', amount: 312.8, type: 'DEBIT' },
          { id: `${accountId}-3`, date: at(7), description: 'PIX ENVIADO ALUGUEL', amount: 1500, type: 'DEBIT' },
          { id: `${accountId}-4`, date: at(15), description: 'ENERGIA CEMIG', amount: 187.45, type: 'DEBIT' },
          { id: `${accountId}-5`, date: at(25), description: 'PAGAMENTO FATURA CARTAO', amount: 980.1, type: 'DEBIT' },
        ];
    return all.filter((t) => t.date.slice(0, 10) >= fromIso && t.date.slice(0, 10) <= toIso);
  }
}

/** Qual provedor este processo usa: o de mentira (fora de produção), o Pluggy (com chaves) ou nenhum (recurso desligado). */
export function makeOpenFinance(config: Config): OpenFinanceProvider | undefined {
  if (config.openFinanceFake) return new FakeOpenFinanceProvider();
  return config.openFinance ? new PluggyProvider(config.openFinance) : undefined;
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
const plusMonths = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
};
const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Débito da conta que paga a fatura do cartão: vira pagamento do cartão, não gasto novo (a compra já entrou pelo cartão). */
const CARD_BILL = /(pagamento|pagto|pgto)\s+(de\s+)?(fatura|cartao)|fatura\s+(do\s+)?cartao|fatura\s+(nubank|itau|bradesco|santander|inter|c6|bb|caixa)/;

export async function connectToken(ctx: Ctx, subscriberId: string): Promise<{ accessToken: string; consentVersion: string }> {
  await requirePlan(ctx, subscriberId);
  return { accessToken: await provider(ctx).createConnectToken(subscriberId), consentVersion: OF_CONSENT_VERSION };
}

/** Token para reconectar uma conexão que já existe (renovar o consentimento ou entrar de novo no banco). */
export async function reconnectToken(ctx: Ctx, subscriberId: string, id: string): Promise<{ accessToken: string; itemId: string; consentVersion: string }> {
  await requirePlan(ctx, subscriberId);
  const r = await ctx.db.query<{ item_id: string }>(`SELECT item_id FROM app.of_connections WHERE id = $1 AND subscriber_id = $2 AND status <> 'revoked'`, [id, subscriberId]);
  if (!r.rows[0]) throw notFound();
  return { accessToken: await provider(ctx).createConnectToken(subscriberId, r.rows[0].item_id), itemId: r.rows[0].item_id, consentVersion: OF_CONSENT_VERSION };
}

export async function listConnections(ctx: Ctx, subscriberId: string) {
  const r = await ctx.db.query<{ id: string; institution: string; status: string; provider_status: string | null; last_sync_at: Date | null; last_error: string | null; consent_at: Date; consent_expires_at: Date | null; accounts: string; cards: string }>(
    `SELECT c.id, c.institution, c.status, c.provider_status, c.last_sync_at, c.last_error, c.consent_at, c.consent_expires_at,
            (SELECT count(*)::text FROM app.wallets w WHERE w.connection_id = c.id) AS accounts,
            (SELECT count(*)::text FROM app.credit_cards k WHERE k.connection_id = c.id) AS cards
       FROM app.of_connections c WHERE c.subscriber_id = $1 AND c.status <> 'revoked' ORDER BY c.created_at`,
    [subscriberId],
  );
  return {
    enabled: Boolean(ctx.openFinance),
    /** Banco de mentira (só fora de produção): a tela mostra um seletor de teste em vez do widget do agregador. */
    fake: Boolean(ctx.config.openFinanceFake),
    consentVersion: OF_CONSENT_VERSION,
    widgetUrl: ctx.config.openFinanceWidgetUrl,
    connections: r.rows.map((c) => {
      const expires = c.consent_expires_at ? new Date(c.consent_expires_at) : null;
      return {
        id: c.id,
        institution: c.institution,
        status: c.status,
        needsAction: c.status === 'needs_action',
        providerStatus: c.provider_status,
        lastSyncAt: c.last_sync_at ? new Date(c.last_sync_at).toISOString() : null,
        lastError: c.last_error,
        consentAt: new Date(c.consent_at).toISOString(),
        consentExpiresAt: expires ? expires.toISOString() : null,
        expiresInDays: expires ? Math.ceil((expires.getTime() - Date.now()) / DAY) : null,
        accounts: num(c.accounts),
        cards: num(c.cards),
      };
    }),
  };
}

/** Atualiza o estado da conexão com o que o agregador diz do item (precisa reconectar? quando vence o consentimento?). */
async function applyItemStatus(ctx: Ctx, connectionId: string, item: OfItem): Promise<boolean> {
  const needs = ITEM_NEEDS_ACTION.has(item.status);
  await ctx.db.query(
    `UPDATE app.of_connections SET provider_status = $2,
            status_changed_at = CASE WHEN (status = 'needs_action') <> $3::boolean THEN now() ELSE status_changed_at END,
            last_error = CASE WHEN $3::boolean THEN 'Reconexão necessária' WHEN status = 'needs_action' THEN NULL ELSE last_error END,
            status = CASE WHEN $3::boolean THEN 'needs_action' WHEN status = 'needs_action' THEN 'active' ELSE status END,
            consent_expires_at = coalesce($4::timestamptz, consent_expires_at)
      WHERE id = $1 AND status <> 'revoked'`,
    [connectionId, item.status.slice(0, 40), needs, item.consentExpiresAt ?? null],
  );
  return needs;
}

/** Depois do widget do agregador: confere o item no servidor, grava o consentimento e já faz a primeira sincronização. */
export async function addConnection(ctx: Ctx, subscriberId: string, itemId: string): Promise<{ id: string; imported: number }> {
  await requirePlan(ctx, subscriberId);
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.of_connections WHERE subscriber_id = $1 AND status <> 'revoked'`, [subscriberId]);
  if (num(n.rows[0]?.n ?? 0) >= MAX_CONNECTIONS) throw new AppError(422, 'too_many', `Limite de ${MAX_CONNECTIONS} conexões.`);
  const item = await provider(ctx).getItem(itemId); // o servidor confirma que o item existe no agregador
  const created = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.of_connections(subscriber_id, provider, item_id, institution, consent_version, consent_expires_at, provider_status) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (provider, item_id) DO UPDATE SET status = 'active', consent_at = now(), consent_version = EXCLUDED.consent_version, institution = EXCLUDED.institution,
       consent_expires_at = EXCLUDED.consent_expires_at, provider_status = EXCLUDED.provider_status, renew_notified_at = NULL, last_error = NULL
       WHERE app.of_connections.subscriber_id = EXCLUDED.subscriber_id
     RETURNING id`,
    [subscriberId, provider(ctx).name, item.id, item.institution.slice(0, 60), OF_CONSENT_VERSION, item.consentExpiresAt ?? plusMonths(CONSENT_MONTHS), item.status.slice(0, 40)],
  );
  const id = created.rows[0]?.id;
  if (!id) throw new AppError(409, 'already_connected', 'Esta conexão já pertence a outra conta.');
  await audit(ctx.db, `subscriber:${subscriberId}`, 'openfinance_connected', 'subscriber', subscriberId, { institution: item.institution });
  const imported = await syncConnection(ctx, id);
  return { id, imported };
}

/** Depois de reconectar no widget: o servidor confere o item de novo, tira a conexão do "precisa de ação", renova a validade e sincroniza. */
export async function refreshConnection(ctx: Ctx, subscriberId: string, id: string): Promise<{ imported: number; needsAction: boolean }> {
  await requirePlan(ctx, subscriberId);
  const r = await ctx.db.query<{ item_id: string }>(`SELECT item_id FROM app.of_connections WHERE id = $1 AND subscriber_id = $2 AND status <> 'revoked'`, [id, subscriberId]);
  if (!r.rows[0]) throw notFound();
  const item = await provider(ctx).getItem(r.rows[0].item_id);
  const needs = await applyItemStatus(ctx, id, item);
  if (!needs) {
    await ctx.db.query(`UPDATE app.of_connections SET consent_at = now(), consent_version = $2, renew_notified_at = NULL WHERE id = $1`, [id, OF_CONSENT_VERSION]);
    await audit(ctx.db, `subscriber:${subscriberId}`, 'openfinance_renewed', 'subscriber', subscriberId);
  }
  return { imported: needs ? 0 : await syncConnection(ctx, id), needsAction: needs };
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

/** Apagar a conta: corta o acesso aos bancos no agregador antes de apagar os dados (o dado local some junto com a conta). */
export async function revokeAllForSubscriber(ctx: Ctx, subscriberId: string): Promise<number> {
  if (!ctx.openFinance) return 0;
  const r = await ctx.db.query<{ item_id: string }>(`SELECT item_id FROM app.of_connections WHERE subscriber_id = $1 AND status <> 'revoked'`, [subscriberId]);
  let n = 0;
  for (const c of r.rows) {
    try {
      await ctx.openFinance.deleteItem(c.item_id);
      n += 1;
    } catch {
      /* segue: o consentimento vence sozinho no agregador */
    }
  }
  return n;
}

/** Cartão que vem do banco: cria ou atualiza o cartão (limite, disponível, fechamento e vencimento) sem mexer no que a pessoa editou (nome, juros). */
async function upsertBankCard(ctx: Ctx, c: { subscriber_id: string; id: string; institution: string }, a: OfAccount, externalId: string): Promise<string | null> {
  const credit = a.credit ?? { limit: 0, available: 0 };
  const name = `${c.institution} ${a.name || 'Cartão'}`.trim().replace(/\s+/g, ' ').slice(0, 40) || 'Cartão conectado';
  const available = cents(Math.min(credit.available, credit.limit || credit.available));
  const have = await ctx.db.query<{ id: string }>(`SELECT id FROM app.credit_cards WHERE subscriber_id = $1 AND external_id = $2`, [c.subscriber_id, externalId]);
  if (have.rows[0]) {
    await ctx.db.query(
      `UPDATE app.credit_cards SET limit_cents = $2, available_cents = $3, bank_synced_at = now(), connection_id = $4,
              closing_day = coalesce($5, closing_day), due_day = coalesce($6, due_day) WHERE id = $1`,
      [have.rows[0].id, cents(credit.limit), available, c.id, credit.closeDay ?? null, credit.dueDay ?? null],
    );
    return have.rows[0].id;
  }
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.credit_cards WHERE subscriber_id = $1`, [c.subscriber_id]);
  if (num(n.rows[0]?.n ?? 0) >= MAX_OF_CARDS) return null;
  const created = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.credit_cards(subscriber_id, name, limit_cents, closing_day, due_day, external_id, connection_id, available_cents, bank_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now()) RETURNING id`,
    [c.subscriber_id, name, cents(credit.limit), credit.closeDay ?? 5, credit.dueDay ?? 12, externalId, c.id, available],
  );
  return created.rows[0]!.id;
}

/** Traz saldos, extrato (contas bancárias) e cartões de crédito para as carteiras, cartões e lançamentos da pessoa. Repetível: não duplica. */
export async function syncConnection(ctx: Ctx, connectionId: string, opts: { refresh?: boolean } = {}): Promise<number> {
  const conn = await ctx.db.query<{ id: string; subscriber_id: string; item_id: string; institution: string; last_sync_at: Date | null }>(
    `SELECT id, subscriber_id, item_id, institution, last_sync_at FROM app.of_connections WHERE id = $1 AND status = 'active'`,
    [connectionId],
  );
  const c = conn.rows[0];
  if (!c) return 0;
  const p = provider(ctx);
  let imported = 0;
  try {
    const item = await p.getItem(c.item_id);
    if (await applyItemStatus(ctx, c.id, item)) return 0; // o banco pediu para a pessoa entrar de novo: a tela mostra "Reconectar"
    if (opts.refresh) await p.refreshItem?.(c.item_id).catch(() => undefined);
    const today = todaySaoPaulo();
    const since = c.last_sync_at ? new Date(new Date(c.last_sync_at).getTime() - 7 * DAY) : new Date(Date.now() - FIRST_SYNC_DAYS * DAY);
    const from = since.toISOString().slice(0, 10);
    const all = await p.listAccounts(c.item_id);
    const banks = all.filter((a) => a.type === 'BANK' && (a.subtype === 'CHECKING_ACCOUNT' || a.subtype === 'SAVINGS_ACCOUNT'));
    const creditAccounts = all.filter((a) => a.type === 'CREDIT');

    // cartões primeiro: o pagamento de fatura que sai da conta corrente precisa saber de qual cartão é
    const cardIds: string[] = [];
    for (const a of creditAccounts) {
      const cardId = await upsertBankCard(ctx, c, a, `${p.name}:${a.id}`);
      if (!cardId) continue;
      cardIds.push(cardId);
      for (const t of await p.listTransactions(a.id, from, today)) {
        const amount = cents(t.amount);
        if (amount === 0) continue;
        const note = (t.description || 'Compra no cartão').trim().slice(0, 100);
        if (t.type === 'CREDIT') {
          // pagamento da fatura ou estorno: abate o cartão (não é entrada de dinheiro)
          const r = await ctx.db.query(`INSERT INTO app.card_payments(subscriber_id, card_id, paid_on, amount_cents, note, external_id) VALUES ($1,$2,$3::date,$4,$5,$6) ON CONFLICT (subscriber_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`, [c.subscriber_id, cardId, t.date.slice(0, 10), amount, note, `${p.name}:${t.id}`]);
          imported += r.rowCount ?? 0;
          continue;
        }
        const no = t.installmentNumber && t.totalInstallments && t.installmentNumber <= t.totalInstallments ? t.installmentNumber : null;
        const r = await ctx.db.query(
          `INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, card_id, installment_no, installment_total, external_id)
           VALUES ($1,$2::date,$3,$4,$5,'openfinance',$6,$7,$8,$9) ON CONFLICT (subscriber_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
          [c.subscriber_id, t.date.slice(0, 10), -amount, categorize(note, -amount), note, cardId, no, no ? t.totalInstallments : null, `${p.name}:${t.id}`],
        );
        imported += r.rowCount ?? 0;
      }
    }

    for (const a of banks) {
      const kind = a.subtype === 'SAVINGS_ACCOUNT' ? 'poupanca' : 'conta';
      const label = `${c.institution} ${a.name}`.trim().replace(/\s+/g, ' ').slice(0, 40) || 'Conta conectada';
      const w = await ctx.db.query<{ id: string }>(
        `INSERT INTO app.wallets(subscriber_id, name, kind, external_id, connection_id) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (subscriber_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET connection_id = EXCLUDED.connection_id RETURNING id`,
        [c.subscriber_id, label, kind, `${p.name}:${a.id}`, c.id],
      );
      const walletId = w.rows[0]!.id;
      for (const t of await p.listTransactions(a.id, from, today)) {
        const amount = cents(t.amount) * (t.type === 'CREDIT' ? 1 : -1);
        if (amount === 0) continue;
        const note = (t.description || 'Movimentação').trim().slice(0, 120);
        // Pagamento da fatura do cartão (saiu da conta): abate o cartão em vez de contar como gasto de novo
        if (amount < 0 && cardIds.length > 0 && CARD_BILL.test(fold(note))) {
          const r = await ctx.db.query(`INSERT INTO app.card_payments(subscriber_id, card_id, paid_on, amount_cents, wallet_id, note, external_id) VALUES ($1,$2,$3::date,$4,$5,$6,$7) ON CONFLICT (subscriber_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`, [c.subscriber_id, cardIds[0], t.date.slice(0, 10), -amount, walletId, note.slice(0, 100), `${p.name}:${t.id}`]);
          imported += r.rowCount ?? 0;
          continue;
        }
        const r = await ctx.db.query(
          `INSERT INTO app.ledger_entries(subscriber_id, occurred_on, amount_cents, category, note, source, wallet_id, external_id)
           VALUES ($1,$2::date,$3,$4,$5,'openfinance',$6,$7) ON CONFLICT (subscriber_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
          [c.subscriber_id, t.date.slice(0, 10), amount, categorize(note, amount), note, walletId, `${p.name}:${t.id}`],
        );
        imported += r.rowCount ?? 0;
      }
      // o saldo da carteira passa a ser o saldo real do banco: saldo de partida = saldo do banco - lançamentos + pagamentos de fatura que saíram dela
      await ctx.db.query(
        `UPDATE app.wallets SET opening_balance_cents = $2 - coalesce((SELECT sum(amount_cents) FROM app.ledger_entries WHERE wallet_id = app.wallets.id), 0)
                + coalesce((SELECT sum(cp.amount_cents) FROM app.card_payments cp WHERE cp.wallet_id = app.wallets.id), 0) WHERE id = $1`,
        [walletId, cents(a.balance)],
      );
    }
    await ctx.db.query(`UPDATE app.of_connections SET last_sync_at = now(), last_error = NULL WHERE id = $1 AND status = 'active'`, [c.id]);
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
  return { imported: await syncConnection(ctx, id, { refresh: true }) };
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

/** Worker: consentimento perto de vencer (até 30 dias) manda um e-mail; vencido, a conexão passa a pedir reconexão. */
export async function consentCheck(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.openFinance) return 0;
  await ctx.db.query(`UPDATE app.of_connections SET status = 'needs_action', last_error = 'Consentimento vencido', status_changed_at = now() WHERE status = 'active' AND consent_expires_at IS NOT NULL AND consent_expires_at < now()`);
  if (!ctx.email) return 0;
  const due = await ctx.db.query<{ id: string; institution: string; consent_expires_at: Date; email: string }>(
    `SELECT c.id, c.institution, c.consent_expires_at, b.email::text AS email
       FROM app.of_connections c
       JOIN app.subscribers b ON b.id = c.subscriber_id AND b.deleted_at IS NULL
       JOIN app.subscriptions s ON s.subscriber_id = c.subscriber_id AND s.status = 'active' AND s.current_period_end > now()
      WHERE c.status IN ('active','needs_action') AND c.consent_expires_at IS NOT NULL AND c.consent_expires_at > now() AND c.consent_expires_at < now() + interval '30 days'
        AND (c.renew_notified_at IS NULL OR c.renew_notified_at < now() - interval '14 days') LIMIT 50`,
  );
  let sent = 0;
  for (const r of due.rows) {
    const days = Math.max(1, Math.ceil((new Date(r.consent_expires_at).getTime() - Date.now()) / DAY));
    const body = emailLayout('Renove a conexão com o seu banco', [`A autorização para o Prumo ler os dados de ${r.institution || 'uma das suas contas'} vence em ${days} ${days === 1 ? 'dia' : 'dias'} (${new Date(r.consent_expires_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}).`, 'Pelas regras do Open Finance, o consentimento dura no máximo 12 meses. Para continuar trazendo saldo, extrato e fatura sozinhos, renove com um clique na aba Contas conectadas. Se não renovar, nada é apagado: o Prumo só para de atualizar essa conta.'], { label: 'Renovar a conexão', url: `${ctx.config.publicUrl}/conta/contas` });
    try {
      await ctx.email.send({ to: r.email, subject: `Renove a conexão com ${r.institution || 'o seu banco'}: vence em ${days} ${days === 1 ? 'dia' : 'dias'}`, ...body });
      await ctx.db.query(`UPDATE app.of_connections SET renew_notified_at = now() WHERE id = $1`, [r.id]);
      sent += 1;
    } catch {
      opts.log?.({ evento: 'openfinance_aviso_falhou' });
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Avisos do agregador (webhook): nunca confiamos no corpo; só usamos para saber QUAL conexão olhar e perguntamos o estado ao agregador.
// ---------------------------------------------------------------------------
export type OfWebhookOutcome = 'disabled' | 'invalid' | 'duplicate' | 'ignored' | 'processed';

export async function handleOpenFinanceWebhook(ctx: Ctx, headers: Record<string, string | string[] | undefined>, query: Record<string, unknown>, body: unknown): Promise<OfWebhookOutcome> {
  const secret = ctx.config.openFinanceWebhookSecret;
  if (!secret || !ctx.openFinance) return 'disabled';
  const h = (k: string) => { const v = headers[k]; return Array.isArray(v) ? v[0] : v; };
  const sent = String(h('x-webhook-secret') ?? h('x-of-secret') ?? query.token ?? '');
  if (!safeEqual(sent, secret)) return 'invalid';
  const b = (body && typeof body === 'object' ? body : {}) as { event?: unknown; eventId?: unknown; itemId?: unknown };
  const event = typeof b.event === 'string' ? b.event.slice(0, 60) : '';
  const itemId = typeof b.itemId === 'string' && /^[A-Za-z0-9-]{6,100}$/.test(b.itemId) ? b.itemId : null;
  if (!event || !itemId) return 'ignored';
  const eventId = typeof b.eventId === 'string' && b.eventId ? b.eventId.slice(0, 100) : `${event}:${itemId}:${Date.now()}`;
  const seen = await ctx.db.query<{ id: string }>(`INSERT INTO app.of_events(provider, event_id, event, item_id) VALUES ($1,$2,$3,$4) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`, [ctx.openFinance.name, eventId, event, itemId]);
  const evId = seen.rows[0]?.id;
  if (!evId) return 'duplicate';
  const conn = await ctx.db.query<{ id: string }>(`SELECT id FROM app.of_connections WHERE provider = $1 AND item_id = $2 AND status <> 'revoked'`, [ctx.openFinance.name, itemId]);
  const id = conn.rows[0]?.id;
  let outcome: OfWebhookOutcome = 'ignored';
  if (id) {
    try {
      if (event === 'item/updated' || event === 'item/created') {
        // o banco devolveu dados novos (ou a pessoa reconectou): confere o estado e sincroniza
        const item = await ctx.openFinance.getItem(itemId);
        if (!(await applyItemStatus(ctx, id, item))) await syncConnection(ctx, id);
        outcome = 'processed';
      } else if (event === 'item/error' || event === 'item/login_error' || event === 'item/waiting_user_input') {
        await applyItemStatus(ctx, id, { id: itemId, status: event === 'item/error' ? 'ERROR' : 'LOGIN_ERROR', institution: '' });
        if (event === 'item/error') await ctx.db.query(`UPDATE app.of_connections SET last_error = 'O banco não respondeu na última tentativa' WHERE id = $1`, [id]);
        outcome = 'processed';
      } else if (event === 'item/deleted') {
        await ctx.db.query(`UPDATE app.of_connections SET status = 'revoked' WHERE id = $1`, [id]);
        outcome = 'processed';
      }
    } catch {
      outcome = 'processed'; // o aviso foi recebido; o trabalho de fundo tenta de novo
    }
  }
  await ctx.db.query(`UPDATE app.of_events SET processed_at = now() WHERE id = $1`, [evId]);
  return outcome;
}
