// Cofre de acordos e documentos de dívida (aba "Cofre" do Prumo): contrato da renegociação, boleto, comprovante, extrato.
// Cada documento é da conta (titular), fica criptografado em repouso e pode ter um vencimento, que vira aviso por notificação.
// A busca olha título, credor, anotações e o texto que o aparelho extraiu do PDF; o servidor decifra só os documentos da própria pessoa.
import { z } from 'zod';
import { AppError, notFound } from './errors.ts';
import { decryptBytes, decryptText, encryptBytes, encryptText } from './crypto.ts';
import type { Ctx } from './services.ts';
import { num } from './services.ts';
import { requireFeature } from './subscriptions.ts';

export const KINDS = ['acordo', 'contrato', 'boleto', 'comprovante', 'extrato', 'outro'] as const;
export type VaultKind = (typeof KINDS)[number];
export const MAX_DOCS = 60;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, 'Data inválida');

export const vaultSchema = z.strictObject({
  kind: z.enum(KINDS),
  title: z.string().trim().min(1).max(120),
  creditor: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  amountCents: z.number().int().positive().max(100_000_000_00).nullish(),
  dueOn: isoDate.nullish(),
  /** Texto lido do PDF no aparelho, só para a busca. */
  text: z.string().max(20_000).nullish(),
  file: z.strictObject({ name: z.string().trim().max(120).nullish(), mime: z.string().max(60), data: z.string().max(7_200_000) }).nullish(),
});
export const vaultPatchSchema = z.strictObject({
  kind: z.enum(KINDS).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  creditor: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  amountCents: z.number().int().positive().max(100_000_000_00).nullish(),
  dueOn: isoDate.nullish(),
});

const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const iso = (d: unknown) => new Date(d as string).toISOString().slice(0, 10);

/** Confere o começo do arquivo: um executável renomeado para .pdf não entra. */
function magicOk(mime: string, b: Buffer): boolean {
  if (mime === 'application/pdf') return b.subarray(0, 1024).includes('%PDF');
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === 'image/webp') return b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

interface Row {
  id: string; kind: VaultKind; title_enc: Buffer; creditor_enc: Buffer | null; notes_enc: Buffer | null; text_enc: Buffer | null;
  amount_cents: string | null; due_on: Date | string | null; mime: string | null; size_bytes: number; created_at: Date | string;
}

export interface VaultDoc {
  id: string; kind: VaultKind; title: string; creditor: string | null; notes: string | null;
  amountCents: number | null; dueOn: string | null; hasFile: boolean; mime: string | null; sizeBytes: number; createdAt: string;
}

const dec = (ctx: Ctx, b: Buffer | null): string | null => (b ? decryptText(ctx.config.secret, b) : null);

export async function listDocs(ctx: Ctx, accountId: string, query?: string): Promise<{ docs: VaultDoc[]; limit: number; count: number }> {
  await requireFeature(ctx, accountId, 'debts');
  const r = await ctx.db.query<Row>(
    `SELECT id, kind, title_enc, creditor_enc, notes_enc, text_enc, amount_cents, due_on, mime, size_bytes, created_at
       FROM app.vault_docs WHERE subscriber_id = $1 ORDER BY (due_on IS NULL), due_on, created_at DESC`,
    [accountId],
  );
  const words = fold(query ?? '').split(/\s+/).filter(Boolean);
  const docs: VaultDoc[] = [];
  for (const x of r.rows) {
    const d: VaultDoc = {
      id: x.id, kind: x.kind, title: dec(ctx, x.title_enc) ?? '', creditor: dec(ctx, x.creditor_enc), notes: dec(ctx, x.notes_enc),
      amountCents: x.amount_cents === null ? null : num(x.amount_cents), dueOn: x.due_on ? iso(x.due_on) : null,
      hasFile: x.mime !== null, mime: x.mime, sizeBytes: x.size_bytes, createdAt: new Date(x.created_at).toISOString(),
    };
    if (words.length) {
      const hay = fold(`${x.kind} ${d.title} ${d.creditor ?? ''} ${d.notes ?? ''} ${dec(ctx, x.text_enc) ?? ''}`);
      if (!words.every((w) => hay.includes(w))) continue;
    }
    docs.push(d);
  }
  return { docs, limit: MAX_DOCS, count: r.rows.length };
}

export async function addDoc(ctx: Ctx, accountId: string, input: z.infer<typeof vaultSchema>): Promise<{ id: string }> {
  await requireFeature(ctx, accountId, 'debts');
  const n = await ctx.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.vault_docs WHERE subscriber_id = $1`, [accountId]);
  if (Number(n.rows[0]?.n ?? 0) >= MAX_DOCS) throw new AppError(409, 'vault_full', `O cofre guarda até ${MAX_DOCS} documentos. Apague algum para guardar outro.`);
  let bytes: Buffer | null = null;
  let mime: string | null = null;
  if (input.file) {
    mime = input.file.mime.toLowerCase();
    if (!MIMES.has(mime)) throw new AppError(415, 'file_type', 'O cofre guarda PDF, JPG, PNG ou WebP.');
    bytes = Buffer.from(input.file.data, 'base64');
    if (bytes.length === 0) throw new AppError(422, 'empty_file', 'O arquivo está vazio.');
    if (bytes.length > MAX_FILE_BYTES) throw new AppError(413, 'file_too_big', 'Arquivo grande demais: o limite é 5 MB.');
    if (!magicOk(mime, bytes)) throw new AppError(415, 'file_corrupt', 'O conteúdo do arquivo não corresponde ao tipo informado.');
  }
  const s = ctx.config.secret;
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.vault_docs(subscriber_id, kind, title_enc, creditor_enc, notes_enc, text_enc, amount_cents, due_on, mime, size_bytes, filename_enc, data_enc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      accountId, input.kind, encryptText(s, input.title), input.creditor ? encryptText(s, input.creditor) : null, input.notes ? encryptText(s, input.notes) : null,
      input.text ? encryptText(s, input.text) : null, input.amountCents ?? null, input.dueOn ?? null, mime, bytes?.length ?? 0,
      input.file?.name ? encryptText(s, input.file.name) : null, bytes ? encryptBytes(s, bytes) : null,
    ],
  );
  return { id: r.rows[0]!.id };
}

export async function updateDoc(ctx: Ctx, accountId: string, id: string, patch: z.infer<typeof vaultPatchSchema>): Promise<void> {
  await requireFeature(ctx, accountId, 'debts');
  const s = ctx.config.secret;
  const sets: string[] = [];
  const vals: unknown[] = [id, accountId];
  const put = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (patch.kind !== undefined) put('kind', patch.kind);
  if (patch.title !== undefined) put('title_enc', encryptText(s, patch.title));
  if (patch.creditor !== undefined) put('creditor_enc', patch.creditor ? encryptText(s, patch.creditor) : null);
  if (patch.notes !== undefined) put('notes_enc', patch.notes ? encryptText(s, patch.notes) : null);
  if (patch.amountCents !== undefined) put('amount_cents', patch.amountCents ?? null);
  if (patch.dueOn !== undefined) put('due_on', patch.dueOn ?? null);
  if (sets.length === 0) return;
  const r = await ctx.db.query(`UPDATE app.vault_docs SET ${sets.join(', ')} WHERE id = $1 AND subscriber_id = $2`, vals);
  if (r.rowCount === 0) throw notFound();
}

export async function deleteDoc(ctx: Ctx, accountId: string, id: string): Promise<void> {
  await requireFeature(ctx, accountId, 'debts');
  const r = await ctx.db.query(`DELETE FROM app.vault_docs WHERE id = $1 AND subscriber_id = $2`, [id, accountId]);
  if (r.rowCount === 0) throw notFound();
}

export async function getFile(ctx: Ctx, accountId: string, id: string): Promise<{ bytes: Buffer; mime: string; filename: string }> {
  await requireFeature(ctx, accountId, 'debts');
  const r = await ctx.db.query<{ title_enc: Buffer; filename_enc: Buffer | null; mime: string | null; data_enc: Buffer | null }>(
    `SELECT title_enc, filename_enc, mime, data_enc FROM app.vault_docs WHERE id = $1 AND subscriber_id = $2`, [id, accountId],
  );
  const x = r.rows[0];
  if (!x || !x.data_enc || !x.mime) throw notFound();
  const title = decryptText(ctx.config.secret, x.title_enc).replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 80) || 'documento';
  const name = x.filename_enc ? decryptText(ctx.config.secret, x.filename_enc) : `${title}.${EXT[x.mime] ?? 'bin'}`;
  return { bytes: decryptBytes(ctx.config.secret, x.data_enc), mime: x.mime, filename: name };
}

/** Para o aviso de vencimento: documentos da conta que vencem nos próximos dias (título já decifrado). */
export async function dueSoon(ctx: Ctx, accountId: string, today: string, days = 3): Promise<{ id: string; kind: VaultKind; title: string; dueOn: string }[]> {
  const r = await ctx.db.query<{ id: string; kind: VaultKind; title_enc: Buffer; due_on: Date | string }>(
    `SELECT id, kind, title_enc, due_on FROM app.vault_docs WHERE subscriber_id = $1 AND due_on BETWEEN $2::date AND ($2::date + $3::int) ORDER BY due_on LIMIT 5`,
    [accountId, today, days],
  );
  return r.rows.map((x) => ({ id: x.id, kind: x.kind, title: decryptText(ctx.config.secret, x.title_enc), dueOn: iso(x.due_on) }));
}
