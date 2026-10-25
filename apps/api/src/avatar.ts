// Foto de perfil do assinante (ícone no topo do Prumo): incluir, trocar e apagar. É da pessoa que entrou (não da conta compartilhada).
// O navegador reduz a foto para um quadrado pequeno (até ~36 KB) antes de enviar; aqui só conferimos tipo, tamanho e o começo do arquivo.
import { z } from 'zod';
import { AppError, notFound } from './errors.ts';
import { decryptBytes, encryptBytes } from './crypto.ts';
import type { Ctx } from './services.ts';

export const MAX_AVATAR_BYTES = 40 * 1024;
export const avatarSchema = z.strictObject({ mime: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(20).max(56_000) });

function magicOk(mime: string, b: Buffer): boolean {
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
}

export async function saveAvatar(ctx: Ctx, personId: string, input: z.infer<typeof avatarSchema>): Promise<{ avatarAt: string }> {
  const bytes = Buffer.from(input.data, 'base64');
  if (bytes.length === 0) throw new AppError(422, 'empty_file', 'A foto está vazia.');
  if (bytes.length > MAX_AVATAR_BYTES) throw new AppError(413, 'file_too_big', 'A foto ficou grande demais. Escolha outra.');
  if (!magicOk(input.mime, bytes)) throw new AppError(415, 'file_corrupt', 'O conteúdo do arquivo não corresponde a uma foto.');
  const r = await ctx.db.query<{ avatar_at: Date | string }>(
    `UPDATE app.subscribers SET avatar_enc = $2, avatar_mime = $3, avatar_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING avatar_at`,
    [personId, encryptBytes(ctx.config.secret, bytes), input.mime],
  );
  if (!r.rows[0]) throw notFound();
  return { avatarAt: new Date(r.rows[0].avatar_at).toISOString() };
}

export async function getAvatar(ctx: Ctx, personId: string): Promise<{ bytes: Buffer; mime: string }> {
  const r = await ctx.db.query<{ avatar_enc: Buffer | null; avatar_mime: string | null }>(`SELECT avatar_enc, avatar_mime FROM app.subscribers WHERE id = $1 AND deleted_at IS NULL`, [personId]);
  const x = r.rows[0];
  if (!x?.avatar_enc || !x.avatar_mime) throw notFound();
  return { bytes: decryptBytes(ctx.config.secret, x.avatar_enc), mime: x.avatar_mime };
}

export async function deleteAvatar(ctx: Ctx, personId: string): Promise<void> {
  await ctx.db.query(`UPDATE app.subscribers SET avatar_enc = NULL, avatar_mime = NULL, avatar_at = NULL WHERE id = $1`, [personId]);
}
