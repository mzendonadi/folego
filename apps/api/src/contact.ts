// Fale conosco (modal da landing): a mensagem vai por e-mail para o suporte. Nada é gravado no banco:
// o endereço de quem escreve é usado para responder e descartado, como nos demais e-mails do Fôlego.
import { z } from 'zod';
import { AppError } from './errors.ts';
import { layout } from './email.ts';
import type { Ctx } from './services.ts';

export const SUPPORT_EMAIL = 'suporte@folego.online';

export const contactSchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(30).optional(),
  message: z.string().trim().min(5).max(2000),
  /** Isca para robôs: pessoas não veem este campo. Preenchido = descartado em silêncio. */
  website: z.string().max(200).optional(),
});
export type ContactInput = z.infer<typeof contactSchema>;

/** Uma linha só, sem quebras: evita injeção de cabeçalho no assunto. */
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim();

export async function sendContact(ctx: Ctx, input: ContactInput): Promise<{ sent: boolean }> {
  if (input.website) return { sent: true }; // robô: finge que enviou, não manda nada
  if (!ctx.email) throw new AppError(503, 'email_off', `Não consegui enviar agora. Escreva para ${SUPPORT_EMAIL}.`);
  const phone = input.phone ? oneLine(input.phone) : '';
  const body = layout(`Mensagem pelo site: ${oneLine(input.name)}`, [
    `Nome: ${oneLine(input.name)}`,
    `E-mail: ${input.email}`,
    ...(phone ? [`Telefone: ${phone}`] : []),
    'Mensagem:',
    input.message,
  ]);
  try {
    await ctx.email.send({ to: SUPPORT_EMAIL, subject: `Contato pelo site: ${oneLine(input.name).slice(0, 60)}`, headers: { 'Reply-To': input.email }, ...body });
  } catch {
    throw new AppError(503, 'email_failed', `Não consegui enviar agora. Escreva para ${SUPPORT_EMAIL}.`);
  }
  return { sent: true };
}
