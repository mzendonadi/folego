// Marketing e relacionamento: insights calculados a partir dos dados reais (regras explicáveis, sempre com o número que
// as sustenta), públicos para campanhas (com o que a LGPD permite em cada um) e um quadro de planejamento.
import { AppError, notFound } from '../errors.ts';
import type { Ctx } from '../services.ts';
import { audit, num } from '../services.ts';
import type { AdminUser } from './auth.ts';
import { dashboard, partnerships } from './metrics.ts';

const iso = (d: unknown): string | null => (d ? new Date(d as string).toISOString() : null);
const brl = (cents: number) => `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface Insight {
  id: string;
  area: 'aquisicao' | 'conversao' | 'receita' | 'retencao' | 'parcerias' | 'produto' | 'dados';
  priority: 'alta' | 'media' | 'baixa';
  title: string;
  evidence: string;
  actions: string[];
  /** Sugestão de item para o quadro de planejamento (o botão "Planejar" cria com isto). */
  plan?: { title: string; goal: string; segment: string; channel: string };
}

const EMPLOYMENT: Record<string, string> = { clt: 'CLT', public_servant: 'servidores públicos', inss_retiree: 'aposentados/pensionistas do INSS', self_employed: 'autônomos', other: 'outros vínculos' };
const PRODUCT_NAME: Record<string, string> = { recovery_map: 'Mapa da Virada', defense_letters: 'Kit de Cartas', calendar_30d: 'Calendário 30 dias', extra_income_plan: 'Renda Extra', collection_translator: 'Tradutor de Cobrança' };

export async function insights(ctx: Ctx, days: number): Promise<{ days: number; insights: Insight[]; note: string | null }> {
  const d = await dashboard(ctx, days);
  const p = await partnerships(ctx, days);
  const out: Insight[] = [];
  const f = d.funnel;
  const visitors = f.steps[0]!.count;
  const ab = f.abandonment;
  const totalCases = ab.filledNotPaid + ab.paid;

  const note = d.traffic.trackingSince ? null : 'O rastreamento de navegação começou a valer agora: os números de visitas e origens só existem daqui para a frente.';
  if (visitors < 30) {
    out.push({ id: 'dados_poucos', area: 'dados', priority: 'baixa', title: 'Ainda há poucos dados para conclusões firmes', evidence: `Nos últimos ${days} dias foram ${visitors} visitantes e ${totalCases} diagnósticos. Percentuais com amostra pequena oscilam muito.`, actions: ['Use os números como direção, não como verdade.', 'Aumente o período (90 dias ou tudo) para ver tendências.', 'Rode 1–2 semanas de divulgação com links UTM para medir de onde vem cada pessoa.'] });
  }

  if (totalCases >= 5 && ab.filledNotPaid > 0) {
    const rate = ab.conversionPct ?? 0;
    out.push({
      id: 'abandono_preview', area: 'conversao', priority: rate < 10 ? 'alta' : 'media',
      title: `${ab.filledNotPaid} pessoas preencheram o diagnóstico e não pagaram`,
      evidence: `De ${totalCases} diagnósticos, ${ab.paid} pagaram (${rate}%). ${ab.neverOpenedCheckout} nem abriram a tela de pagamento; ${ab.abandonedCheckout} abriram e desistiram.`,
      actions: [
        'Quem nem abre o pagamento não viu valor suficiente no resultado grátis: destaque a economia em reais (a manchete "você deixa de pagar R$ X em juros") logo acima do botão.',
        'Teste um preço menor por uma semana em Produtos e preços e compare a taxa de conversão do período.',
        'Reforce a promessa "só paga se gostar" e mostre o que vem no Mapa (roteiros, orçamento, linha do tempo).',
      ],
      plan: { title: 'Aumentar a conversão do resultado grátis para o pagamento', goal: `Sair de ${rate}% para ${Math.min(100, Math.round(rate + 5))}% de conversão`, segment: 'Quem preenche o diagnóstico', channel: 'Site (tela de resultado)' },
    });
  }
  if (ab.abandonedCheckout >= 3) {
    out.push({
      id: 'abandono_checkout', area: 'conversao', priority: 'media',
      title: `${ab.abandonedCheckout} pessoas geraram o Pix e não pagaram`,
      evidence: `Pedidos não pagos no período: ${Object.entries(d.revenue.unpaidOrders).map(([k, v]) => `${v} ${k}`).join(', ') || 'nenhum'}.`,
      actions: ['O Pix vale 30 minutos: avise na tela quanto tempo falta e deixe claro que dá para gerar de novo.', 'Sugira "copiar código" como caminho principal no celular (é onde a maioria abre o app do banco).', 'Como a compra é anônima, não há como cobrar depois: a recuperação precisa acontecer dentro do site.'],
    });
  }

  // Segmentos: onde converte melhor e onde há volume sem conversão.
  const avg = totalCases > 0 ? (ab.paid / totalCases) * 100 : 0;
  const best = (list: { key: string; cases: number; conversionPct: number | null }[], min: number) => list.filter((s) => s.cases >= min && s.conversionPct !== null).sort((a, b) => (b.conversionPct ?? 0) - (a.conversionPct ?? 0))[0];
  const bestEmp = best(d.profile.byEmployment, 5);
  if (bestEmp && (bestEmp.conversionPct ?? 0) > avg * 1.3) {
    const nm = EMPLOYMENT[bestEmp.key] ?? bestEmp.key;
    out.push({ id: 'segmento_vinculo', area: 'aquisicao', priority: 'media', title: `${nm} convertem mais que a média`, evidence: `${bestEmp.conversionPct}% de conversão em ${bestEmp.cases} diagnósticos (média geral: ${Math.round(avg * 10) / 10}%).`, actions: [`Crie anúncios e conteúdos falando direto com ${nm}.`, 'Peça indicação a quem já pagou nesse perfil.'], plan: { title: `Campanha para ${nm}`, goal: 'Aumentar o volume de diagnósticos desse perfil', segment: nm, channel: 'Anúncios / conteúdo' } });
  }
  const bestUf = best(d.profile.byUf, 5);
  if (bestUf && (bestUf.conversionPct ?? 0) > avg * 1.3) {
    out.push({ id: 'segmento_uf', area: 'aquisicao', priority: 'baixa', title: `${bestUf.key} é a região que mais converte`, evidence: `${bestUf.conversionPct}% de conversão em ${bestUf.cases} diagnósticos.`, actions: ['Segmente anúncios por estado e teste a mensagem regional.', 'Se houver parceiro regional (SEBRAE, escola técnica), comece por este estado.'], plan: { title: `Foco regional em ${bestUf.key}`, goal: 'Concentrar divulgação e parceria onde já converte', segment: bestUf.key, channel: 'Anúncios / parcerias regionais' } });
  }
  const weak = d.profile.byEmployment.find((s) => s.cases >= 10 && (s.conversionPct ?? 0) < avg / 2);
  if (weak) {
    const nm = EMPLOYMENT[weak.key] ?? weak.key;
    out.push({ id: 'segmento_fraco', area: 'conversao', priority: 'media', title: `${nm}: muito volume e pouca conversão`, evidence: `${weak.cases} diagnósticos, ${weak.conversionPct ?? 0}% pagaram (média ${Math.round(avg * 10) / 10}%).`, actions: ['Ajuste o texto do resultado para esse perfil (ex.: aposentados respondem melhor a "sem burocracia").', 'Considere um produto ou preço específico para este público.'] });
  }

  // Origem do tráfego
  const src = d.traffic.sources;
  const attributed = src.filter((s) => s.source !== 'direto');
  if (visitors >= 20 && attributed.length === 0) {
    out.push({ id: 'sem_utm', area: 'dados', priority: 'media', title: 'Ainda não dá para saber de onde vêm as visitas', evidence: 'Todas as visitas aparecem como "direto".', actions: ['Ao divulgar, use links com UTM. Exemplo: folego.online/?utm_source=instagram&utm_medium=bio&utm_campaign=lancamento', 'Um link diferente por canal (Instagram, WhatsApp, Google, parceiros) mostra aqui qual traz pagantes.'] });
  }
  const bestSrc = src.filter((s) => s.visitors >= 20 && s.paid > 0).sort((a, b) => (b.conversionPct ?? 0) - (a.conversionPct ?? 0))[0];
  if (bestSrc) out.push({ id: 'origem_melhor', area: 'aquisicao', priority: 'media', title: `${bestSrc.source} é a origem que melhor converte`, evidence: `${bestSrc.visitors} visitas, ${bestSrc.paid} pagamentos (${bestSrc.conversionPct}%), ${brl(bestSrc.revenueCents)}.`, actions: ['Concentre o esforço neste canal e replique o que funciona nele.'] });
  const wasted = src.find((s) => s.source !== 'direto' && s.visitors >= 30 && s.paid === 0);
  if (wasted) out.push({ id: 'origem_sem_pagante', area: 'aquisicao', priority: 'media', title: `${wasted.source} traz visita, mas nenhum pagamento`, evidence: `${wasted.visitors} visitas e ${wasted.cases} diagnósticos sem pagamento.`, actions: ['Revise a mensagem desse canal (promete algo diferente do produto?).', 'Se for pago, pause e redirecione o orçamento.'] });

  // Complementos
  const units = (code: string) => d.revenue.byProduct.find((x) => x.code === code)?.units ?? 0;
  const maps = units('recovery_map');
  if (maps >= 5) {
    for (const code of ['defense_letters', 'calendar_30d', 'extra_income_plan']) {
      const rate = Math.round((units(code) / maps) * 100);
      if (rate < 15) out.push({ id: `attach_${code}`, area: 'receita', priority: 'baixa', title: `${PRODUCT_NAME[code]}: só ${rate}% dos compradores do Mapa levam`, evidence: `${units(code)} vendas para ${maps} Mapas no período.`, actions: ['Ofereça no momento certo (logo depois de o cliente abrir o Mapa, quando está motivado).', 'Teste o Kit Completo com desconto como caminho principal.'], plan: { title: `Aumentar a venda de ${PRODUCT_NAME[code]}`, goal: 'Subir a taxa de complemento por Mapa', segment: 'Compradores do Mapa', channel: 'Site (tela do Mapa)' } });
    }
  }
  if (units('collection_translator') >= 3) out.push({ id: 'translator_cross', area: 'receita', priority: 'baixa', title: 'Quem usa o Tradutor é público para o Mapa', evidence: `${units('collection_translator')} pessoas pagaram o Tradutor no período: têm uma cobrança real na mão.`, actions: ['Ao fim da tradução, ofereça o diagnóstico completo das dívidas ("agora veja quanto isso pesa no seu mês").'] });

  // Assinaturas
  const s = d.subscriptions;
  if (s.expiringSoon > 0) out.push({ id: 'renovar', area: 'retencao', priority: 'alta', title: `${s.expiringSoon} assinaturas vencem em até 7 dias`, evidence: `Receita mensal em jogo: ${brl(s.mrrAtRiskCents)}. O lembrete automático sai ${ctx.config.reminderDaysBefore} dias antes.`, actions: ['Confira em Assinaturas quem está vencendo e considere estender alguns dias de cortesia para quem usa bastante.', 'Se a renovação ainda é baixa, aumente a antecedência do lembrete em Configurações.'], plan: { title: 'Campanha de renovação', goal: 'Renovar as assinaturas que vencem esta semana', segment: 'Assinantes vencendo em 7 dias', channel: 'E-mail (a mensagem da própria conta)' } });
  if (s.delinquent > 0) out.push({ id: 'debito', area: 'retencao', priority: 'alta', title: `${s.delinquent} assinantes em débito (venceram sem renovar)`, evidence: `Receita mensal parada: ${brl(s.lostMrrCents)}. Os dados deles continuam guardados, então voltar é fácil.`, actions: ['Mande uma mensagem simples: "seus lançamentos e metas continuam aqui; renove para voltar".', 'Ofereça uma cortesia de dias para quem tinha muitos lançamentos.'], plan: { title: 'Recuperar assinantes em débito', goal: 'Reativar assinantes vencidos', segment: 'Assinantes em débito', channel: 'E-mail' } });
  if (s.renewalRatePct !== null && s.payingCount + s.delinquent >= 5 && s.renewalRatePct < 50) out.push({ id: 'renovacao_baixa', area: 'retencao', priority: 'media', title: `Só ${s.renewalRatePct}% dos assinantes renovaram`, evidence: `Renovaram ao menos uma vez: ${s.renewalRatePct}% de quem já pagou.`, actions: ['Como o Pix é manual todo mês, a fricção é o principal inimigo: avalie a cobrança recorrente quando o Asaas entrar.', 'Mostre o valor recebido (ex.: "você acompanhou X lançamentos e Y metas") antes do vencimento.'] });

  // Parcerias
  if (p.potential.cases >= 5) {
    out.push({
      id: 'parcerias_volume', area: 'parcerias', priority: 'media',
      title: 'Números para apresentar a parceiros',
      evidence: `No período: ${p.potential.cases} diagnósticos; ${p.potential.renegotiation} com dívida em atraso (renegociação); ${p.potential.consignadoProfile} com perfil de consignado (CLT, servidor ou INSS com cartão/empréstimo caro); ${p.potential.entrepreneurship} autônomos/outros vínculos (empreendedorismo). Contatos que já autorizaram ser procurados: ${p.consentedCases}.`,
      actions: ['Para escolas técnicas, SEBRAE e faculdades: use o número de autônomos e as entrevistas de renda extra (' + p.incomeInterviews.total + ' no período, ' + p.incomeInterviews.committed + ' com 10h+ por semana).', 'Para renegociação e crédito: use o perfil de atraso e a faixa de dívida, sem expor pessoas — o consentimento por categoria é o que transforma público em lead.'],
      plan: { title: 'Montar o material de apresentação para parceiros', goal: 'Ter 3 conversas com parceiros de capacitação/crédito', segment: 'Parceiros (SEBRAE, escolas técnicas, faculdades, instituições financeiras)', channel: 'Reunião / apresentação' },
    });
  }
  if (p.incomeInterviews.total >= 3 && p.consentedByCategory.every((c) => c.category !== 'empreendedorismo')) {
    out.push({ id: 'empreend_sem_consent', area: 'parcerias', priority: 'baixa', title: 'Há interessados em empreender, mas nenhum autorizou contato de parceiros', evidence: `${p.incomeInterviews.total} entrevistas de renda extra, nenhuma com a caixa de parceiros marcada.`, actions: ['Reveja o texto da caixa: explique o benefício concreto (curso gratuito, mentoria) antes de pedir a autorização.'] });
  }

  // Horários e dispositivo
  const totalPaid = d.revenue.orders;
  if (totalPaid >= 10) {
    const h = [...d.revenue.hours].sort((a, b) => b.orders - a.orders)[0]!;
    const wd = [...d.revenue.weekdays].sort((a, b) => b.orders - a.orders)[0]!;
    const DAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    out.push({ id: 'horario', area: 'aquisicao', priority: 'baixa', title: `Pagamentos se concentram na ${DAYS[wd.weekday]}, por volta das ${h.hour}h`, evidence: `${h.orders} pagamentos na hora de pico; ${wd.orders} no dia de pico.`, actions: ['Programe posts e anúncios para chegar um pouco antes desse horário.'] });
  }
  const dev = d.traffic.devices;
  const totalDev = dev.reduce((x, y) => x + y.sessions, 0);
  const mobile = dev.find((x) => x.device === 'mobile');
  if (totalDev >= 20 && mobile && mobile.sessions / totalDev > 0.7) out.push({ id: 'mobile', area: 'produto', priority: 'baixa', title: `${Math.round((mobile.sessions / totalDev) * 100)}% do acesso é pelo celular`, evidence: `${mobile.sessions} de ${totalDev} visitantes com origem identificada.`, actions: ['Priorize o layout mobile nos testes e o "copia e cola" do Pix.', 'Considere o WhatsApp como canal de divulgação e de relacionamento.'] });

  // Ferramentas grátis
  const toolUses = d.traffic.tools.reduce((x, y) => x + y.sessions, 0);
  if (toolUses >= 10) out.push({ id: 'ferramentas', area: 'aquisicao', priority: 'baixa', title: `As ferramentas grátis atraem ${toolUses} visitantes`, evidence: d.traffic.tools.map((t) => `${t.tool}: ${t.sessions}`).join(' · '), actions: ['Ao fim de cada ferramenta, convide para o diagnóstico completo.', 'São boas páginas para divulgar em grupos e buscadores (conteúdo útil que não pede nada).'] });

  // IA
  if (d.ai.ai + d.ai.template > 0) out.push({ id: 'ia', area: 'produto', priority: 'baixa', title: `IA escreveu ${d.ai.ai} entregas; ${d.ai.template} saíram pelo modelo fixo`, evidence: `Tokens no período: ${d.ai.inputTokens.toLocaleString('pt-BR')} de entrada e ${d.ai.outputTokens.toLocaleString('pt-BR')} de saída.`, actions: d.ai.template > d.ai.ai ? ['Muitas entregas saíram pelo modelo fixo: confira em Configurações se a IA está ligada e se a chave tem crédito.'] : ['Compare o custo em tokens com a receita dos produtos que usam IA antes de mexer em preço.'] });

  const order = { alta: 0, media: 1, baixa: 2 } as const;
  out.sort((a, b) => order[a.priority] - order[b.priority]);
  return { days, insights: out, note };
}

// ---------------------------------------------------------------------------
// Públicos para relacionamento (tamanhos; nunca listas de pessoas)
// ---------------------------------------------------------------------------
export interface Audience {
  id: string;
  name: string;
  count: number;
  channel: string;
  basis: string;
  message: string;
}

export async function audiences(ctx: Ctx): Promise<Audience[]> {
  const one = async (sql: string) => num(((await ctx.db.query<{ n: string }>(sql)).rows[0] ?? { n: 0 }).n);
  const act = `s.status = 'active' AND s.current_period_end > now()`;
  const [expiring, delinquent, mapOnly, upsell, idle, nearGoal, emp] = await Promise.all([
    one(`SELECT count(*) AS n FROM app.subscriptions s JOIN app.subscribers b ON b.id = s.subscriber_id AND b.deleted_at IS NULL WHERE ${act} AND NOT s.cancel_at_period_end AND s.current_period_end < now() + interval '7 days'`),
    one(`SELECT count(*) AS n FROM app.subscriptions s JOIN app.subscribers b ON b.id = s.subscriber_id AND b.deleted_at IS NULL WHERE NOT (${act})`),
    one(`SELECT count(*) AS n FROM app.cases c WHERE c.product_kind = 'map' AND EXISTS (SELECT 1 FROM app.orders o WHERE o.case_id = c.id AND o.status = 'paid') AND NOT EXISTS (SELECT 1 FROM app.order_items i JOIN app.orders o ON o.id = i.order_id WHERE o.case_id = c.id AND o.status = 'paid' AND i.product_code <> 'recovery_map')`),
    one(`SELECT count(*) AS n FROM app.subscriptions s JOIN app.subscribers b ON b.id = s.subscriber_id AND b.deleted_at IS NULL WHERE ${act} AND s.plan = 'controle' AND s.created_at < now() - interval '20 days'`),
    one(`SELECT count(*) AS n FROM app.subscriptions s JOIN app.subscribers b ON b.id = s.subscriber_id AND b.deleted_at IS NULL WHERE ${act} AND NOT EXISTS (SELECT 1 FROM app.ledger_entries l WHERE l.subscriber_id = s.subscriber_id AND l.created_at > now() - interval '14 days')`),
    one(`SELECT count(*) AS n FROM (SELECT g.id FROM app.goals g LEFT JOIN app.goal_contributions c ON c.goal_id = g.id WHERE g.completed_at IS NULL GROUP BY g.id, g.target_cents, g.saved_cents HAVING (g.saved_cents + coalesce(sum(c.amount_cents),0)) >= g.target_cents * 0.8) x`),
    one(`SELECT count(*) AS n FROM app.v_current_consents v WHERE v.purpose = 'lead_sharing' AND v.action = 'grant' AND v.scope->'categories' ? 'empreendedorismo'`),
  ]);
  const acct = 'Base legal: relacionamento com quem tem conta (e-mail do cadastro), com opção de sair em toda mensagem.';
  return [
    { id: 'renovar_7d', name: 'Assinantes que vencem em 7 dias', count: expiring, channel: 'E-mail', basis: acct, message: 'Oi! Seu plano do Fôlego vence em poucos dias. Seus lançamentos e metas continuam guardados: é só gerar um novo Pix na sua conta para seguir. Se preferir não renovar, sem problema — nada é cobrado sozinho.' },
    { id: 'em_debito', name: 'Assinantes em débito (venceram)', count: delinquent, channel: 'E-mail', basis: acct, message: 'Sentimos sua falta! Guardamos seus lançamentos e metas. Quando quiser voltar, é só renovar pela sua conta — leva um minuto.' },
    { id: 'sem_uso_14d', name: 'Assinantes sem lançamento há 14 dias', count: idle, channel: 'E-mail', basis: acct, message: 'Que tal registrar os gastos da semana? Em 2 minutos você vê para onde foi o dinheiro e se está dentro dos seus limites.' },
    { id: 'upgrade_ousado', name: 'Plano Controle há mais de 20 dias (candidatos a Ousado)', count: upsell, channel: 'E-mail / aviso na conta', basis: acct, message: 'Você já controla os gastos. O próximo passo é criar uma meta e guardar aos poucos — o plano Ousado libera metas com aportes e o treinador completo.' },
    { id: 'metas_quase', name: 'Assinantes com meta a 80% ou mais', count: nearGoal, channel: 'Aviso na conta', basis: acct, message: 'Falta pouco para a sua meta! Um último aporte e você conclui.' },
    { id: 'mapa_sem_complemento', name: 'Compradores do Mapa que não levaram complemento', count: mapOnly, channel: 'Dentro do site (anônimos, sem contato)', basis: 'Sem contato: são compras anônimas. A oferta só pode aparecer dentro do site, na tela do Mapa.', message: 'Quer levar as cartas prontas e o calendário com data para cada ação? Kit Completo com desconto.' },
    { id: 'leads_empreendedorismo', name: 'Interessados em empreender que autorizaram contato', count: emp, channel: 'Parceiros de capacitação', basis: 'Base legal: consentimento específico (categoria empreendedorismo). Só compartilhar com parceiros dessa finalidade e respeitar revogações.', message: 'Conteúdo de apresentação do parceiro (curso, mentoria, crédito para microempreendedor).' },
  ];
}

/** Datas úteis para planejar (referência geral; confirme as datas de cada ano). */
export const CALENDAR = [
  { when: 'Janeiro–fevereiro', theme: 'Contas de início de ano', idea: 'IPVA, IPTU, material escolar e fatura de fim de ano pesam no orçamento: conteúdo "como organizar as contas de janeiro".' },
  { when: 'Março (dia 15)', theme: 'Dia do Consumidor', idea: 'Data de descontos e de campanhas de direitos do consumidor: combine com o Tradutor de Cobrança e o guia de direitos.' },
  { when: 'Maio', theme: 'Educação financeira', idea: 'Época de ações de educação financeira: bom momento para parcerias e conteúdo das ferramentas grátis.' },
  { when: 'Novembro (Black Friday)', theme: 'Compras por impulso e cartão', idea: 'Antes: "como não se endividar na Black Friday". Depois (dezembro–janeiro): "a fatura chegou, e agora?".' },
  { when: 'Novembro–dezembro', theme: '13º salário', idea: 'Quem recebe o 13º pode quitar dívidas caras: conteúdo sobre priorizar juros altos e negociar à vista.' },
  { when: 'Dezembro', theme: 'Fim de ano', idea: 'Metas para o ano novo: convite para a assinatura (metas com aportes).' },
];

// ---------------------------------------------------------------------------
// Quadro de planejamento
// ---------------------------------------------------------------------------
export const PLAN_STATUS = ['ideia', 'planejado', 'em_andamento', 'concluido', 'pausado'] as const;

export async function listPlans(ctx: Ctx) {
  const r = await ctx.db.query<{ id: string; title: string; goal: string; segment: string; channel: string; status: string; due_on: Date | null; notes: string; created_at: Date; updated_at: Date }>(
    `SELECT id, title, goal, segment, channel, status, due_on, notes, created_at, updated_at FROM app.marketing_plans ORDER BY (status = 'concluido'), due_on NULLS LAST, created_at DESC`,
  );
  return r.rows.map((x) => ({ id: x.id, title: x.title, goal: x.goal, segment: x.segment, channel: x.channel, status: x.status, dueOn: x.due_on ? new Date(x.due_on).toISOString().slice(0, 10) : null, notes: x.notes, createdAt: iso(x.created_at), updatedAt: iso(x.updated_at) }));
}

export interface PlanInput {
  title: string;
  goal?: string | undefined;
  segment?: string | undefined;
  channel?: string | undefined;
  status?: string | undefined;
  dueOn?: string | null | undefined;
  notes?: string | undefined;
}

export async function createPlan(ctx: Ctx, admin: AdminUser, input: PlanInput): Promise<string> {
  if (input.status && !(PLAN_STATUS as readonly string[]).includes(input.status)) throw new AppError(422, 'invalid_status', 'Status inválido.');
  const r = await ctx.db.query<{ id: string }>(
    `INSERT INTO app.marketing_plans(title, goal, segment, channel, status, due_on, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [input.title.trim().slice(0, 140), (input.goal ?? '').slice(0, 400), (input.segment ?? '').slice(0, 200), (input.channel ?? '').slice(0, 120), input.status ?? 'planejado', input.dueOn ?? null, (input.notes ?? '').slice(0, 2000), admin.id],
  );
  const id = r.rows[0]!.id;
  await audit(ctx.db, `admin:${admin.id}`, 'admin_plan_create', 'marketing_plan', id, { title: input.title, by: admin.email });
  return id;
}

export async function updatePlan(ctx: Ctx, admin: AdminUser, id: string, input: Partial<PlanInput>): Promise<void> {
  if (input.status && !(PLAN_STATUS as readonly string[]).includes(input.status)) throw new AppError(422, 'invalid_status', 'Status inválido.');
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (input.title !== undefined) add('title', input.title.trim().slice(0, 140));
  if (input.goal !== undefined) add('goal', input.goal.slice(0, 400));
  if (input.segment !== undefined) add('segment', input.segment.slice(0, 200));
  if (input.channel !== undefined) add('channel', input.channel.slice(0, 120));
  if (input.status !== undefined) add('status', input.status);
  if (input.dueOn !== undefined) add('due_on', input.dueOn);
  if (input.notes !== undefined) add('notes', input.notes.slice(0, 2000));
  if (sets.length === 0) return;
  const r = await ctx.db.query(`UPDATE app.marketing_plans SET ${sets.join(', ')} WHERE id = $1`, params);
  if (r.rowCount === 0) throw notFound();
  await audit(ctx.db, `admin:${admin.id}`, 'admin_plan_update', 'marketing_plan', id, { ...input, by: admin.email });
}

export async function deletePlan(ctx: Ctx, admin: AdminUser, id: string): Promise<void> {
  const r = await ctx.db.query(`DELETE FROM app.marketing_plans WHERE id = $1`, [id]);
  if (r.rowCount === 0) throw notFound();
  await audit(ctx.db, `admin:${admin.id}`, 'admin_plan_delete', 'marketing_plan', id, { by: admin.email });
}
