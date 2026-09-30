import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token aleatório de 256 bits, em base64url. Vai para o cliente; no banco só fica o hash. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

export const hmac = (secret: string, value: string): Buffer => createHmac('sha256', secret).update(value).digest();

/** Comparação em tempo constante, segura para strings de tamanhos diferentes. */
export function safeEqual(a: string, b: string): boolean {
  const ha = sha256(a);
  const hb = sha256(b);
  return timingSafeEqual(ha, hb);
}

// ---------------------------------------------------------------------------
// Dados de contato dos leads: AES-256-GCM (chave derivada do APP_SECRET). Formato: iv(12) | tag(16) | texto cifrado.
// ---------------------------------------------------------------------------
import { createCipheriv, createDecipheriv, hkdfSync, scryptSync } from 'node:crypto';

const dataKey = (secret: string): Buffer => Buffer.from(hkdfSync('sha256', secret, 'folego', 'lead-contacts-v1', 32));

export function encryptText(secret: string, plain: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptText(secret: string, data: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', dataKey(secret), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

// Senha de usuário de parceiro: scrypt com sal por usuário.
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(password, salt, 32).toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Token assinado sem estado (portal do parceiro): base64url(json).base64url(hmac)
export function signToken(secret: string, payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  return `${body}.${hmac(secret, `token:${body}`).toString('base64url')}`;
}

export function verifyToken(secret: string, token: string): Record<string, unknown> | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!safeEqual(hmac(secret, `token:${body}`).toString('base64url'), sig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    return typeof payload.exp === 'number' && payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}
