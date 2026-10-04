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
  /** Quantos dias antes de vencer a assinatura o lembrete por e-mail é enviado. */
  reminderDaysBefore: number;
  /** Teto de e-mails de campanha por dia (proteção da reputação do domínio de envio). */
  campaignDailyCap: number;
  /** Dias depois do fim do acesso de quem cancelou em que os dados ainda ficam guardados para o download de segurança no backoffice. Passado esse prazo, são apagados sozinhos. */
  canceledPurgeDays: number;
  /** Programa de indicações (convites por e-mail e desconto para assinantes). */
  referralEnabled: boolean;
  /** Agregador de Open Finance (Pluggy). Sem as duas chaves, as contas conectadas ficam desligadas. */
  openFinance: { clientId: string; clientSecret: string; baseUrl: string } | null;
  /** Endereço do widget de conexão do agregador (deve estar liberado na CSP). */
  openFinanceWidgetUrl: string;
  /** Devolve o código de login no corpo da resposta (só para desenvolver). Exige EXPOSE_DEV_CODES=1 E ambiente de desenvolvimento: um NODE_ENV esquecido não basta. */
  exposeDevCodes: boolean;
  /** Cloudflare Turnstile (anti-robô). Sem as duas chaves fica desligado. */
  turnstileSiteKey: string | null;
  turnstileSecret: string | null;
  /** Desconto (%) na próxima fatura por indicação que assina. */
  referralDiscountPct: number;
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
    reminderDaysBefore: 3,
    campaignDailyCap: 200,
    canceledPurgeDays: 15,
    referralEnabled: true,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY : null,
    turnstileSecret: env.TURNSTILE_SECRET ? env.TURNSTILE_SECRET : null,
    referralDiscountPct: 10,
  };
}
