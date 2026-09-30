// Eventos de navegação do site (funil e jornada). Sem terceiros, sem IP e sem dado pessoal: só o nome do evento, a tela,
// e (uma vez por sessão) a origem (UTM/referência) e o tipo de aparelho.
import { z } from 'zod';
import type { Ctx } from '../services.ts';

const token = z.string().regex(/^[a-zA-Z0-9_.\-]{1,40}$/);
const label = z.string().trim().max(60);

export const eventSchema = z.object({
  name: z.enum(['view', 'cta', 'tool', 'intake_step']),
  props: z.record(z.string().regex(/^[a-z_]{1,20}$/), z.union([token, z.number().int().min(0).max(1000)])).refine((p) => Object.keys(p).length <= 4, 'props demais').default({}),
  attr: z.object({ source: label.optional(), medium: label.optional(), campaign: label.optional(), device: z.enum(['mobile', 'tablet', 'desktop']).optional() }).optional(),
});
export type EventInput = z.infer<typeof eventSchema>;

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|facebookexternalhit|preview|monitor|uptime/i;

/** Ignora robôs (não fazem parte do funil). Devolve true se gravou. */
export async function recordEvent(ctx: Ctx, sessionId: string, input: EventInput, userAgent: string | undefined): Promise<boolean> {
  if (userAgent && BOT.test(userAgent)) return false;
  const props: Record<string, unknown> = { ...input.props };
  if (input.attr) props.attr = Object.fromEntries(Object.entries(input.attr).filter(([, v]) => v));
  await ctx.db.query(`INSERT INTO app.events(session_id, name, props) VALUES ($1, $2, $3::jsonb)`, [sessionId, input.name, JSON.stringify(props)]);
  return true;
}
