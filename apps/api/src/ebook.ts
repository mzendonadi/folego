// eBook de presente: repositório (PDF no banco, com versões) e envio automático a quem assina Ousado ou Desbravador.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, notFound } from './errors.ts';
import { brandLayout } from './email.ts';
import type { Ctx } from './services.ts';
import { audit, num } from './services.ts';
import type { Queryable } from './db.ts';

export const MAX_EBOOK_BYTES = 15 * 1024 * 1024;
export const GIFT_PLANS = ['ousado', 'desbravador'];
const DEFAULT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'assets/folego-ebook.pdf');
const DEFAULT_TITLE = 'Respira. Organiza. Avança. O guia do Fôlego para organizar o dinheiro e conquistar tranquilidade';

export interface EbookRow {
  id: string;
  title: string;
  filename: string;
  sizeBytes: number;
  version: number;
  active: boolean;
  source: string;
  sentCount: number;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const safeName = (n: string) => {
  const base = n.replace(/\.pdf$/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `${base || 'ebook'}.pdf`;
};

function assertPdf(buf: Buffer): void {
  if (buf.length < 100 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError(422, 'not_pdf', 'O arquivo não é um PDF válido.');
  if (buf.length > MAX_EBOOK_BYTES) throw new AppError(413, 'too_big', 'O PDF passa de 15 MB.');
}

/** Primeira subida: se não há nenhum eBook, importa o que vem junto com o sistema e o deixa ativo. */
export async function ensureDefaultEbook(db: Queryable): Promise<boolean> {
  const has = await db.query(`SELECT 1 FROM app.ebooks LIMIT 1`);
  if (has.rows.length > 0) return false;
  let buf: Buffer;
  try {
    buf = await readFile(DEFAULT_FILE);
  } catch {
    return false;
  }
  await db.query(`INSERT INTO app.ebooks(title, filename, size_bytes, content, active, source, uploaded_by) VALUES ($1,$2,$3,$4,true,'padrao','sistema')`, [DEFAULT_TITLE, 'Folego-eBook-Respira-Organiza-Avanca.pdf', buf.length, buf]);
  return true;
}

const toRow = (r: { id: string; title: string; filename: string; size_bytes: number; version: number; active: boolean; source: string; sent_count: number; uploaded_by: string | null; created_at: Date; updated_at: Date }): EbookRow => ({
  id: r.id, title: r.title, filename: r.filename, sizeBytes: r.size_bytes, version: r.version, active: r.active, source: r.source, sentCount: r.sent_count, uploadedBy: r.uploaded_by, createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});

const COLS = 'id, title, filename, size_bytes, version, active, source, sent_count, uploaded_by, created_at, updated_at';

export async function listEbooks(ctx: Ctx) {
  const r = await ctx.db.query<Parameters<typeof toRow>[0]>(`SELECT ${COLS} FROM app.ebooks ORDER BY active DESC, created_at DESC`);
  const waiting = await ctx.db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM app.subscribers b JOIN app.subscriptions s ON s.subscriber_id = b.id AND s.status = 'active' AND s.current_period_end > now()
      WHERE b.deleted_at IS NULL AND b.ebook_sent_at IS NULL AND s.plan = ANY($1::text[])`,
    [GIFT_PLANS],
  );
  return { ebooks: r.rows.map(toRow), waiting: num(waiting.rows[0]?.n ?? 0), emailConfigured: Boolean(ctx.email), plans: GIFT_PLANS };
}

export async function uploadEbook(ctx: Ctx, input: { title: string; filename: string; buf: Buffer; by: string; activate: boolean }): Promise<EbookRow> {
  assertPdf(input.buf);
  const title = input.title.trim().slice(0, 160) || 'eBook do Fôlego';
  const row = await ctx.db.tx(async (q) => {
    if (input.activate) await q.query(`UPDATE app.ebooks SET active = false WHERE active`);
    const r = await q.query<Parameters<typeof toRow>[0]>(`INSERT INTO app.ebooks(title, filename, size_bytes, content, active, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLS}`, [title, safeName(input.filename), input.buf.length, input.buf, input.activate, input.by]);
    await audit(q, `admin:${input.by}`, 'ebook_uploaded', 'ebook', r.rows[0]!.id, { title, bytes: input.buf.length, active: input.activate });
    return r.rows[0]!;
  });
  return toRow(row);
}

/** "Atualizar": troca o PDF de uma entrada (mantém o título, soma uma versão). */
export async function replaceEbookFile(ctx: Ctx, id: string, input: { filename: string; buf: Buffer; by: string }): Promise<EbookRow> {
  assertPdf(input.buf);
  const r = await ctx.db.query<Parameters<typeof toRow>[0]>(`UPDATE app.ebooks SET content = $2, size_bytes = $3, filename = $4, version = version + 1, uploaded_by = $5 WHERE id = $1 RETURNING ${COLS}`, [id, input.buf, input.buf.length, safeName(input.filename), input.by]);
  if (!r.rows[0]) throw notFound();
  await audit(ctx.db, `admin:${input.by}`, 'ebook_replaced', 'ebook', id, { bytes: input.buf.length, version: r.rows[0].version });
  return toRow(r.rows[0]);
}

export async function updateEbook(ctx: Ctx, id: string, patch: { title?: string | undefined; active?: boolean | undefined }, by: string): Promise<EbookRow> {
  const row = await ctx.db.tx(async (q) => {
    const cur = await q.query(`SELECT 1 FROM app.ebooks WHERE id = $1`, [id]);
    if (cur.rows.length === 0) throw notFound();
    if (patch.title !== undefined) await q.query(`UPDATE app.ebooks SET title = $2 WHERE id = $1`, [id, patch.title.trim().slice(0, 160) || 'eBook do Fôlego']);
    if (patch.active === true) {
      await q.query(`UPDATE app.ebooks SET active = false WHERE active AND id <> $1`, [id]);
      await q.query(`UPDATE app.ebooks SET active = true WHERE id = $1`, [id]);
    } else if (patch.active === false) await q.query(`UPDATE app.ebooks SET active = false WHERE id = $1`, [id]);
    await audit(q, `admin:${by}`, 'ebook_updated', 'ebook', id, { ...patch });
    return (await q.query<Parameters<typeof toRow>[0]>(`SELECT ${COLS} FROM app.ebooks WHERE id = $1`, [id])).rows[0]!;
  });
  return toRow(row);
}

export async function deleteEbook(ctx: Ctx, id: string, by: string): Promise<void> {
  const r = await ctx.db.query(`DELETE FROM app.ebooks WHERE id = $1`, [id]);
  if (r.rowCount === 0) throw notFound();
  await audit(ctx.db, `admin:${by}`, 'ebook_deleted', 'ebook', id);
}

export async function ebookFile(ctx: Ctx, id: string): Promise<{ filename: string; content: Buffer }> {
  const r = await ctx.db.query<{ filename: string; content: Buffer }>(`SELECT filename, content FROM app.ebooks WHERE id = $1`, [id]);
  if (!r.rows[0]) throw notFound();
  return { filename: r.rows[0].filename, content: Buffer.from(r.rows[0].content) };
}

async function activeEbook(ctx: Ctx) {
  const r = await ctx.db.query<{ id: string; title: string; filename: string; content: Buffer }>(`SELECT id, title, filename, content FROM app.ebooks WHERE active LIMIT 1`);
  return r.rows[0] ? { ...r.rows[0], content: Buffer.from(r.rows[0].content) } : null;
}

const firstName = (display: string | null, email: string) => {
  const raw = (display ?? email.split('@')[0] ?? '').split(/[\s._-]+/)[0] ?? '';
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : '';
};

/** O e-mail do presente (também usado no envio de teste do backoffice). */
export function giftMail(ctx: Ctx, name: string, planName: string) {
  const referral = ctx.config.referralEnabled && ctx.config.referralDiscountPct > 0;
  return brandLayout({
    preheader: 'Obrigado por assinar o Prumo. Seu eBook de presente está anexado.',
    kicker: 'Um presente de boas-vindas',
    title: name ? `${name}, obrigado por assinar o Prumo` : 'Obrigado por assinar o Prumo',
    paragraphs: [
      name ? `Oi, ${name}! Que alegria ter você no plano **${planName}**.` : `Que alegria ter você no plano **${planName}**.`,
      'Assinar é um voto de confiança. Você decidiu cuidar do seu dinheiro com mais calma e mais método, e a gente leva isso muito a sério. Por isso, preparamos um presente só para quem escolhe caminhar com a gente: o eBook **Respira. Organiza. Avança.**',
      'Ele está **anexado a este e-mail**, em PDF. Salve no celular, no computador, imprima, rabisque. O jeito de ler é o seu.',
    ],
    highlight: {
      title: 'O que você vai encontrar lá dentro',
      items: [
        'Como fazer o **diagnóstico** do seu dinheiro em uma tarde, sem planilha complicada',
        '**Orçamentos** que cabem na vida real (50/30/20, base zero, envelopes)',
        'Um método para **sair do vermelho**: avalanche, bola de neve e como renegociar',
        'A **reserva de emergência**, degrau por degrau',
        'Selic, inflação e dólar explicados sem dor de cabeça, e o poder dos **juros compostos**',
        'Primeiros passos para **investir** com segurança, metas, renda extra e proteção contra golpes',
        'O caminho até a **liberdade financeira** e um **plano de 90 dias** para começar hoje',
      ],
    },
    button: { label: 'Abrir o meu Prumo', url: `${ctx.config.publicUrl}/conta` },
    closing: [
      'Uma dica de quem já viu muita gente começar: leia **um capítulo por semana** e faça o exercício da caixa azul. Enquanto isso, o Prumo mostra o seu próximo passo todos os dias na aba Coach.',
      ...(referral ? [`Gostou do Fôlego? **Indique um amigo**: a cada indicação que assinar um plano, você ganha **${ctx.config.referralDiscountPct}% de desconto** na próxima fatura. Seu link está na aba "Indique e ganhe".`] : []),
      'Com carinho,\n**Equipe Fôlego**',
    ],
  });
}

/** Worker: presenteia quem assinou Ousado ou Desbravador e ainda não recebeu. Uma vez por pessoa. */
export async function sendEbookGifts(ctx: Ctx, opts: { log?: (e: Record<string, unknown>) => void } = {}): Promise<number> {
  if (!ctx.config.subscriptionsEnabled || !ctx.email) return 0;
  const book = await activeEbook(ctx);
  if (!book) return 0;
  const who = await ctx.db.query<{ id: string; email: string; display_name: string | null; plan: string }>(
    `SELECT b.id, b.email::text AS email, b.display_name, s.plan FROM app.subscribers b
       JOIN app.subscriptions s ON s.subscriber_id = b.id AND s.status = 'active' AND s.current_period_end > now()
      WHERE b.deleted_at IS NULL AND b.ebook_sent_at IS NULL AND s.plan = ANY($1::text[]) LIMIT 20`,
    [GIFT_PLANS],
  );
  let sent = 0;
  for (const b of who.rows) {
    const planName = b.plan === 'desbravador' ? 'Desbravador' : 'Ousado';
    const mail = giftMail(ctx, firstName(b.display_name, b.email), planName);
    try {
      await ctx.email.send({ to: b.email, subject: 'Seu presente de boas-vindas ao Prumo: o eBook do Fôlego', ...mail, attachments: [{ filename: book.filename, content: book.content, contentType: 'application/pdf' }] });
      await ctx.db.query(`UPDATE app.subscribers SET ebook_sent_at = now(), ebook_id = $2 WHERE id = $1`, [b.id, book.id]);
      await ctx.db.query(`UPDATE app.ebooks SET sent_count = sent_count + 1 WHERE id = $1`, [book.id]);
      await audit(ctx.db, 'system', 'ebook_gift_sent', 'subscriber', b.id, { ebook: book.id, plan: b.plan });
      sent += 1;
    } catch {
      opts.log?.({ evento: 'ebook_presente_falhou' });
    }
  }
  return sent;
}

/** Envio de teste (backoffice): manda o e-mail de presente para o endereço de quem pediu. */
export async function sendEbookTest(ctx: Ctx, id: string, to: string, by: string): Promise<void> {
  if (!ctx.email) throw new AppError(503, 'email_unavailable', 'O envio de e-mail não está configurado no servidor.');
  const file = await ebookFile(ctx, id);
  const mail = giftMail(ctx, 'Teste', 'Ousado');
  await ctx.email.send({ to, subject: '[TESTE] Seu presente de boas-vindas ao Prumo: o eBook do Fôlego', ...mail, attachments: [{ filename: file.filename, content: file.content, contentType: 'application/pdf' }] });
  await audit(ctx.db, `admin:${by}`, 'ebook_test_sent', 'ebook', id);
}
