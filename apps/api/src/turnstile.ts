// Cloudflare Turnstile: verificação anti-robô nas rotas que custam dinheiro ou mandam e-mail (diagnóstico e códigos de acesso).
// Só vale quando TURNSTILE_SECRET está configurada no servidor; sem ela, tudo segue como antes (desligado, sem quebrar nada).
import { AppError } from './errors.ts';
import type { Config } from './config.ts';

export const turnstileEnabled = (config: Config): boolean => Boolean(config.turnstileSecret && config.turnstileSiteKey);

/** Confere o token do navegador com o Cloudflare. Falha de rede NÃO bloqueia quem é gente de verdade (falha aberta, com log). */
export async function verifyTurnstile(config: Config, token: unknown, ip: string, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!turnstileEnabled(config)) return;
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) throw new AppError(403, 'turnstile_required', 'Confirme a verificação de segurança e tente de novo.');
  let ok = false;
  try {
    const body = new URLSearchParams({ secret: config.turnstileSecret!, response: token, remoteip: ip });
    const res = await fetchFn('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(6_000) });
    ok = ((await res.json()) as { success?: boolean }).success === true;
  } catch {
    return; // o Cloudflare não respondeu: não punimos a pessoa por um problema nosso
  }
  if (!ok) throw new AppError(403, 'turnstile_failed', 'Não conseguimos confirmar a verificação de segurança. Recarregue a página e tente de novo.');
}
