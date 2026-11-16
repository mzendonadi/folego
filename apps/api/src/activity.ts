// Registro do uso do Prumo por dia (usuários ativos no backoffice). Uma linha por assinante, dia e canal; nada do que a pessoa fez.
// Uma gravação por dia e canal em cada processo (o resto da conversa não toca no banco) e nunca atrapalha quem está usando.
import type { Ctx } from './services.ts';
import { todaySaoPaulo } from './services.ts';

const seen = new Map<string, string>();

export async function noteActivity(ctx: Pick<Ctx, 'db'>, subscriberId: string, channel: 'app' | 'whatsapp'): Promise<void> {
  const day = todaySaoPaulo();
  const key = `${subscriberId}:${channel}`;
  if (seen.get(key) === day) return;
  if (seen.size > 50_000) seen.clear(); // limite de memória: pior caso, uma gravação repetida (o banco ignora)
  seen.set(key, day);
  await ctx.db
    .query(`INSERT INTO app.subscriber_activity(subscriber_id, day, channel) VALUES ($1, $2::date, $3) ON CONFLICT DO NOTHING`, [subscriberId, day, channel])
    .catch(() => seen.delete(key));
}
