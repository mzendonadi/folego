// Configurações que o dono muda pelo backoffice sem reiniciar nada. O ambiente (.env) dá o valor inicial; uma linha em
// app.settings vence o ambiente. API e worker são processos separados: cada um relê as configurações a cada poucos
// segundos (refreshRuntime), e a API aplica na hora a mudança feita por ela mesma.
import { z } from 'zod';
import type { Config } from './config.ts';
import type { Queryable } from './db.ts';

export const runtimeSchema = z.object({
  subscriptionsEnabled: z.boolean(),
  leadsEnabled: z.boolean(),
  aiEnabled: z.boolean(),
  aiMaxCallsPerDay: z.number().int().min(0).max(100_000),
  salesPaused: z.boolean(),
  announcement: z.object({ text: z.string().trim().min(1).max(240), tone: z.enum(['info', 'warn']) }).nullable(),
  bundlePriceCents: z.number().int().min(100).max(1_000_000),
  reminderDaysBefore: z.number().int().min(1).max(15),
  campaignDailyCap: z.number().int().min(0).max(5000),
}).partial();
export type RuntimePatch = z.infer<typeof runtimeSchema>;

export interface RuntimeSettings {
  subscriptionsEnabled: boolean;
  leadsEnabled: boolean;
  aiEnabled: boolean;
  aiMaxCallsPerDay: number;
  salesPaused: boolean;
  announcement: { text: string; tone: 'info' | 'warn' } | null;
  bundlePriceCents: number;
  reminderDaysBefore: number;
  campaignDailyCap: number;
}

export const currentSettings = (config: Config): RuntimeSettings => ({
  subscriptionsEnabled: config.subscriptionsEnabled,
  leadsEnabled: config.leadsEnabled,
  aiEnabled: config.aiEnabled,
  aiMaxCallsPerDay: config.aiMaxCallsPerDay,
  salesPaused: config.salesPaused,
  announcement: config.announcement,
  bundlePriceCents: config.bundlePriceCents,
  reminderDaysBefore: config.reminderDaysBefore,
  campaignDailyCap: config.campaignDailyCap,
});

function apply(config: Config, patch: RuntimePatch): void {
  if (patch.subscriptionsEnabled !== undefined) config.subscriptionsEnabled = patch.subscriptionsEnabled;
  if (patch.leadsEnabled !== undefined) config.leadsEnabled = patch.leadsEnabled;
  if (patch.aiEnabled !== undefined) config.aiEnabled = patch.aiEnabled;
  if (patch.aiMaxCallsPerDay !== undefined) config.aiMaxCallsPerDay = patch.aiMaxCallsPerDay;
  if (patch.salesPaused !== undefined) config.salesPaused = patch.salesPaused;
  if (patch.announcement !== undefined) config.announcement = patch.announcement;
  if (patch.bundlePriceCents !== undefined) config.bundlePriceCents = patch.bundlePriceCents;
  if (patch.reminderDaysBefore !== undefined) config.reminderDaysBefore = patch.reminderDaysBefore;
  if (patch.campaignDailyCap !== undefined) config.campaignDailyCap = patch.campaignDailyCap;
}

const lastRefresh = new WeakMap<Config, number>();

/** Relê app.settings e aplica em `config`. No máximo uma vez a cada 10 s (a menos que `force`). Erro de leitura nunca derruba o serviço. */
export async function refreshRuntime(db: Queryable, config: Config, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastRefresh.get(config) ?? 0) < 10_000) return;
  lastRefresh.set(config, now);
  try {
    const rows = await db.query<{ key: string; value: unknown }>(`SELECT key, value FROM app.settings`);
    const raw = Object.fromEntries(rows.rows.map((r) => [r.key, r.value]));
    const parsed = runtimeSchema.safeParse(raw);
    if (parsed.success) apply(config, parsed.data);
  } catch {
    /* tabela ainda não existe (migração pendente) ou banco indisponível: segue com o que já tem */
  }
}

/** Grava as configurações (uma linha por chave), aplica neste processo e devolve o que ficou valendo. */
export async function saveRuntime(db: Queryable, config: Config, patch: RuntimePatch, adminId: string): Promise<RuntimeSettings> {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    await db.query(
      `INSERT INTO app.settings(key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(value), adminId],
    );
  }
  apply(config, patch);
  return currentSettings(config);
}
