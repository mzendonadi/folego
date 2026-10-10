// Sino de alertas do backoffice. Os alertas são calculados na hora (nada de fila): cada verificação devolve zero ou um alerta.
// "Visto" é por pessoa: guardamos a impressão (fingerprint) do alerta no momento em que foi visto; se ele piorar, a impressão muda e o sino volta a tocar.
import { deepHealth } from '../health.ts';
import type { Ctx } from '../services.ts';
import { num } from '../services.ts';
import { can } from './auth.ts';
import type { AdminUser } from './auth.ts';
import type { Section } from './permissions.ts';

export type Severity = 'critica' | 'atencao' | 'info';
export interface BoAlert {
  key: string;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
  /** Tela do backoffice onde resolver (id do menu). */
  route: string;
  fingerprint: string;
  seen: boolean;
}
type Draft = Omit<BoAlert, 'seen' | 'fingerprint'> & { fingerprint?: string };

const SAUDE_TITLE: Record<string, [string, Severity]> = {
  banco: ['Banco de dados sem resposta', 'critica'],
  worker: ['Worker parado (entregas em segundo plano)', 'critica'],
  fila: ['Entregas paradas na fila', 'critica'],
  webhooks: ['Pagamentos Pix sem processar', 'critica'],
  ebook: ['E-book de presente não enviado', 'atencao'],
  backup: ['Backup atrasado', 'critica'],
  disco: ['Pouco espaço no disco do servidor', 'critica'],
  custos: ['Perto do limite de IA ou e-mail', 'atencao'],
};

const one = async (ctx: Ctx, sql: string): Promise<number> => {
  try {
    const r = await ctx.db.query<{ n: string }>(sql);
    return num(r.rows[0]?.n ?? 0);
  } catch {
    return 0; // uma tabela que ainda não existe nunca derruba o sino
  }
};

/** Todos os alertas monitorados, do mais grave ao menos grave. Cada pessoa só vê o que as suas permissões alcançam. */
export async function computeAlerts(ctx: Ctx, a: AdminUser): Promise<BoAlert[]> {
  const out: Draft[] = [];
  const allowed = (s: Section) => can(a, s);

  if (allowed('dashboard')) {
    try {
      const h = await deepHealth(ctx);
      for (const [k, c] of Object.entries(h.checks)) {
        if (c.ok) continue;
        const [title, severity] = SAUDE_TITLE[k] ?? [`Sistema: ${k}`, 'atencao' as Severity];
        out.push({ key: `saude:${k}`, severity, title, detail: c.detail, count: 1, route: 'painel' });
      }
    } catch {
      out.push({ key: 'saude:banco', severity: 'critica', title: 'Não consegui verificar a saúde do sistema', detail: 'A checagem falhou.', count: 1, route: 'painel' });
    }
  }

  if (allowed('assinaturas')) {
    const cancel7 = await one(ctx, `SELECT count(*)::text AS n FROM app.subscriptions WHERE status = 'active' AND cancel_at_period_end AND updated_at >= now() - interval '7 days'`);
    if (cancel7) out.push({ key: 'assin:cancelaram', severity: 'atencao', title: cancel7 === 1 ? '1 cliente cancelou a assinatura' : `${cancel7} clientes cancelaram a assinatura`, detail: 'Marcaram "não renovar" nos últimos 7 dias. Vale um contato para entender o motivo.', count: cancel7, route: 'assinaturas' });
    const expired7 = await one(ctx, `SELECT count(*)::text AS n FROM app.subscriptions WHERE status = 'expired' AND updated_at >= now() - interval '7 days'`);
    if (expired7) out.push({ key: 'assin:expiraram', severity: 'atencao', title: expired7 === 1 ? '1 assinatura venceu sem renovar' : `${expired7} assinaturas venceram sem renovar`, detail: 'Venceram nos últimos 7 dias e o acesso foi encerrado.', count: expired7, route: 'assinaturas' });
    const soon = await one(ctx, `SELECT count(*)::text AS n FROM app.subscriptions WHERE status = 'active' AND NOT cancel_at_period_end AND current_period_end BETWEEN now() AND now() + interval '3 days'`);
    if (soon) out.push({ key: 'assin:vencendo', severity: 'info', title: soon === 1 ? '1 assinatura vence em até 3 dias' : `${soon} assinaturas vencem em até 3 dias`, detail: 'Ainda sem renovação confirmada.', count: soon, route: 'assinaturas' });
  }

  if (allowed('parcerias')) {
    const failed = await one(ctx, `SELECT count(*)::text AS n FROM app.lead_deliveries WHERE status = 'failed'`);
    if (failed) out.push({ key: 'parc:entregas', severity: 'critica', title: failed === 1 ? '1 envio a parceiro falhou' : `${failed} envios a parceiros falharam`, detail: 'O sistema tenta de novo sozinho; se persistir, confira o parceiro.', count: failed, route: 'parcerias' });
    const waFail = await one(ctx, `SELECT count(*)::text AS n FROM app.wa_messages WHERE status = 'falhou' AND created_at >= now() - interval '24 hours'`);
    if (waFail) out.push({ key: 'parc:whatsapp', severity: 'atencao', title: waFail === 1 ? '1 mensagem de WhatsApp de parceiro falhou' : `${waFail} mensagens de WhatsApp de parceiros falharam`, detail: 'Nas últimas 24 horas. Veja a conexão do parceiro com a Meta.', count: waFail, route: 'parcerias' });
    const waQueue = await one(ctx, `SELECT count(*)::text AS n FROM app.wa_messages WHERE status = 'fila' AND created_at < now() - interval '30 minutes'`);
    if (waQueue) out.push({ key: 'parc:fila-whatsapp', severity: 'atencao', title: 'Fila de WhatsApp parada', detail: `${waQueue} mensagem(ns) esperando há mais de 30 minutos.`, count: waQueue, route: 'parcerias' });
  }

  if (allowed('chatbot')) {
    const novos = await one(ctx, `SELECT count(*)::text AS n FROM app.chat_leads WHERE status = 'novo'`);
    if (novos) out.push({ key: 'chat:novos', severity: 'info', title: novos === 1 ? '1 pessoa chamou o chatbot e espera contato' : `${novos} pessoas chamaram o chatbot e esperam contato`, detail: 'Retome o contato pelo WhatsApp ou e-mail na tela Chatbot.', count: novos, route: 'chatbot' });
    const velhos = await one(ctx, `SELECT count(*)::text AS n FROM app.chat_leads WHERE status = 'novo' AND created_at < now() - interval '24 hours'`);
    if (velhos) out.push({ key: 'chat:atrasados', severity: 'atencao', title: velhos === 1 ? '1 contato do chatbot sem retorno há mais de 24 h' : `${velhos} contatos do chatbot sem retorno há mais de 24 h`, detail: 'Quanto mais cedo o retorno, maior a chance de venda.', count: velhos, route: 'chatbot' });
  }

  const rank: Record<Severity, number> = { critica: 0, atencao: 1, info: 2 };
  out.sort((x, y) => rank[x.severity] - rank[y.severity]);

  const seen = await ctx.db.query<{ alert_key: string; fingerprint: string }>(`SELECT alert_key, fingerprint FROM app.bo_alert_seen WHERE admin_id = $1`, [a.id]).catch(() => ({ rows: [] as { alert_key: string; fingerprint: string }[] }));
  const seenMap = new Map(seen.rows.map((r) => [r.alert_key, r.fingerprint]));
  const alerts: BoAlert[] = out.map((d) => {
    const fingerprint = d.fingerprint ?? `${d.count}`;
    return { ...d, fingerprint, seen: seenMap.get(d.key) === fingerprint };
  });
  // Alerta que se resolveu deixa de existir: esquece o "visto" para voltar a tocar se acontecer de novo.
  const live = alerts.map((x) => x.key);
  await ctx.db.query(`DELETE FROM app.bo_alert_seen WHERE admin_id = $1 AND NOT (alert_key = ANY($2::text[]))`, [a.id, live]).catch(() => undefined);
  return alerts;
}

/** Marca como vistos os alertas indicados (ou todos os atuais) para esta pessoa. */
export async function markAlertsSeen(ctx: Ctx, a: AdminUser, keys?: string[]): Promise<number> {
  const alerts = (await computeAlerts(ctx, a)).filter((x) => !keys || keys.includes(x.key));
  for (const x of alerts) {
    await ctx.db.query(
      `INSERT INTO app.bo_alert_seen(admin_id, alert_key, fingerprint) VALUES ($1,$2,$3)
       ON CONFLICT (admin_id, alert_key) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, seen_at = now()`,
      [a.id, x.key, x.fingerprint],
    );
  }
  return alerts.length;
}
