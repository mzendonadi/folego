// Categorias próprias do assinante (além das 10 do sistema): "Cartão de crédito", "Parcela de financiamento"...
// O lançamento guarda o NOME da categoria (texto livre no banco); as do sistema continuam sendo códigos fixos.
import { CATEGORIES, CATEGORY_LABEL } from './engine.ts';
import { AppError } from './errors.ts';
import type { Queryable } from './db.ts';

export const MAX_CUSTOM_CATEGORIES = 20;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const RESERVED = new Set<string>([...CATEGORIES, ...Object.values(CATEGORY_LABEL)].map((c) => fold(c)));
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,&/+()'-]{1,29}$/u;

export async function customCategories(db: Queryable, subscriberId: string): Promise<string[]> {
  const r = await db.query<{ name: string }>(`SELECT name FROM app.custom_categories WHERE subscriber_id = $1 ORDER BY lower(name)`, [subscriberId]);
  return r.rows.map((x) => x.name);
}

/** A categoria vale para esta pessoa? (uma do sistema ou uma que ela criou) */
export async function isAllowedCategory(db: Queryable, subscriberId: string, category: string): Promise<boolean> {
  if ((CATEGORIES as readonly string[]).includes(category)) return true;
  const r = await db.query(`SELECT 1 FROM app.custom_categories WHERE subscriber_id = $1 AND name = $2`, [subscriberId, category]);
  return r.rows.length > 0;
}

/** Cria (ou devolve, se já existe com o mesmo nome) uma categoria própria. */
export async function createCustomCategory(db: Queryable, subscriberId: string, rawName: string): Promise<string> {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!NAME.test(name)) throw new AppError(422, 'invalid_category_name', 'Use de 2 a 30 caracteres: letras, números e espaços.');
  if (RESERVED.has(fold(name))) throw new AppError(422, 'category_exists', 'Essa categoria já existe na lista padrão. Escolha-a no seletor.');
  const same = await db.query<{ name: string }>(`SELECT name FROM app.custom_categories WHERE subscriber_id = $1 AND lower(name) = lower($2)`, [subscriberId, name]);
  if (same.rows[0]) return same.rows[0].name;
  const count = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.custom_categories WHERE subscriber_id = $1`, [subscriberId]);
  if (Number(count.rows[0]?.n ?? 0) >= MAX_CUSTOM_CATEGORIES) throw new AppError(422, 'too_many_categories', `Você já tem ${MAX_CUSTOM_CATEGORIES} categorias próprias. Apague alguma para criar outra.`);
  await db.query(`INSERT INTO app.custom_categories(subscriber_id, name) VALUES ($1, $2)`, [subscriberId, name]);
  return name;
}

/** Apaga a categoria própria: os lançamentos dela vão para "Outros" e os limites dela saem. Devolve quantos lançamentos mudaram. */
export async function deleteCustomCategory(db: Queryable, subscriberId: string, name: string): Promise<number> {
  const exists = await db.query(`SELECT 1 FROM app.custom_categories WHERE subscriber_id = $1 AND name = $2`, [subscriberId, name]);
  if (exists.rows.length === 0) throw new AppError(404, 'not_found', 'Categoria não encontrada.');
  const moved = await db.query(`UPDATE app.ledger_entries SET category = 'outros' WHERE subscriber_id = $1 AND category = $2`, [subscriberId, name]);
  await db.query(`DELETE FROM app.budget_limits WHERE subscriber_id = $1 AND category = $2`, [subscriberId, name]);
  await db.query(`DELETE FROM app.budget_months WHERE subscriber_id = $1 AND category = $2`, [subscriberId, name]);
  await db.query(`DELETE FROM app.custom_categories WHERE subscriber_id = $1 AND name = $2`, [subscriberId, name]);
  return moved.rowCount ?? 0;
}
