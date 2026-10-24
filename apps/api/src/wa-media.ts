// Arquivos das conversas de WhatsApp (fotos, áudios, documentos, vídeos): validação, guarda criptografada no banco
// e link assinado de curta duração (a Bird só envia mídia por endereço https público; a Meta recebe o arquivo por upload).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptBytes, encryptBytes, hmac, safeEqual } from './crypto.ts';
import { AppError, notFound } from './errors.ts';
import type { Ctx } from './services.ts';

export const MAX_BYTES = 16 * 1024 * 1024;
export type MediaKind = 'image' | 'audio' | 'document' | 'video' | 'sticker';
export const KIND_LABEL: Record<string, string> = { image: 'Foto', audio: 'Áudio', document: 'Documento', video: 'Vídeo', sticker: 'Figurinha', text: '', template: '' };

// O que a API do WhatsApp aceita para ENVIAR. Fora desta lista, o WhatsApp recusa o arquivo.
const IMAGE = new Set(['image/jpeg', 'image/png']);
const AUDIO = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr']);
const VIDEO = new Set(['video/mp4', 'video/3gpp']);
const DOCUMENT = new Set([
  'application/pdf', 'text/plain', 'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const LIMIT: Record<string, number> = { image: 5 * 1024 * 1024, audio: MAX_BYTES, video: MAX_BYTES, document: MAX_BYTES };

/** "audio/ogg; codecs=opus" vira "audio/ogg". */
export const baseMime = (mime: string): string => mime.split(';')[0]!.trim().toLowerCase();

/** Tipo de arquivo que pode ser enviado, ou erro claro para a pessoa. */
export function classifyOutgoing(mime: string): Exclude<MediaKind, 'sticker'> {
  const m = baseMime(mime);
  if (IMAGE.has(m)) return 'image';
  if (AUDIO.has(m)) return 'audio';
  if (VIDEO.has(m)) return 'video';
  if (DOCUMENT.has(m)) return 'document';
  if (m === 'audio/webm') throw new AppError(415, 'audio_format', 'Este navegador gravou o áudio em um formato que o WhatsApp não aceita. Use o Chrome, o Edge, o Safari ou o Firefox atualizados, ou anexe um arquivo de áudio (.mp3, .m4a, .ogg).');
  throw new AppError(415, 'file_type', 'O WhatsApp só aceita fotos JPG ou PNG, áudios (MP3, M4A, OGG, AAC), vídeos MP4 e documentos PDF, Word, Excel, PowerPoint ou TXT.');
}

/** Tipo de um arquivo que CHEGOU: aceitamos o que vier (até o limite), só para mostrar certo. */
export function classifyIncoming(mime: string, hint: string): MediaKind {
  const m = baseMime(mime);
  if (hint === 'sticker') return 'sticker';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'document';
}

const startsWith = (b: Buffer, ...sig: number[]) => sig.every((v, i) => b[i] === v);
/** Confere o começo do arquivo: um .exe renomeado para .jpg não passa. */
function magicOk(mime: string, b: Buffer): boolean {
  const m = baseMime(mime);
  if (m === 'image/jpeg') return startsWith(b, 0xff, 0xd8, 0xff);
  if (m === 'image/png') return startsWith(b, 0x89, 0x50, 0x4e, 0x47);
  if (m === 'application/pdf') return b.subarray(0, 1024).includes('%PDF');
  if (m === 'audio/ogg') return b.subarray(0, 4).toString('latin1') === 'OggS';
  if (m === 'audio/mp4' || m === 'video/mp4') return b.subarray(4, 8).toString('latin1') === 'ftyp';
  return true;
}

const cleanName = (n: string | null | undefined): string | null => {
  const f = (n ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f"<>|*?:]/g, '').trim().slice(0, 120);
  return f || null;
};

/**
 * Gravação de voz do navegador (MP4 fragmentado no Chrome, WebM em outros) vira OGG/Opus mono: o formato nativo das mensagens de voz do WhatsApp.
 * Sem isso a Meta recusa o arquivo (erro 131053, "Media file scrutiny failed"). Usa o ffmpeg do servidor; devolve null se ele não existir ou falhar,
 * e quem chama segue com o arquivo original.
 */
export interface VoiceEncoding { rate: number; bitrate: string; application: 'voip' | 'audio'; bitexact: boolean; cbr: boolean }
export const VOICE_DEFAULT: VoiceEncoding = { rate: 16000, bitrate: '24k', application: 'voip', bitexact: true, cbr: false };

export async function voiceToOgg(bytes: Buffer, enc: VoiceEncoding = VOICE_DEFAULT): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'folego-voz-'));
  const input = join(dir, 'entrada');
  const pcm = join(dir, 'pcm.wav');
  const output = join(dir, 'saida.ogg');
  const ffmpeg = (args: string[]) => new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d: Buffer) => { err += d.toString().slice(0, 300); });
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('ffmpeg demorou demais')); }, 20_000);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`ffmpeg saiu com ${code}: ${err}`)); });
  });
  try {
    await writeFile(input, bytes);
    // Passo 1: a gravação do navegador (MP4 fragmentado, tempos irregulares) vira PCM limpo, com a linha do tempo começando em zero.
    // Passo 2: só então codifica em Opus. Gravação que passou direto do MP4 ao OGG o Android recusava; a que partiu de áudio limpo tocou.
    await ffmpeg(['-i', input, '-vn', '-map_metadata', '-1', '-af', 'aresample=async=1:first_pts=0', '-ac', '1', '-ar', String(enc.rate), '-c:a', 'pcm_s16le', '-f', 'wav', pcm]);
    await ffmpeg(['-i', pcm, '-vn', '-map_metadata', '-1', ...(enc.bitexact ? ['-fflags', '+bitexact', '-flags:a', '+bitexact'] : []), '-ac', '1', '-ar', String(enc.rate), '-c:a', 'libopus', '-b:a', enc.bitrate, '-application', enc.application, ...(enc.cbr ? ['-vbr', 'off', '-frame_duration', '20'] : []), '-f', 'ogg', output]);
    const out = await readFile(output);
    return out.length > 0 && out.subarray(0, 4).toString('latin1') === 'OggS' ? out : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface StoredMedia { id: string; kind: MediaKind; mime: string; filename: string | null; size: number }

/** Guarda o arquivo (criptografado). Saída = validação rigorosa; entrada aceita o que chegou (até o limite). */
export async function storeMedia(ctx: Ctx, partnerId: string, a: { mime: string; filename?: string | null; bytes: Buffer; origin: 'in' | 'out' | 'avatar'; hint?: string }): Promise<StoredMedia> {
  const mime = baseMime(a.mime);
  const kind: MediaKind = a.origin === 'in' ? classifyIncoming(mime, a.hint ?? '') : a.origin === 'avatar' ? 'image' : classifyOutgoing(mime);
  if (a.origin === 'avatar' && !IMAGE.has(mime)) throw new AppError(415, 'file_type', 'A foto precisa ser JPG ou PNG.');
  if (a.bytes.length < 1) throw new AppError(422, 'empty_file', 'O arquivo está vazio.');
  const cap = a.origin === 'out' || a.origin === 'avatar' ? (LIMIT[kind] ?? MAX_BYTES) : MAX_BYTES;
  if (a.bytes.length > cap) throw new AppError(413, 'file_too_big', `Arquivo grande demais: o limite para ${(KIND_LABEL[kind] ?? 'este tipo').toLowerCase()} é ${Math.round(cap / 1024 / 1024)} MB.`);
  if (a.origin !== 'in' && !magicOk(mime, a.bytes)) throw new AppError(415, 'file_corrupt', 'O conteúdo do arquivo não corresponde ao tipo informado.');
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.wa_media(partner_id, mime, filename, size_bytes, sha256, data_enc, origin) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [partnerId, mime, cleanName(a.filename), a.bytes.length, createHash('sha256').update(a.bytes).digest('hex'), encryptBytes(ctx.config.secret, a.bytes), a.origin],
  );
  return { id: r.rows[0]!.id, kind, mime, filename: cleanName(a.filename), size: a.bytes.length };
}

export interface LoadedMedia { id: string; partnerId: string; mime: string; filename: string | null; bytes: Buffer }

export async function loadMedia(ctx: Ctx, id: string, partnerId?: string): Promise<LoadedMedia> {
  const r = await ctx.db.query<{ id: string; partner_id: string; mime: string; filename: string | null; data_enc: Buffer }>(
    `SELECT id, partner_id, mime, filename, data_enc FROM app.wa_media WHERE id = $1 ${partnerId ? 'AND partner_id = $2' : ''}`,
    partnerId ? [id, partnerId] : [id],
  );
  const m = r.rows[0];
  if (!m) throw notFound();
  return { id: m.id, partnerId: m.partner_id, mime: m.mime, filename: m.filename, bytes: decryptBytes(ctx.config.secret, m.data_enc) };
}

// Só estes tipos abrem direto no navegador; o resto (documentos) é sempre baixado, nunca executado.
const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|amr)|video\/(mp4|3gpp))$/;
/** `forProvider`: no link assinado que a Bird/WhatsApp busca, o tipo real precisa ir no cabeçalho (eles recusam octet-stream). */
export function mediaHeaders(m: { mime: string; filename: string | null }, forProvider = false): Record<string, string> {
  const inline = INLINE.test(m.mime);
  const name = encodeURIComponent(m.filename ?? 'arquivo');
  return {
    'content-type': inline || forProvider ? m.mime : 'application/octet-stream',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=3600',
    'content-security-policy': "default-src 'none'; sandbox",
  };
}

// Link público assinado (a Bird baixa por ele e envia ao WhatsApp). Vale 30 minutos e só serve àquele arquivo.
const sign = (ctx: Ctx, id: string, exp: number) => hmac(ctx.config.secret, `wam:${id}:${exp}`).toString('base64url').slice(0, 32);
export function signedMediaUrl(ctx: Ctx, id: string, ttlSeconds = 1800): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${ctx.config.publicUrl}/wa-media/${id}?e=${exp}&s=${sign(ctx, id, exp)}`;
}
export function validMediaSig(ctx: Ctx, id: string, e: string | undefined, s: string | undefined): boolean {
  const exp = Number(e);
  if (!Number.isFinite(exp) || !s || exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(s, sign(ctx, id, exp));
}

/** Texto curto para a lista de conversas e para o agente: "Foto: legenda". */
export const previewOf = (kind: string, text: string): string => (kind === 'text' || kind === 'template' ? text : `${KIND_LABEL[kind] ?? 'Arquivo'}${text ? `: ${text}` : ''}`);
