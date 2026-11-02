// Assistente do Prumo no WhatsApp (número do Fôlego, pela Bird). O assinante vincula o aparelho mandando "VINCULAR <código>" e depois
// escreve como fala: "mercado 45", "recebi 1.200 de salário ontem". Responde na hora com o recibo; DESFAZER apaga o último lançamento.
// Também entende foto de cupom/nota, áudio e o PDF da fatura do cartão (assistant-media.ts). Nada disso entra na caixa de entrada do atendimento.
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
import { createBizEntry, businessOverview } from './business.ts';
import { finishInvoice, finishReceipt, getPending, handleDocument, handleImage, hearAudio, mediaOf, setPending } from './assistant-media.ts';
import type { MediaEnv, MediaRef } from './assistant-media.ts';

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
  /** O que o assistente já sabe fazer neste servidor: foto de cupom e PDF de fatura (IA de leitura) e áudio (transcrição). */
  abilities: { photo: boolean; invoice: boolean; voice: boolean };
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
    abilities: { photo: Boolean(ctx.config.anthropicApiKey), invoice: Boolean(ctx.config.anthropicApiKey), voice: Boolean(ctx.config.openaiApiKey) },
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
  '• Por voz: mande um áudio falando o lançamento ("mercado quarenta e cinco")',
  '• Foto de cupom ou nota: mande a foto e diga a categoria ("despesas mercado")',
  '• Fatura do cartão: mande o PDF e diga "lançar fatura em anexo em cartão de crédito"',
  '• Consultar: SALDO, CONTAS (o que vence nos próximos dias), METAS',
  '• Empresa (planos Ousado e Desbravador): comece com "empresa:" ("empresa: fornecedor 850"; vale também para foto, áudio e PDF) ou escreva MODO EMPRESA para tudo ir para a empresa. MODO PESSOAL volta ao normal. Os dois ficam sempre separados.',
  '• Errou? Responda DESFAZER logo depois.',
  '• Para desconectar este WhatsApp: SAIR',
].join('\n');

async function firstTime(ctx: Ctx, messageId: string | null): Promise<boolean> {
  if (!messageId) return true;
  await ctx.db.query(`DELETE FROM app.assistant_seen WHERE seen_at < now() - interval '7 days'`).catch(() => undefined);
  const r = await ctx.db.query(`INSERT INTO app.assistant_seen(message_id) VALUES ($1) ON CONFLICT DO NOTHING`, [messageId]);
  return (r.rowCount ?? 0) > 0;
}

type Link = { subscriber_id: string; last_entry_id: string | null; last_entry_at: Date | null; scope: string };

/** "empresa: ...", "pj ..." ou "pessoal: ...", "pf ...": diz, só para esta mensagem, de que lado o lançamento é. Sem os dois-pontos, "empresa de luz 80" continua sendo um gasto. */
function stripScope(s: string): { scope: 'pf' | 'pj' | null; text: string } {
  const m = /^\s*(?:(empresa|pessoal)\s*[:\-–]|(pj|pf)\s*[:\-–]?\s)\s*/i.exec(s);
  if (!m) return { scope: null, text: s };
  const w = (m[1] ?? m[2] ?? '').toLowerCase();
  return { scope: w === 'empresa' || w === 'pj' ? 'pj' : 'pf', text: s.slice(m[0].length) };
}

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
  const media = mediaOf(data);
  const key = phoneKey(ctx, digits);
  const link = (await ctx.db.query<Link>(`SELECT subscriber_id, last_entry_id, last_entry_at, scope FROM app.assistant_links WHERE phone_hmac = $1`, [key])).rows[0];

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
    await converse(ctx, digits, link, text, media);
  } catch (e) {
    const msg = e instanceof AppError && e.status === 402 ? 'Sua assinatura do Prumo não está ativa. Renove em folego.online/conta para voltar a usar o assistente.' : e instanceof AppError && e.status === 403 ? e.message : 'Não consegui agora. Tente de novo em instantes.';
    await reply(ctx, digits, msg);
  }
  return true;
}

/** Grava o lançamento e responde com o recibo (texto digitado, falado ou lido de uma foto passam por aqui). */
async function saveEntry(ctx: Ctx, digits: string, person: string, account: string, entry: { date: string; amountCents: number; note: string; category: string }, today: string): Promise<void> {
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

/** Lançamento da EMPRESA (tabelas biz_*, nunca o livro pessoal). Com uma só conta da empresa, o lançamento já cai nela. */
async function saveBizEntry(ctx: Ctx, digits: string, account: string, entry: { date: string; amountCents: number; note: string }): Promise<void> {
  const wallets = (await ctx.db.query<{ id: string }>(`SELECT id FROM app.biz_wallets WHERE subscriber_id = $1 ORDER BY created_at`, [account])).rows;
  await createBizEntry(ctx, account, { date: entry.date, amountCents: entry.amountCents, note: entry.note, walletId: wallets.length === 1 ? wallets[0]!.id : null }, 'whatsapp');
  const spend = entry.amountCents < 0;
  const ov = await businessOverview(ctx, account, entry.date.slice(0, 7));
  const when = entry.date === todaySaoPaulo() ? 'hoje' : new Date(`${entry.date}T12:00:00`).toLocaleDateString('pt-BR');
  await reply(ctx, digits, [
    `Lancei na EMPRESA: ${spend ? '' : 'entrada de '}${formatBrl(Math.abs(entry.amountCents))} (${when}).`,
    `Em ${monthName(entry.date)} a empresa ${spend ? 'já gastou' : 'já recebeu'} ${formatBrl(spend ? ov.month.spendCents : ov.month.incomeCents)}.`,
    'Errou? Responda DESFAZER.',
  ].join('\n'));
}

async function converse(ctx: Ctx, digits: string, link: Link, rawIn: string, mediaIn: MediaRef | null): Promise<void> {
  const person = link.subscriber_id;
  const account = await effectiveAccountId(ctx, person);
  const today = todaySaoPaulo();
  const month = today.slice(0, 7);
  // De que lado a mensagem vai: "empresa:"/"pj" ou "pessoal:"/"pf" no começo (vale só para ela); senão o lado do que ficou esperando resposta; senão o modo do vínculo (pessoal por padrão).
  const tagged = stripScope(rawIn);
  const rawText = tagged.text;
  const capTag = mediaIn ? stripScope(mediaIn.caption) : null;
  const media = mediaIn && capTag ? { ...mediaIn, caption: capTag.text } : mediaIn;
  const pending = await getPending(ctx, person);
  // O lado do que ficou esperando só vale para a resposta ("lançar", "despesas mercado"); um lançamento novo com valor segue o modo do vínculo.
  let scope: 'pf' | 'pj' = tagged.scope ?? capTag?.scope ?? (pending && !/\d/.test(rawText) ? pending.scope : undefined) ?? (link.scope === 'pj' ? 'pj' : 'pf');
  let text = rawText;

  const env: MediaEnv = {
    ctx, person, account, scope,
    say: (m) => reply(ctx, digits, m),
    record: (entry) => (scope === 'pj' ? saveBizEntry(ctx, digits, account, entry) : saveEntry(ctx, digits, person, account, entry, today)),
    canWrite: async () => (await memberAccess(ctx, person)) !== 'consulta',
  };

  // Modo do vínculo: "modo empresa" / "modo pessoal" (ou só "empresa" / "pessoal").
  const mode = /^(?:modo\s+)?(empresa|pj|pessoal|pf)$/.exec(fold(rawText));
  if (!media && mode) {
    const to = mode[1] === 'empresa' || mode[1] === 'pj' ? 'pj' : 'pf';
    if (to === 'pj') await requireFeature(ctx, account, 'business');
    await ctx.db.query(`UPDATE app.assistant_links SET scope = $2 WHERE subscriber_id = $1`, [person, to]);
    return reply(ctx, digits, to === 'pj' ? 'Pronto: a partir de agora o que você mandar vai para a EMPRESA. Para um lançamento pessoal avulso, comece com "pessoal:". MODO PESSOAL volta ao normal.' : 'Pronto: voltei para o modo PESSOAL. Para um lançamento avulso da empresa, comece com "empresa:".');
  }
  if (scope === 'pj') await requireFeature(ctx, account, 'business');

  if (media) {
    if (media.kind === 'video' || media.kind === 'sticker') return reply(ctx, digits, 'Por aqui eu entendo texto, áudio, foto de cupom e o PDF da fatura do cartão. Digite AJUDA para ver como.');
    await requireFeature(ctx, account, scope === 'pj' ? 'business' : 'ledger');
    if (media.kind === 'image' || media.kind === 'document') {
      if (!(await env.canWrite())) return reply(ctx, digits, 'Seu acesso a esta conta é só de consulta: quem lança é o titular.');
      return media.kind === 'image' ? handleImage(env, media, media.caption || rawText) : handleDocument(env, media, media.caption || rawText);
    }
    // áudio: vira texto e segue como se tivesse sido digitado
    const heard = await hearAudio(env, media);
    if (heard === null) return;
    const spoken = stripScope(heard);
    text = spoken.text;
    if (spoken.scope) {
      scope = spoken.scope;
      env.scope = scope;
      if (scope === 'pj') await requireFeature(ctx, account, 'business');
    }
  }
  const t = fold(text);

  if (pending && /^(cancelar|cancela|nao|descartar|deixa|esquece|deixa pra la)$/.test(t)) {
    await setPending(ctx, person, null);
    return reply(ctx, digits, 'Tudo bem, descartei.');
  }
  if (/^(ajuda|menu|help|oi|ola|bom dia|boa tarde|boa noite|\?)$/.test(t)) return reply(ctx, digits, HELP);
  if (/^(sair|parar|desvincular|desconectar|cancelar)$/.test(t)) {
    await unlink(ctx, person);
    return reply(ctx, digits, 'Tudo certo: este WhatsApp foi desconectado do Prumo. Para conectar de novo, gere um código no app.');
  }

  if (scope === 'pj' && /^(saldo|resumo|gastos|quanto gastei|mes|extrato)$/.test(t)) {
    const ov = await businessOverview(ctx, account, month);
    const top = ov.month.byCategory.filter((c) => c.spendCents > 0).slice(0, 3).map((c) => `${c.label} ${formatBrl(c.spendCents)}`);
    return reply(ctx, digits, [
      `EMPRESA em ${monthName(today)}: entrou ${formatBrl(ov.month.incomeCents)}, saiu ${formatBrl(ov.month.spendCents)}, resultado ${formatBrl(ov.month.resultCents)}.`,
      ov.wallets.length ? `Saldo nas contas da empresa: ${formatBrl(ov.totals.balanceCents)}.` : '',
      top.length ? `Maiores gastos: ${top.join('; ')}.` : 'Ainda não há lançamentos da empresa neste mês.',
      ov.debts.count > 0 ? `Dívidas da empresa: ${formatBrl(ov.debts.owedCents)}.` : '',
      ...ov.alerts.map((a) => `Atenção: ${a.title}.`),
    ].filter(Boolean).join('\n'));
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

  if (scope === 'pj' && /^desfazer$/.test(t)) {
    if ((await memberAccess(ctx, person)) === 'consulta') return reply(ctx, digits, 'Seu acesso a esta conta é só de consulta.');
    const d = await ctx.db.query(
      `DELETE FROM app.biz_entries WHERE id = (SELECT id FROM app.biz_entries WHERE subscriber_id = $1 AND source = 'whatsapp' AND created_at > now() - make_interval(mins => $2) ORDER BY created_at DESC LIMIT 1)`,
      [account, UNDO_MINUTES]);
    return reply(ctx, digits, (d.rowCount ?? 0) > 0 ? 'Desfeito: apaguei o último lançamento da empresa.' : 'Não há lançamento recente da empresa para desfazer (só dá até 1 hora depois).');
  }
  if (/^desfazer$/.test(t)) {
    if (!link.last_entry_id || !link.last_entry_at || Date.now() - new Date(link.last_entry_at).getTime() > UNDO_MINUTES * 60_000) return reply(ctx, digits, 'Não há lançamento recente para desfazer (só dá até 1 hora depois).');
    if ((await memberAccess(ctx, person)) === 'consulta') return reply(ctx, digits, 'Seu acesso a esta conta é só de consulta.');
    const d = await ctx.db.query(`DELETE FROM app.ledger_entries WHERE id = $1 AND subscriber_id = $2`, [link.last_entry_id, account]);
    await ctx.db.query(`UPDATE app.assistant_links SET last_entry_id = NULL, last_entry_at = NULL WHERE subscriber_id = $1`, [person]);
    return reply(ctx, digits, (d.rowCount ?? 0) > 0 ? 'Desfeito: apaguei o último lançamento.' : 'Esse lançamento já tinha sido apagado.');
  }

  // Respostas a uma foto ou fatura que acabei de ler.
  if (pending?.kind === 'invoice') {
    if (/^(cadastrar|cadastra|cadastrar cartao|sim cadastrar)$/.test(t)) return finishInvoice(env, pending, 'cadastrar');
    if (/^(lancar|lanca|sim|s|ok|pode|pode lancar|confirmo|isso|isso mesmo)$/.test(t) || /lanc(ar|a).*(fatura|cartao)|(fatura|cartao).*lanc(ar|a)/.test(t)) return finishInvoice(env, pending, 'lancar');
  }
  if (pending?.kind === 'receipt' && !/\d/.test(text)) return finishReceipt(env, pending.receipt, text);

  // Qualquer outra frase: tenta entender como lançamento.
  const entry = parseQuickEntry(text, today);
  if (!entry) return reply(ctx, digits, 'Não achei o valor. Escreva junto o quanto foi, por exemplo: "mercado 45". Digite AJUDA para ver o que eu entendo.');
  if (!(await env.canWrite())) return reply(ctx, digits, 'Seu acesso a esta conta é só de consulta: quem lança é o titular.');
  if (pending) await setPending(ctx, person, null); // lançamento novo substitui o que estava esperando
  if (scope === 'pj') return saveBizEntry(ctx, digits, account, entry);
  await saveEntry(ctx, digits, person, account, entry, today);
}
