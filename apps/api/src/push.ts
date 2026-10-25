// Notificações no celular (web push) do Prumo instalado como app. Três lembretes, todos opcionais e desligáveis:
// despesas do dia (no máximo uma por dia, na hora que a pessoa escolheu, e só se ela ainda não lançou nada hoje),
// metas (domingo, depois das 10h) e contas a vencer (as dos Lembretes). Nunca entre 22h e 8h (Brasília).
import webpush from 'web-push';
import { z } from 'zod';
import { AppError } from './errors.ts';
import type { Ctx } from './services.ts';
import { num, todaySaoPaulo } from './services.ts';
import { formatBrl } from './engine.ts';

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
  hour: z.number().int().min(8).max(21).optional(),
});

interface PrefRow { push_expenses: boolean; push_goals: boolean; push_bills: boolean; push_hour: number }

export async function pushView(ctx: Ctx, personId: string): Promise<{ available: boolean; publicKey: string | null; devices: number; prefs: { expenses: boolean; goals: boolean; bills: boolean; hour: number } }> {
  const [p, d] = await Promise.all([
    ctx.db.query<PrefRow>(`SELECT push_expenses, push_goals, push_bills, push_hour FROM app.subscribers WHERE id = $1`, [personId]),
    ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.push_devices WHERE subscriber_id = $1`, [personId]),
  ]);
  const r = p.rows[0];
  return {
    available: ctx.config.push !== null, publicKey: ctx.config.push?.publicKey ?? null, devices: Number(d.rows[0]?.n ?? 0),
    prefs: { expenses: r?.push_expenses ?? true, goals: r?.push_goals ?? true, bills: r?.push_bills ?? true, hour: Number(r?.push_hour ?? 20) },
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
    `UPDATE app.subscribers SET push_expenses = coalesce($2, push_expenses), push_goals = coalesce($3, push_goals), push_bills = coalesce($4, push_bills), push_hour = coalesce($5, push_hour) WHERE id = $1`,
    [personId, prefs.expenses ?? null, prefs.goals ?? null, prefs.bills ?? null, prefs.hour ?? null],
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

let lastRun = 0;
/** Roda de tempo em tempo (o worker chama a cada volta; aqui só passa de 5 em 5 minutos). Devolve quantas notificações saíram. */
export async function sendPushReminders(ctx: Ctx, opts: { force?: boolean; now?: { hour: number; weekday: number }; log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.config.push) return 0;
  if (!opts.force && Date.now() - lastRun < 300_000) return 0;
  lastRun = Date.now();
  const { hour, weekday } = opts.now ?? brt();
  if (hour < 8 || hour > 21) return 0; // noite é silêncio
  const today = todaySaoPaulo();
  const people = await ctx.db.query<{ id: string; push_expenses: boolean; push_goals: boolean; push_bills: boolean; push_hour: number; push_expenses_last: Date | string | null; push_goals_last: Date | string | null }>(
    `SELECT b.id, b.push_expenses, b.push_goals, b.push_bills, b.push_hour, b.push_expenses_last, b.push_goals_last
       FROM app.subscribers b
      WHERE b.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM app.push_devices d WHERE d.subscriber_id = b.id)
        AND EXISTS (SELECT 1 FROM app.subscriptions s WHERE s.subscriber_id = b.id AND s.status = 'active' AND s.current_period_end > now())
      LIMIT 500`,
  );
  let sent = 0;
  for (const p of people.rows) {
    try {
      // 1) Contas a vencer (as dos Lembretes), na mesma antecedência do e-mail, uma vez por vencimento.
      if (p.push_bills) {
        const due = await ctx.db.query<{ id: string; title: string; due_on: Date | string; amount_cents: string | null }>(
          `SELECT id, title, due_on, amount_cents FROM app.reminders
            WHERE subscriber_id = $1 AND done_at IS NULL AND due_on <= ($2::date + email_days_before) AND due_on >= ($2::date - 3)
              AND (push_notified_for IS NULL OR push_notified_for <> due_on) ORDER BY due_on LIMIT 5`,
          [p.id, today],
        );
        if (due.rows.length) {
          const first = due.rows[0]!;
          const days = Math.round((Date.parse(`${isoDay(first.due_on)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
          const when = days === 0 ? 'hoje' : days === 1 ? 'amanhã' : days < 0 ? `venceu há ${-days} dia(s)` : `em ${days} dias`;
          const one = due.rows.length === 1;
          const n = await sendToPerson(ctx, p.id, {
            title: one ? `${first.title} vence ${when}` : `${due.rows.length} contas pedem atenção`,
            body: one ? `${first.amount_cents ? `${formatBrl(num(first.amount_cents))}. ` : ''}Quando pagar, marque como feito.` : 'Veja o que vence e o que já passou.',
            url: '/conta/lembretes', tag: 'contas',
          });
          if (n > 0) {
            await ctx.db.query(`UPDATE app.reminders SET push_notified_for = due_on WHERE id = ANY($1::uuid[])`, [due.rows.map((r) => r.id)]);
            sent += n;
          }
        }
      }
      // 2) Despesas do dia: na hora escolhida (ou depois, se o servidor ficou fora), uma vez por dia, só se ainda não lançou nada hoje.
      if (p.push_expenses && hour >= p.push_hour && (p.push_expenses_last === null || isoDay(p.push_expenses_last) !== today)) {
        const has = await ctx.db.query(`SELECT 1 FROM app.ledger_entries WHERE subscriber_id = $1 AND occurred_on = $2::date LIMIT 1`, [p.id, today]);
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
          [p.id],
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
    } catch (e) {
      opts.log?.({ evento: 'push_lembrete_falhou', erro: e instanceof Error ? e.message.slice(0, 100) : 'erro' });
    }
  }
  return sent;
}
