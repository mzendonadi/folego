// Notificações no celular (web push) do Prumo instalado como app. Todas opcionais e desligáveis, nunca entre 22h e 8h (Brasília):
//   despesas do dia (1 por dia, na hora escolhida, só se ainda não lançou nada hoje), metas (domingo), contas a vencer,
//   avisos inteligentes (assinatura que subiu de preço, cobrança repetida, limite de categoria perto de estourar) e o resumo da semana.
// Quem usa a conta compartilhada de outra pessoa recebe pelos dados do titular; quem só consulta não recebe o pedido de lançar.
import webpush from 'web-push';
import { z } from 'zod';
import { AppError } from './errors.ts';
import type { Ctx } from './services.ts';
import { num, todaySaoPaulo } from './services.ts';
import { CATEGORY_LABEL, formatBrl } from './engine.ts';
import { recurringReport } from './insights.ts';
import { monthView } from './subscriptions.ts';
import { dueSoon } from './vault.ts';

export interface PushPayload { title: string; body: string; url: string; tag: string }
type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };
type Transport = (sub: Sub, payload: PushPayload, ctx: Ctx) => Promise<void>;

const realTransport: Transport = async (sub, payload, ctx) => {
  const p = ctx.config.push;
  if (!p) throw new AppError(409, 'push_off', 'As notificações ainda não estão ligadas neste servidor.');
  webpush.setVapidDetails(p.subject, p.publicKey, p.privateKey);
  await webpush.sendNotification(sub, JSON.stringify({ ...payload, icon: '/assets/icon-192.png', badge: '/assets/favicon-32.png' }), { TTL: 6 * 3600, urgency: 'normal' });
};
let transport: Transport = realTransport;
/** Só para testes: troca o envio de verdade por um falso. Sem argumento, volta ao normal. */
export function setPushTransport(t?: Transport): void { transport = t ?? realTransport; }

const MAX_DEVICES = 5;
const ALLOWED_URL = /^\/conta(\/[a-z]+)?$/;

export const subscribeSchema = z.strictObject({
  endpoint: z.string().url().max(1000).startsWith('https://'),
  keys: z.strictObject({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});
export const prefsSchema = z.strictObject({
  expenses: z.boolean().optional(), goals: z.boolean().optional(), bills: z.boolean().optional(),
  alerts: z.boolean().optional(), summary: z.boolean().optional(),
  hour: z.number().int().min(8).max(21).optional(),
});

interface PrefRow { push_expenses: boolean; push_goals: boolean; push_bills: boolean; push_alerts: boolean; push_summary: boolean; push_hour: number }

export async function pushView(ctx: Ctx, personId: string): Promise<{ available: boolean; publicKey: string | null; devices: number; prefs: { expenses: boolean; goals: boolean; bills: boolean; alerts: boolean; summary: boolean; hour: number } }> {
  const [p, d] = await Promise.all([
    ctx.db.query<PrefRow>(`SELECT push_expenses, push_goals, push_bills, push_alerts, push_summary, push_hour FROM app.subscribers WHERE id = $1`, [personId]),
    ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.push_devices WHERE subscriber_id = $1`, [personId]),
  ]);
  const r = p.rows[0];
  return {
    available: ctx.config.push !== null, publicKey: ctx.config.push?.publicKey ?? null, devices: Number(d.rows[0]?.n ?? 0),
    prefs: { expenses: r?.push_expenses ?? true, goals: r?.push_goals ?? true, bills: r?.push_bills ?? true, alerts: r?.push_alerts ?? true, summary: r?.push_summary ?? true, hour: Number(r?.push_hour ?? 20) },
  };
}

export async function subscribeDevice(ctx: Ctx, personId: string, body: z.infer<typeof subscribeSchema>, userAgent: string | undefined): Promise<void> {
  if (!ctx.config.push) throw new AppError(409, 'push_off', 'As notificações ainda não estão ligadas neste servidor.');
  await ctx.db.query(
    `INSERT INTO app.push_devices(subscriber_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET subscriber_id = EXCLUDED.subscriber_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, fail_n = 0`,
    [personId, body.endpoint, body.keys.p256dh, body.keys.auth, (userAgent ?? '').slice(0, 200) || null],
  );
  // Guarda só os MAX_DEVICES mais recentes: aparelho antigo que a pessoa trocou não fica acumulando.
  await ctx.db.query(
    `DELETE FROM app.push_devices WHERE subscriber_id = $1 AND id NOT IN (SELECT id FROM app.push_devices WHERE subscriber_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${MAX_DEVICES})`,
    [personId],
  );
}

export async function forgetDevice(ctx: Ctx, personId: string, endpoint: string): Promise<void> {
  await ctx.db.query(`DELETE FROM app.push_devices WHERE subscriber_id = $1 AND endpoint = $2`, [personId, endpoint]);
}

export async function savePrefs(ctx: Ctx, personId: string, prefs: z.infer<typeof prefsSchema>): Promise<void> {
  await ctx.db.query(
    `UPDATE app.subscribers SET push_expenses = coalesce($2, push_expenses), push_goals = coalesce($3, push_goals), push_bills = coalesce($4, push_bills),
            push_alerts = coalesce($5, push_alerts), push_summary = coalesce($6, push_summary), push_hour = coalesce($7, push_hour) WHERE id = $1`,
    [personId, prefs.expenses ?? null, prefs.goals ?? null, prefs.bills ?? null, prefs.alerts ?? null, prefs.summary ?? null, prefs.hour ?? null],
  );
}

/** Manda para todos os aparelhos da pessoa. Aparelho que o navegador desligou (404/410) é esquecido; falha passageira conta ponto e some só depois de 5 seguidas. */
export async function sendToPerson(ctx: Ctx, personId: string, payload: PushPayload): Promise<number> {
  if (!ALLOWED_URL.test(payload.url)) throw new Error('endereço de notificação fora de /conta');
  const devs = await ctx.db.query<{ id: string; endpoint: string; p256dh: string; auth: string; fail_n: number }>(`SELECT id, endpoint, p256dh, auth, fail_n FROM app.push_devices WHERE subscriber_id = $1`, [personId]);
  let ok = 0;
  for (const d of devs.rows) {
    try {
      await transport({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, ctx);
      await ctx.db.query(`UPDATE app.push_devices SET fail_n = 0, last_sent_at = now() WHERE id = $1`, [d.id]);
      ok += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410 || d.fail_n + 1 >= 5) await ctx.db.query(`DELETE FROM app.push_devices WHERE id = $1`, [d.id]);
      else await ctx.db.query(`UPDATE app.push_devices SET fail_n = fail_n + 1 WHERE id = $1`, [d.id]);
    }
  }
  return ok;
}

export async function sendTest(ctx: Ctx, personId: string): Promise<number> {
  const n = await sendToPerson(ctx, personId, { title: 'Tudo certo por aqui', body: 'Você vai receber os lembretes do Prumo neste aparelho.', url: '/conta', tag: 'teste' });
  if (n === 0) throw new AppError(409, 'push_no_device', 'Não encontrei nenhum aparelho com notificações ligadas. Ative as notificações neste aparelho e tente de novo.');
  return n;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
const brt = (): { hour: number; weekday: number } => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? 'Sun');
  return { hour, weekday };
};
const isoDay = (d: unknown): string => new Date(d as string).toISOString().slice(0, 10);
const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const label = (c: string): string => (CATEGORY_LABEL as Record<string, string>)[c] ?? c;
/** Semana ISO ("2026-W43"): o resumo semanal sai uma vez por semana mesmo que o servidor fique fora na segunda. */
const isoWeek = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d.getTime() - y0.getTime()) / 86_400_000 + 1) / 7)).padStart(2, '0')}`;
};

interface Person {
  id: string; data_id: string; role: string;
  push_expenses: boolean; push_goals: boolean; push_bills: boolean; push_alerts: boolean; push_summary: boolean; push_hour: number;
  push_expenses_last: Date | string | null; push_goals_last: Date | string | null;
}

const alreadySent = async (ctx: Ctx, id: string, key: string): Promise<boolean> => (await ctx.db.query(`SELECT 1 FROM app.push_sent WHERE subscriber_id = $1 AND key = $2`, [id, key])).rows.length > 0;
const markSent = (ctx: Ctx, id: string, key: string, today: string) => ctx.db.query(`INSERT INTO app.push_sent(subscriber_id, key, sent_on) VALUES ($1,$2,$3::date) ON CONFLICT DO NOTHING`, [id, key, today]);

/** Avisos que dependem de olhar os números (rodam uma vez por dia por pessoa): preço que subiu, cobrança repetida, limite e resumo da semana. */
async function smartAlerts(ctx: Ctx, p: Person, today: string, weekday: number): Promise<number> {
  let sent = 0;
  let budget = 2; // no máximo 2 avisos por dia, para não virar barulho
  const send = async (key: string, payload: PushPayload) => {
    if (budget <= 0 || (await alreadySent(ctx, p.id, key))) return;
    const n = await sendToPerson(ctx, p.id, payload);
    if (n > 0) { await markSent(ctx, p.id, key, today); sent += n; budget -= 1; }
  };
  if (p.push_alerts) {
    try {
      const rep = await recurringReport(ctx, p.data_id);
      for (const i of rep.items) {
        if (i.decision === 'cancel') continue; // já decidiu cancelar: não insiste
        if (i.priceChange) {
          await send(`preco:${i.key}:${i.priceChange.since}`, { title: `${i.name} ficou mais caro`, body: `De ${formatBrl(i.priceChange.fromCents)} para ${formatBrl(i.priceChange.toCents)} (+${Math.round(i.priceChange.pct)}%). Veja em Cobranças.`, url: '/conta/cobrancas', tag: 'preco' });
        }
        if (i.duplicate && i.duplicate.date >= addDays(today, -7)) {
          await send(`dup:${i.key}:${i.duplicate.date}`, { title: `Cobrança repetida: ${i.name}`, body: `${formatBrl(i.duplicate.cents)} apareceu duas vezes em ${new Date(`${i.duplicate.date}T12:00:00`).toLocaleDateString('pt-BR')}. Vale conferir.`, url: '/conta/cobrancas', tag: 'duplicada' });
        }
      }
    } catch { /* plano sem o detector, ou sem dados: segue */ }
    try {
      const month = today.slice(0, 7);
      const view = await monthView(ctx, p.data_id, month);
      for (const c of view.summary.byCategory) {
        if (c.limitCents === null || c.limitCents <= 0) continue;
        const ratio = c.cents / c.limitCents;
        if (ratio >= 1) await send(`lim100:${c.category}:${month}`, { title: `Você passou do limite de ${label(c.category)}`, body: `${formatBrl(c.cents)} gastos de ${formatBrl(c.limitCents)} neste mês.`, url: '/conta/orcamento', tag: `limite-${c.category}` });
        else if (ratio >= 0.9) await send(`lim90:${c.category}:${month}`, { title: `${label(c.category)}: 90% do limite`, body: `${formatBrl(c.cents)} de ${formatBrl(c.limitCents)}. Falta pouco para estourar.`, url: '/conta/orcamento', tag: `limite-${c.category}` });
      }
    } catch { /* sem limites ou sem permissão do plano: segue */ }
  }
  if (p.push_summary && weekday === 1) {
    const key = `resumo:${isoWeek(today)}`;
    if (!(await alreadySent(ctx, p.id, key))) {
      const sums = await ctx.db.query<{ last: string | null; prev: string | null }>(
        `SELECT coalesce(sum(-amount_cents) FILTER (WHERE occurred_on >= $2::date - 7 AND occurred_on < $2::date), 0)::text AS last,
                coalesce(sum(-amount_cents) FILTER (WHERE occurred_on >= $2::date - 14 AND occurred_on < $2::date - 7), 0)::text AS prev
           FROM app.ledger_entries WHERE subscriber_id = $1 AND amount_cents < 0 AND transfer_kind IS NULL`,
        [p.data_id, today],
      );
      const last = num(sums.rows[0]?.last ?? '0');
      const prev = num(sums.rows[0]?.prev ?? '0');
      if (last === 0 && prev === 0) {
        await markSent(ctx, p.id, key, today); // semana sem lançamentos: nada a resumir
      } else {
        const top = await ctx.db.query<{ category: string; c: string }>(
          `SELECT category, sum(-amount_cents)::text AS c FROM app.ledger_entries WHERE subscriber_id = $1 AND amount_cents < 0 AND transfer_kind IS NULL AND occurred_on >= $2::date - 7 AND occurred_on < $2::date GROUP BY category ORDER BY sum(-amount_cents) DESC LIMIT 1`,
          [p.data_id, today],
        );
        const cmp = prev > 0 ? ` (semana anterior: ${formatBrl(prev)})` : '';
        const biggest = top.rows[0] ? ` Maior gasto: ${label(top.rows[0].category)}.` : '';
        await send(key, { title: 'Sua semana no Prumo', body: `Você gastou ${formatBrl(last)}${cmp}.${biggest}`, url: '/conta/geral', tag: 'resumo' });
      }
    }
  }
  return sent;
}

let lastRun = 0;
/** Roda de tempo em tempo (o worker chama a cada volta; aqui só passa de 5 em 5 minutos). Devolve quantas notificações saíram. */
export async function sendPushReminders(ctx: Ctx, opts: { force?: boolean; now?: { hour: number; weekday: number }; log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.config.push) return 0;
  if (!opts.force && Date.now() - lastRun < 300_000) return 0;
  lastRun = Date.now();
  const { hour, weekday } = opts.now ?? brt();
  if (hour < 8 || hour > 21) return 0; // noite é silêncio
  const today = todaySaoPaulo();
  await ctx.db.query(`DELETE FROM app.push_sent WHERE sent_on < $1::date - 120`, [today]).catch(() => undefined);
  const people = await ctx.db.query<Person>(
    `SELECT b.id, coalesce(h.owner_id, b.id) AS data_id, coalesce(h.role, 'edita') AS role,
            b.push_expenses, b.push_goals, b.push_bills, b.push_alerts, b.push_summary, b.push_hour, b.push_expenses_last, b.push_goals_last
       FROM app.subscribers b
       LEFT JOIN app.household_members h ON h.member_id = b.id AND h.status = 'active'
      WHERE b.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM app.push_devices d WHERE d.subscriber_id = b.id)
        AND EXISTS (SELECT 1 FROM app.subscriptions s WHERE s.subscriber_id = coalesce(h.owner_id, b.id) AND s.status = 'active' AND s.current_period_end > now())
      LIMIT 500`,
  );
  let sent = 0;
  for (const p of people.rows) {
    try {
      // 1) Contas a vencer (as dos Lembretes), na mesma antecedência do e-mail, uma vez por vencimento e por pessoa.
      if (p.push_bills) {
        const due = await ctx.db.query<{ id: string; title: string; due_on: Date | string; amount_cents: string | null }>(
          `SELECT id, title, due_on, amount_cents FROM app.reminders
            WHERE subscriber_id = $1 AND done_at IS NULL AND due_on <= ($2::date + email_days_before) AND due_on >= ($2::date - 3) ORDER BY due_on LIMIT 8`,
          [p.data_id, today],
        );
        const fresh: typeof due.rows = [];
        for (const r of due.rows) if (!(await alreadySent(ctx, p.id, `conta:${r.id}:${isoDay(r.due_on)}`))) fresh.push(r);
        const list = fresh.slice(0, 5);
        if (list.length) {
          const first = list[0]!;
          const days = Math.round((Date.parse(`${isoDay(first.due_on)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
          const when = days === 0 ? 'hoje' : days === 1 ? 'amanhã' : days < 0 ? `venceu há ${-days} dia(s)` : `em ${days} dias`;
          const one = list.length === 1;
          const n = await sendToPerson(ctx, p.id, {
            title: one ? `${first.title} vence ${when}` : `${list.length} contas pedem atenção`,
            body: one ? `${first.amount_cents ? `${formatBrl(num(first.amount_cents))}. ` : ''}Quando pagar, marque como feito.` : 'Veja o que vence e o que já passou.',
            url: '/conta/lembretes', tag: 'contas',
          });
          if (n > 0) {
            for (const r of list) await markSent(ctx, p.id, `conta:${r.id}:${isoDay(r.due_on)}`, today);
            sent += n;
          }
        }
      }
      // 1b) Acordo ou boleto guardado no Cofre que vence nos próximos 3 dias (junto das contas a vencer).
      if (p.push_bills) {
        const docs = await dueSoon(ctx, p.data_id, today, 3).catch((): Awaited<ReturnType<typeof dueSoon>> => []);
        const fresh: typeof docs = [];
        for (const d of docs) if (!(await alreadySent(ctx, p.id, `cofre:${d.id}:${d.dueOn}`))) fresh.push(d);
        if (fresh.length) {
          const first = fresh[0]!;
          const days = Math.round((Date.parse(`${first.dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
          const when = days <= 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`;
          const kind = ({ acordo: 'Acordo', contrato: 'Contrato', boleto: 'Boleto', comprovante: 'Comprovante', extrato: 'Extrato', outro: 'Documento' } as Record<string, string>)[first.kind] ?? 'Documento';
          const n = await sendToPerson(ctx, p.id, {
            title: fresh.length === 1 ? `${kind} vence ${when}` : `${fresh.length} documentos do cofre vencem em breve`,
            body: fresh.length === 1 ? first.title : 'Abra o Cofre para ver quais são.',
            url: '/conta/cofre', tag: 'cofre',
          });
          if (n > 0) {
            for (const d of fresh) await markSent(ctx, p.id, `cofre:${d.id}:${d.dueOn}`, today);
            sent += n;
          }
        }
      }
      // 2) Despesas do dia: na hora escolhida (ou depois, se o servidor ficou fora), uma vez por dia, só se ainda não lançou nada hoje.
      //    Quem só consulta a conta de outra pessoa não é chamado a lançar.
      if (p.push_expenses && p.role !== 'consulta' && hour >= p.push_hour && (p.push_expenses_last === null || isoDay(p.push_expenses_last) !== today)) {
        const has = await ctx.db.query(`SELECT 1 FROM app.ledger_entries WHERE subscriber_id = $1 AND occurred_on = $2::date LIMIT 1`, [p.data_id, today]);
        if (has.rows.length > 0) {
          await ctx.db.query(`UPDATE app.subscribers SET push_expenses_last = $2::date WHERE id = $1`, [p.id, today]); // já lançou: não incomoda
        } else {
          const n = await sendToPerson(ctx, p.id, { title: 'Lembre de lançar suas despesas de hoje', body: 'Leva um minuto: o que você gastou hoje?', url: '/conta/lancamentos', tag: 'despesas' });
          if (n > 0) {
            await ctx.db.query(`UPDATE app.subscribers SET push_expenses_last = $2::date WHERE id = $1`, [p.id, today]);
            sent += n;
          }
        }
      }
      // 3) Metas: aos domingos, depois das 10h, uma vez por semana, se existe meta em andamento.
      if (p.push_goals && weekday === 0 && hour >= 10 && (p.push_goals_last === null || isoDay(p.push_goals_last) !== today)) {
        const g = await ctx.db.query<{ name: string; target_cents: string; saved_cents: string }>(
          `SELECT name, target_cents, saved_cents FROM app.goals WHERE subscriber_id = $1 AND saved_cents < target_cents ORDER BY (due_on IS NULL), due_on, created_at LIMIT 1`,
          [p.data_id],
        );
        const goal = g.rows[0];
        if (goal) {
          const pct = Math.floor((num(goal.saved_cents) / num(goal.target_cents)) * 100);
          const n = await sendToPerson(ctx, p.id, { title: 'Relembre suas metas', body: `"${goal.name}": você já guardou ${pct}%. Que tal um aporte hoje?`, url: '/conta/metas', tag: 'metas' });
          if (n > 0) {
            await ctx.db.query(`UPDATE app.subscribers SET push_goals_last = $2::date WHERE id = $1`, [p.id, today]);
            sent += n;
          }
        }
      }
      // 4) Avisos inteligentes e resumo da semana: a partir das 9h, uma checagem por dia.
      if (hour >= 9 && (p.push_alerts || p.push_summary) && !(await alreadySent(ctx, p.id, `chk:${today}`))) {
        sent += await smartAlerts(ctx, p, today, weekday);
        await markSent(ctx, p.id, `chk:${today}`, today);
      }
    } catch (e) {
      opts.log?.({ evento: 'push_lembrete_falhou', erro: e instanceof Error ? e.message.slice(0, 100) : 'erro' });
    }
  }
  return sent;
}
