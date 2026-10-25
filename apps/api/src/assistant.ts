// Assistente do Prumo no WhatsApp (número do Fôlego, pela Bird). O assinante vincula o aparelho mandando "VINCULAR <código>" e depois
// escreve como fala: "mercado 45", "recebi 1.200 de salário ontem". Responde na hora com o recibo; DESFAZER apaga o último lançamento.
// Só texto por enquanto (foto e áudio por WhatsApp pedem leitura no servidor, que não existe ainda). Nada disso entra na caixa de entrada do atendimento.
import { randomBytes } from 'node:crypto';
import { AppError } from './errors.ts';
import { decryptText, encryptText, hmac } from './crypto.ts';
import type { Ctx } from './services.ts';
import { num, todaySaoPaulo } from './services.ts';
import { CATEGORY_LABEL, formatBrl, parseQuickEntry } from './engine.ts';
import { effectiveAccountId, memberAccess } from './household.ts';
import { addEntries, monthView, requireFeature } from './subscriptions.ts';
import { credOf, loadAccount, transportOf, waPhone } from './whatsapp.ts';
import { ensureHouseAccount, HOUSE_PARTNER_ID } from './wa-bird.ts';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I para não confundir ao digitar
const CODE_MINUTES = 30;
const UNDO_MINUTES = 60;
const label = (c: string): string => (CATEGORY_LABEL as Record<string, string>)[c] ?? c;
const fold = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const phoneKey = (ctx: Ctx, digits: string): string => hmac(ctx.config.secret, `assistant-phone:${digits}`).toString('hex');
const maskPhone = (digits: string): string => (digits.length >= 4 ? `•••••${digits.slice(-4)}` : '••••');
const monthName = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' });

// Limite simples contra abuso: no máximo 30 mensagens em 10 minutos por número (em memória; reinicia com o servidor).
const recent = new Map<string, number[]>();
function tooMany(key: string): boolean {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < 600_000);
  list.push(now);
  recent.set(key, list);
  return list.length > 30;
}

async function reply(ctx: Ctx, digits: string, text: string): Promise<void> {
  const acc = (await loadAccount(ctx, HOUSE_PARTNER_ID)) ?? (await ensureHouseAccount(ctx));
  if (!acc) return;
  await transportOf(ctx, 'bird').sendText(credOf(acc), digits, text).catch(() => undefined); // fora da janela de 24 h ou Bird fora do ar: não há o que fazer
}

// ---------------------------------------------------------------------------
// Vínculo (tela do Prumo)
// ---------------------------------------------------------------------------
export interface AssistantView {
  available: boolean;
  number: string | null;
  linked: boolean;
  phone: string | null;
  pending: { code: string; link: string; expiresAt: string } | null;
}

export async function assistantView(ctx: Ctx, personId: string): Promise<AssistantView> {
  const bird = ctx.config.bird;
  const r = await ctx.db.query<{ code: string | null; code_expires_at: Date | null; phone_enc: Buffer | null }>(`SELECT code, code_expires_at, phone_enc FROM app.assistant_links WHERE subscriber_id = $1`, [personId]);
  const row = r.rows[0];
  const digits = bird ? waPhone(bird.from) : null;
  const pending = row?.code && row.code_expires_at && new Date(row.code_expires_at).getTime() > Date.now() && digits
    ? { code: row.code, link: `https://wa.me/${digits}?text=${encodeURIComponent(`VINCULAR ${row.code}`)}`, expiresAt: new Date(row.code_expires_at).toISOString() }
    : null;
  return {
    available: Boolean(bird), number: bird ? bird.from : null, linked: Boolean(row?.phone_enc),
    phone: row?.phone_enc ? maskPhone(decryptText(ctx.config.secret, row.phone_enc).replace(/\D/g, '')) : null, pending,
  };
}

export async function startLink(ctx: Ctx, personId: string): Promise<AssistantView> {
  if (!ctx.config.bird) throw new AppError(409, 'assistant_off', 'O assistente no WhatsApp ainda não está disponível.');
  await requireFeature(ctx, await effectiveAccountId(ctx, personId), 'ledger');
  const code = Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  await ctx.db.query(
    `INSERT INTO app.assistant_links(subscriber_id, code, code_expires_at) VALUES ($1,$2, now() + make_interval(mins => $3))
     ON CONFLICT (subscriber_id) DO UPDATE SET code = EXCLUDED.code, code_expires_at = EXCLUDED.code_expires_at`,
    [personId, code, CODE_MINUTES],
  );
  return assistantView(ctx, personId);
}

export async function unlink(ctx: Ctx, personId: string): Promise<void> {
  await ctx.db.query(`DELETE FROM app.assistant_links WHERE subscriber_id = $1`, [personId]);
}

// ---------------------------------------------------------------------------
// Mensagens que chegam
// ---------------------------------------------------------------------------
const HELP = [
  'Como falar comigo:',
  '• Lançar gasto: "mercado 45", "uber 18,90 ontem", "farmácia 62 dia 10"',
  '• Lançar entrada: "recebi 1.200 de salário"',
  '• Consultar: SALDO, CONTAS (o que vence nos próximos dias), METAS',
  '• Errou? Responda DESFAZER logo depois.',
  '• Para desconectar este WhatsApp: SAIR',
].join('\n');

async function firstTime(ctx: Ctx, messageId: string | null): Promise<boolean> {
  if (!messageId) return true;
  await ctx.db.query(`DELETE FROM app.assistant_seen WHERE seen_at < now() - interval '7 days'`).catch(() => undefined);
  const r = await ctx.db.query(`INSERT INTO app.assistant_seen(message_id) VALUES ($1) ON CONFLICT DO NOTHING`, [messageId]);
  return (r.rowCount ?? 0) > 0;
}

type Link = { subscriber_id: string; last_entry_id: string | null; last_entry_at: Date | null };

/**
 * Chamado para toda mensagem recebida no número do Fôlego. Devolve true se era do assistente (vínculo ou número já vinculado);
 * nesse caso a mensagem NÃO vai para a caixa de entrada. Qualquer outro número segue o caminho normal.
 */
export async function handleAssistantInbound(ctx: Ctx, data: Record<string, unknown>): Promise<boolean> {
  if (!ctx.config.bird) return false;
  const from = (data.from as { phone_number?: unknown } | undefined)?.phone_number;
  const digits = waPhone(typeof from === 'string' ? from : '');
  if (!digits) return false;
  const id = typeof data.id === 'string' && data.id ? data.id : null;
  const text = String((data.text as { body?: unknown } | undefined)?.body ?? '').trim();
  const isMedia = ['image', 'audio', 'video', 'document', 'sticker'].some((k) => data[k] !== undefined);
  const key = phoneKey(ctx, digits);
  const link = (await ctx.db.query<Link>(`SELECT subscriber_id, last_entry_id, last_entry_at FROM app.assistant_links WHERE phone_hmac = $1`, [key])).rows[0];

  if (!link) {
    const m = /^\s*vincular\s+([a-z0-9]{6})\s*$/i.exec(text);
    if (!m) return false; // número desconhecido: atendimento normal
    if (!(await firstTime(ctx, id))) return true;
    try {
      const r = await ctx.db.query(
        `UPDATE app.assistant_links SET phone_hmac = $2, phone_enc = $3, linked_at = now(), code = NULL, code_expires_at = NULL WHERE code = $1 AND code_expires_at > now()`,
        [m[1]!.toUpperCase(), key, encryptText(ctx.config.secret, `+${digits}`)],
      );
      if ((r.rowCount ?? 0) === 0) await reply(ctx, digits, 'Esse código não vale mais (ou já foi usado). Gere um novo em Prumo > Perfil > Assistente no WhatsApp.');
      else await reply(ctx, digits, `Pronto! Seu WhatsApp está conectado ao Prumo.\n\n${HELP}`);
    } catch {
      await reply(ctx, digits, 'Este número já está conectado a outra conta do Prumo. Peça para a outra conta desconectar primeiro.');
    }
    return true;
  }

  if (!(await firstTime(ctx, id))) return true;
  if (tooMany(key)) return true;
  try {
    await converse(ctx, digits, link, text, isMedia);
  } catch (e) {
    const msg = e instanceof AppError && e.status === 402 ? 'Sua assinatura do Prumo não está ativa. Renove em folego.online/conta para voltar a usar o assistente.' : e instanceof AppError && e.status === 403 ? e.message : 'Não consegui agora. Tente de novo em instantes.';
    await reply(ctx, digits, msg);
  }
  return true;
}

async function converse(ctx: Ctx, digits: string, link: Link, text: string, isMedia: boolean): Promise<void> {
  const person = link.subscriber_id;
  const account = await effectiveAccountId(ctx, person);
  const t = fold(text);
  const today = todaySaoPaulo();
  const month = today.slice(0, 7);

  if (isMedia && !text) return reply(ctx, digits, 'Por enquanto eu só entendo texto por aqui. Escreva assim: "mercado 45".');
  if (/^(ajuda|menu|help|oi|ola|bom dia|boa tarde|boa noite|\?)$/.test(t)) return reply(ctx, digits, HELP);
  if (/^(sair|parar|desvincular|desconectar|cancelar)$/.test(t)) {
    await unlink(ctx, person);
    return reply(ctx, digits, 'Tudo certo: este WhatsApp foi desconectado do Prumo. Para conectar de novo, gere um código no app.');
  }

  if (/^(saldo|resumo|gastos|quanto gastei|mes|extrato)$/.test(t)) {
    await requireFeature(ctx, account, 'ledger');
    const s = (await monthView(ctx, account, month)).summary;
    const top = s.byCategory.filter((c) => c.cents > 0).slice(0, 3).map((c) => `${label(c.category)} ${formatBrl(c.cents)}`);
    const over = s.byCategory.filter((c) => c.over).map((c) => label(c.category));
    return reply(ctx, digits, [`Em ${monthName(today)}: entrou ${formatBrl(s.incomeCents)}, saiu ${formatBrl(s.spendCents)}, saldo ${formatBrl(s.balanceCents)}.`, top.length ? `Maiores gastos: ${top.join('; ')}.` : 'Ainda não há gastos lançados neste mês.', over.length ? `Atenção: passou do limite em ${over.join(', ')}.` : ''].filter(Boolean).join('\n'));
  }

  if (/^(contas|vencimentos|lembretes|vence)$/.test(t)) {
    const r = await ctx.db.query<{ title: string; due_on: Date | string; amount_cents: string | null }>(
      `SELECT title, due_on, amount_cents FROM app.reminders WHERE subscriber_id = $1 AND done_at IS NULL AND due_on BETWEEN $2::date AND ($2::date + 7) ORDER BY due_on LIMIT 6`, [account, today],
    );
    if (r.rows.length === 0) return reply(ctx, digits, 'Nenhuma conta vence nos próximos 7 dias.');
    const day = (d: Date | string) => { const s = new Date(d as string).toISOString(); return `${s.slice(8, 10)}/${s.slice(5, 7)}`; };
    return reply(ctx, digits, ['Vencem nos próximos 7 dias:', ...r.rows.map((x) => `• ${day(x.due_on)}: ${x.title}${x.amount_cents ? ` (${formatBrl(num(x.amount_cents))})` : ''}`)].join('\n'));
  }

  if (/^metas?$/.test(t)) {
    const g = await ctx.db.query<{ name: string; target_cents: string; saved_cents: string }>(`SELECT name, target_cents, saved_cents FROM app.goals WHERE subscriber_id = $1 AND saved_cents < target_cents ORDER BY (due_on IS NULL), due_on, created_at LIMIT 5`, [account]);
    if (g.rows.length === 0) return reply(ctx, digits, 'Você ainda não tem metas em andamento. Crie uma na aba Metas do Prumo.');
    return reply(ctx, digits, ['Suas metas:', ...g.rows.map((x) => `• ${x.name}: ${Math.floor((num(x.saved_cents) / num(x.target_cents)) * 100)}% (${formatBrl(num(x.saved_cents))} de ${formatBrl(num(x.target_cents))})`)].join('\n'));
  }

  if (/^desfazer$/.test(t)) {
    if (!link.last_entry_id || !link.last_entry_at || Date.now() - new Date(link.last_entry_at).getTime() > UNDO_MINUTES * 60_000) return reply(ctx, digits, 'Não há lançamento recente para desfazer (só dá até 1 hora depois).');
    if ((await memberAccess(ctx, person)) === 'consulta') return reply(ctx, digits, 'Seu acesso a esta conta é só de consulta.');
    const d = await ctx.db.query(`DELETE FROM app.ledger_entries WHERE id = $1 AND subscriber_id = $2`, [link.last_entry_id, account]);
    await ctx.db.query(`UPDATE app.assistant_links SET last_entry_id = NULL, last_entry_at = NULL WHERE subscriber_id = $1`, [person]);
    return reply(ctx, digits, (d.rowCount ?? 0) > 0 ? 'Desfeito: apaguei o último lançamento.' : 'Esse lançamento já tinha sido apagado.');
  }

  // Qualquer outra frase: tenta entender como lançamento.
  const entry = parseQuickEntry(text, today);
  if (!entry) return reply(ctx, digits, 'Não achei o valor. Escreva junto o quanto foi, por exemplo: "mercado 45". Digite AJUDA para ver o que eu entendo.');
  if ((await memberAccess(ctx, person)) === 'consulta') return reply(ctx, digits, 'Seu acesso a esta conta é só de consulta: quem lança é o titular.');
  const saved = await addEntries(ctx, account, [{ date: entry.date, amountCents: entry.amountCents, note: entry.note, category: entry.category, source: 'manual' }]);
  if (saved.ids[0]) await ctx.db.query(`UPDATE app.assistant_links SET last_entry_id = $2, last_entry_at = now() WHERE subscriber_id = $1`, [person, saved.ids[0]]);
  const spend = entry.amountCents < 0;
  const v = await monthView(ctx, account, entry.date.slice(0, 7));
  const total = spend ? v.summary.spendCents : v.summary.incomeCents;
  const cat = v.summary.byCategory.find((c) => c.category === entry.category);
  const when = entry.date === today ? 'hoje' : new Date(`${entry.date}T12:00:00`).toLocaleDateString('pt-BR');
  await reply(ctx, digits, [
    `Lancei ${spend ? '' : 'entrada de '}${formatBrl(Math.abs(entry.amountCents))}${spend ? ` em ${label(entry.category)}` : ''} (${when}).`,
    `Em ${monthName(entry.date)} ${spend ? 'você já gastou' : 'já entraram'} ${formatBrl(total)}.`,
    spend && cat?.over ? `Atenção: você passou do limite de ${label(entry.category)} neste mês.` : '',
    'Errou? Responda DESFAZER.',
  ].filter(Boolean).join('\n'));
}
