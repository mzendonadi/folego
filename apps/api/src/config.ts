export interface AsaasConfig {
  apiKey: string;
  baseUrl: string;
  pixKey: string;
  webhookToken: string;
}

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  /** Sem DATABASE_URL o servidor usa PGlite em memória (só desenvolvimento). */
  databaseUrl: string | null;
  /** Segredo para HMAC de IP. Em produção é obrigatório e precisa ter 32+ caracteres. */
  secret: string;
  paymentProvider: 'fake' | 'asaas';
  asaas: AsaasConfig | null;
  /** Segredo esperado no cabeçalho do webhook do provedor de mentira (só usado com paymentProvider = fake). */
  webhookSecret: string;
  /** Pasta do front-end estático (só desenvolvimento; em produção o Nginx serve). */
  staticDir: string | null;
  /** Atrás do Cloudflare, o IP real vem em CF-Connecting-IP. */
  trustCloudflare: boolean;
  cookieSecure: boolean;
  /** IA dos roteiros. Sem chave, o worker usa só os modelos determinísticos. */
  anthropicApiKey: string | null;
  anthropicWorkspaceId: string | null;
  aiModel: string;
  aiMaxCallsPerDay: number;
  /** Roda o worker dentro do processo da API (desenvolvimento). Em produção, o worker é um container próprio. */
  workerInline: boolean;
  /** E-mail transacional. Sem chave, os recursos de e-mail ficam desligados (não há envio falso). */
  email: import('./email.ts').EmailConfig | null;
  /** Endereço público do site (links nos e-mails). */
  publicUrl: string;
  /** Propostas de parceiros (leads). Desligado até a revisão jurídica (LGPD/superendividamento). */
  leadsEnabled: boolean;
  /** Assinaturas mensais (conta por e-mail). Desligado até haver e-mail e revisão jurídica. */
  subscriptionsEnabled: boolean;
  /** Token do administrador para cadastrar parceiros (32+ caracteres). Sem ele, as rotas de administração não existem. */
  partnerAdminToken: string | null;
  /** E-mails que podem virar dono do backoffice no primeiro acesso (depois, usuários e permissões ficam na tela de Configurações). */
  adminEmails: string[];
  /** Ajustes que o dono muda pelo backoffice sem reiniciar (ver runtime.ts). Valores iniciais vêm do ambiente. */
  aiEnabled: boolean;
  salesPaused: boolean;
  announcement: { text: string; tone: 'info' | 'warn' } | null;
  /** Preço fechado do Kit Completo (Mapa + Cartas + Calendário). */
  bundlePriceCents: number;
  /** Mapa da Virada para quem assina o Ousado: preço no Pix e dias de acesso. O Desbravador usa o Mapa sem pagar, enquanto a assinatura valer. */
  subscriberMapPriceCents: number;
  subscriberMapDays: number;
  /** Quantos dias antes de vencer a assinatura o lembrete por e-mail é enviado. */
  reminderDaysBefore: number;
  /** Teto de e-mails de campanha por dia (proteção da reputação do domínio de envio). */
  campaignDailyCap: number;
  /** Dias depois do fim do acesso de quem cancelou em que os dados ainda ficam guardados para o download de segurança no backoffice. Passado esse prazo, são apagados sozinhos. */
  canceledPurgeDays: number;
  /** Programa de indicações (convites por e-mail e desconto para assinantes). */
  referralEnabled: boolean;
  /** WhatsApp do Fôlego pela Bird (convite de indicação do Prumo). Sem a chave e o número, o convite por WhatsApp fica desligado e só o link de compartilhar funciona. */
  bird: { apiKey: string; from: string; baseUrl: string; template: string; language: string; webhookSecret: string | null } | null;
  /** Agregador de Open Finance (Pluggy). Sem as duas chaves, as contas conectadas ficam desligadas. */
  openFinance: { clientId: string; clientSecret: string; baseUrl: string } | null;
  /** Endereço do widget de conexão do agregador (deve estar liberado na CSP). */
  openFinanceWidgetUrl: string;
  /** Segredo que o agregador manda nos avisos (webhook). Sem ele, o endereço de avisos não existe. */
  openFinanceWebhookSecret: string | null;
  /** Banco de mentira para testar o fluxo inteiro SEM contrato (só fora de produção). */
  openFinanceFake: boolean;
  /** Devolve o código de login no corpo da resposta (só para desenvolver). Exige EXPOSE_DEV_CODES=1 E ambiente de desenvolvimento: um NODE_ENV esquecido não basta. */
  exposeDevCodes: boolean;
  /** Cloudflare Turnstile (anti-robô). Sem as duas chaves fica desligado. */
  turnstileSiteKey: string | null;
  turnstileSecret: string | null;
  /** Meta Conversions API (servidor). Sem o token fica desligada. */
  metaCapiToken: string | null;
  metaPixelId: string;
  metaTestEventCode: string | null;
  /** PageView anônimo (IP e navegador de todo visitante) só com META_CAPI_PAGEVIEW=1. */
  metaPageView: boolean;
  /** Desconto (%) na próxima fatura por indicação que assina. */
  referralDiscountPct: number;
  /** Alertas de custo: o card "Sistema saudável" acende com 80% de qualquer limite (a IA ainda para sozinha no teto diário). */
  aiMonthlyCallsLimit: number;
  emailDailyLimit: number;
  emailMonthlyLimit: number;
}

const ASAAS_PRODUCTION_URL = 'https://api.asaas.com/v3';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = (env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development') as Config['env'];
  const secret = env.APP_SECRET ?? '';
  const provider: Config['paymentProvider'] = env.PAYMENT_PROVIDER === 'asaas' ? 'asaas' : 'fake';

  let asaas: AsaasConfig | null = null;
  if (provider === 'asaas') {
    const missing = ['ASAAS_API_KEY', 'ASAAS_PIX_KEY', 'ASAAS_WEBHOOK_TOKEN'].filter((k) => !env[k]);
    if (missing.length > 0) throw new Error(`Faltam variáveis do Asaas: ${missing.join(', ')}`);
    if ((env.ASAAS_WEBHOOK_TOKEN ?? '').length < 32) throw new Error('ASAAS_WEBHOOK_TOKEN precisa ter pelo menos 32 caracteres');
    asaas = {
      apiKey: env.ASAAS_API_KEY as string,
      baseUrl: (env.ASAAS_BASE_URL ?? ASAAS_PRODUCTION_URL).replace(/\/+$/, ''),
      pixKey: env.ASAAS_PIX_KEY as string,
      webhookToken: env.ASAAS_WEBHOOK_TOKEN as string,
    };
  }

  if (mode === 'production') {
    if (secret.length < 32) throw new Error('APP_SECRET precisa ter pelo menos 32 caracteres em produção');
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatório em produção');
    if (provider === 'fake') {
      // Trava de segurança: o provedor de mentira em produção só com autorização explícita (ex.: teste do servidor).
      if (env.ALLOW_FAKE_GATEWAY_IN_PRODUCTION !== '1') throw new Error('Provedor de pagamento "fake" não é permitido em produção (defina PAYMENT_PROVIDER=asaas)');
      if (!env.WEBHOOK_SECRET || env.WEBHOOK_SECRET.length < 24) throw new Error('WEBHOOK_SECRET é obrigatório com o provedor fake');
    }
  }

  return {
    env: mode,
    openFinanceWidgetUrl: env.PLUGGY_CONNECT_URL ?? 'https://cdn.pluggy.ai/pluggy-connect/v2.8.0/pluggy-connect.js',
    openFinanceWebhookSecret: env.OPENFINANCE_WEBHOOK_SECRET && env.OPENFINANCE_WEBHOOK_SECRET.length >= 16 ? env.OPENFINANCE_WEBHOOK_SECRET : null,
    openFinanceFake: env.OPENFINANCE_FAKE === '1' && mode !== 'production',
    openFinance: env.PLUGGY_CLIENT_ID && env.PLUGGY_CLIENT_SECRET ? { clientId: env.PLUGGY_CLIENT_ID, clientSecret: env.PLUGGY_CLIENT_SECRET, baseUrl: env.PLUGGY_BASE_URL ?? 'https://api.pluggy.ai' } : null,
    exposeDevCodes: mode === 'development' && env.EXPOSE_DEV_CODES === '1',
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL ?? null,
    secret: secret || 'dev-secret-nao-usar-em-producao-0123456789',
    paymentProvider: provider,
    asaas,
    webhookSecret: env.WEBHOOK_SECRET ?? 'dev-webhook-secret',
    staticDir: env.STATIC_DIR ?? null,
    trustCloudflare: env.TRUST_CLOUDFLARE === '1',
    cookieSecure: mode === 'production',
    anthropicApiKey: env.ANTHROPIC_API_KEY ? env.ANTHROPIC_API_KEY : null,
    anthropicWorkspaceId: env.ANTHROPIC_WORKSPACE_ID ? env.ANTHROPIC_WORKSPACE_ID : null,
    aiModel: env.AI_MODEL ?? 'claude-sonnet-5',
    aiMaxCallsPerDay: Number(env.AI_MAX_CALLS_PER_DAY ?? 200),
    workerInline: env.WORKER_INLINE ? env.WORKER_INLINE === '1' : mode !== 'production',
    email: env.RESEND_API_KEY ? { provider: 'resend', apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM ?? 'Fôlego <acesso@folego.online>' } : null,
    publicUrl: (env.PUBLIC_URL ?? 'https://folego.online').replace(/\/+$/, ''),
    leadsEnabled: env.LEADS_ENABLED === '1',
    subscriptionsEnabled: env.SUBSCRIPTIONS_ENABLED === '1',
    partnerAdminToken: env.PARTNER_ADMIN_TOKEN && env.PARTNER_ADMIN_TOKEN.length >= 32 ? env.PARTNER_ADMIN_TOKEN : null,
    adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')),
    aiEnabled: true,
    salesPaused: false,
    announcement: null,
    bundlePriceCents: 5990,
    subscriberMapPriceCents: 1299,
    subscriberMapDays: 90,
    reminderDaysBefore: 3,
    campaignDailyCap: 200,
    canceledPurgeDays: 15,
    referralEnabled: true,
    bird: env.BIRD_API_KEY && env.BIRD_API_KEY.length >= 20 && env.BIRD_WHATSAPP_FROM
      ? {
          apiKey: env.BIRD_API_KEY,
          from: env.BIRD_WHATSAPP_FROM,
          // `||` e não `??`: o docker-compose entrega "" quando o segredo não existe, e vazio precisa cair no endereço padrão (senão o envio falha com "Failed to parse URL").
          // A região vem da própria chave (bk_us1_… ou bk_eu1_…): o endereço é https://<região>.platform.bird.com; chave de uma região em outro endereço é recusada (401/421).
          baseUrl: (env.BIRD_BASE_URL?.trim() || `https://${/^bk_([a-z]{2}\d)_/.exec(env.BIRD_API_KEY)?.[1] ?? 'us1'}.platform.bird.com`).replace(/\/+$/, ''),
          // Modelo aprovado: "Fôlego Indicação Prumo". Aceita o nome como aparece na Bird ou o identificador (slug); nome vira slug: sem acento, minúsculo, hífen no lugar de espaço.
          template: (env.BIRD_TEMPLATE_INDICACAO || 'folego-indicacao-prumo').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, '-'),
          language: env.BIRD_TEMPLATE_LANGUAGE?.trim() || 'pt-BR',
          webhookSecret: env.BIRD_WEBHOOK_SECRET && env.BIRD_WEBHOOK_SECRET.length >= 16 ? env.BIRD_WEBHOOK_SECRET : null,
        }
      : null,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY : null,
    turnstileSecret: env.TURNSTILE_SECRET ? env.TURNSTILE_SECRET : null,
    metaCapiToken: env.META_CAPI_TOKEN ? env.META_CAPI_TOKEN : null,
    metaPixelId: env.META_PIXEL_ID && /^\d{6,20}$/.test(env.META_PIXEL_ID) ? env.META_PIXEL_ID : '1085904724208873', // pixel "Folego" (Conversions API); o 1643796570757610 é o do navegador e não pode ser o padrão (D-022)
    metaTestEventCode: env.META_TEST_EVENT_CODE ? env.META_TEST_EVENT_CODE : null,
    metaPageView: env.META_CAPI_PAGEVIEW === '1',
    referralDiscountPct: 10,
    aiMonthlyCallsLimit: Number(env.AI_MAX_CALLS_PER_MONTH ?? 4000),
    emailDailyLimit: Number(env.EMAIL_DAILY_LIMIT ?? 100),
    emailMonthlyLimit: Number(env.EMAIL_MONTHLY_LIMIT ?? 3000),
  };
}
