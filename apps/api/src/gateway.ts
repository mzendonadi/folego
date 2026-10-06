import { randomBytes } from 'node:crypto';
import { safeEqual } from './crypto.ts';
import { AppError } from './errors.ts';

export interface PixCharge {
  providerPaymentId: string;
  pixCopyPaste: string;
  expiresAt: Date;
}

export type GatewayPaymentStatus = 'pending' | 'confirmed' | 'failed' | 'expired' | 'unknown';

export interface GatewayEvent {
  providerEventId: string;
  providerPaymentId: string;
  /** Cobrança que pertence a uma assinatura recorrente no cartão (renovações chegam só por webhook). */
  providerSubscriptionId?: string;
  /** Valor informado no webhook (só para criar o registro da renovação; a confirmação consulta o provedor). */
  valueCents?: number;
}

/** Eventos da assinatura recorrente que não são pagamento confirmado. */
export interface BillingEvent {
  providerEventId: string;
  providerSubscriptionId: string;
  type: 'charge_refused' | 'subscription_ended';
}

/** Resultado de ler um webhook: assinatura inválida, evento que não nos interessa, um pagamento a conferir ou um aviso da recorrência. */
export type WebhookParse = { kind: 'invalid' } | { kind: 'ignore' } | { kind: 'payment'; event: GatewayEvent } | { kind: 'billing'; event: BillingEvent };

export interface CardSubscriptionInput {
  orderId: string;
  subscriberId: string;
  email: string;
  name: string;
  planName: string;
  valueCents: number;
  /** Primeira cobrança (yyyy-mm-dd). As seguintes caem no mesmo dia de cada mês. */
  firstDueOn: string;
  /** CPF só com dígitos (o Asaas exige para cobrar no cartão). Não guardamos. */
  cpf?: string | undefined;
}

export interface CardSubscription {
  providerCustomerId: string;
  providerSubscriptionId: string;
  /** Cobrança do primeiro mês, já criada no provedor. */
  providerPaymentId: string;
  /** Página segura do provedor onde a pessoa informa o cartão (nenhum dado de cartão passa pelo Fôlego). */
  checkoutUrl: string;
}

/**
 * Contrato com o provedor de Pix (Asaas, Mercado Pago…). O restante do sistema só conhece esta interface,
 * então trocar de provedor é escrever outro adaptador.
 */
export interface PaymentGateway {
  readonly name: string;
  createPix(input: { orderId: string; amountCents: number; expiresAt: Date }): Promise<PixCharge>;
  /** Consulta oficial no provedor. O corpo do webhook nunca é confiado sozinho; o valor pago também é conferido. */
  getPaymentStatus(providerPaymentId: string, expectedAmountCents: number): Promise<GatewayPaymentStatus>;
  /** Valida a autenticidade do webhook e extrai o evento. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): WebhookParse;
  /** Assinatura mensal no cartão de crédito. O cartão é digitado na página do provedor (checkoutUrl). */
  createCardSubscription(input: CardSubscriptionInput): Promise<CardSubscription>;
  /** Para de cobrar na hora. Não estorna o mês que já foi pago. */
  cancelCardSubscription(providerSubscriptionId: string): Promise<void>;
  /** Muda o valor das próximas cobranças da assinatura (desconto de indicação, ou volta ao preço cheio). */
  updateCardSubscriptionValue(providerSubscriptionId: string, valueCents: number): Promise<void>;
}

/** Provedor de mentira para desenvolvimento e testes. NÃO move dinheiro. */
export class FakeGateway implements PaymentGateway {
  readonly name = 'fake';
  private readonly webhookSecret: string;
  private readonly status = new Map<string, GatewayPaymentStatus>();

  constructor(webhookSecret: string) {
    this.webhookSecret = webhookSecret;
  }

  async createPix(input: { orderId: string; amountCents: number; expiresAt: Date }): Promise<PixCharge> {
    const providerPaymentId = `fake_${randomBytes(8).toString('hex')}`;
    this.status.set(providerPaymentId, 'pending');
    return {
      providerPaymentId,
      pixCopyPaste: `DEMO-FOLEGO-${providerPaymentId.toUpperCase()}-${String(input.amountCents).padStart(6, '0')}-NAO-E-UM-PIX-REAL`,
      expiresAt: input.expiresAt,
    };
  }

  async getPaymentStatus(providerPaymentId: string, _expectedAmountCents: number): Promise<GatewayPaymentStatus> {
    return this.status.get(providerPaymentId) ?? 'unknown';
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): WebhookParse {
    const given = headers['x-webhook-secret'];
    if (typeof given !== 'string' || !safeEqual(given, this.webhookSecret)) return { kind: 'invalid' };
    const b = body as { eventId?: unknown; paymentId?: unknown; subscriptionId?: unknown; valueCents?: unknown; billing?: unknown } | null;
    if (!b || typeof b.eventId !== 'string') return { kind: 'ignore' };
    if ((b.billing === 'charge_refused' || b.billing === 'subscription_ended') && typeof b.subscriptionId === 'string') {
      return { kind: 'billing', event: { providerEventId: b.eventId, providerSubscriptionId: b.subscriptionId, type: b.billing } };
    }
    if (typeof b.paymentId !== 'string') return { kind: 'ignore' };
    return {
      kind: 'payment',
      event: {
        providerEventId: b.eventId,
        providerPaymentId: b.paymentId,
        ...(typeof b.subscriptionId === 'string' ? { providerSubscriptionId: b.subscriptionId } : {}),
        ...(typeof b.valueCents === 'number' ? { valueCents: b.valueCents } : {}),
      },
    };
  }

  readonly subscriptions = new Set<string>();
  private readonly values = new Map<string, number>();

  async updateCardSubscriptionValue(providerSubscriptionId: string, valueCents: number): Promise<void> {
    this.values.set(providerSubscriptionId, valueCents);
  }

  /** Só no provedor de mentira: o valor que a próxima cobrança teria (undefined = preço cheio do plano). */
  valueOf(providerSubscriptionId: string): number | undefined {
    return this.values.get(providerSubscriptionId);
  }

  async createCardSubscription(input: CardSubscriptionInput): Promise<CardSubscription> {
    const id = randomBytes(6).toString('hex');
    const providerPaymentId = `fake_${randomBytes(8).toString('hex')}`;
    this.status.set(providerPaymentId, 'pending');
    this.subscriptions.add(`fake_sub_${id}`);
    return { providerCustomerId: `fake_cus_${id}`, providerSubscriptionId: `fake_sub_${id}`, providerPaymentId, checkoutUrl: `DEMO-CARD-${providerPaymentId.toUpperCase()}` };
  }

  async cancelCardSubscription(providerSubscriptionId: string): Promise<void> {
    this.subscriptions.delete(providerSubscriptionId);
  }

  /** Só existe no provedor de mentira: nova cobrança mensal da assinatura (como o cartão renovando). */
  newRenewalPayment(): string {
    const id = `fake_${randomBytes(8).toString('hex')}`;
    this.status.set(id, 'pending');
    return id;
  }

  /** Só existe no provedor de mentira: marca o pagamento como pago, como o banco faria. */
  markPaid(providerPaymentId: string): void {
    if (this.status.has(providerPaymentId)) this.status.set(providerPaymentId, 'confirmed');
  }
}

export interface AsaasOptions {
  apiKey: string;
  /** Produção: https://api.asaas.com/v3 · Sandbox: https://api-sandbox.asaas.com/v3 */
  baseUrl: string;
  /** Chave Pix (EVP) da conta que recebe os pagamentos. */
  pixKey: string;
  /** Token que o Asaas envia no cabeçalho asaas-access-token dos webhooks (NÃO é a chave da API). */
  webhookToken: string;
  fetchFn?: typeof fetch;
}

/**
 * Adaptador do Asaas com QR Code Pix ESTÁTICO de uso único e valor fixo.
 * Motivo: não exige cadastrar cliente nem CPF do pagador (o Asaas importa os dados quando o pagamento chega).
 * O pagamento é ligado ao pedido pelo `pixQrCodeId` (id do QR) recebido no webhook.
 */
export class AsaasGateway implements PaymentGateway {
  readonly name = 'asaas';
  private readonly o: AsaasOptions;
  private readonly fetchFn: typeof fetch;

  constructor(options: AsaasOptions) {
    this.o = options;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.o.baseUrl}${path}`, {
        method,
        headers: { access_token: this.o.apiKey, 'User-Agent': 'Folego/1.0', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError(502, 'gateway_unreachable', 'Não consegui falar com o provedor de pagamento. Tente de novo.');
    }
    if (!res.ok) {
      // Nunca repassamos o corpo do erro ao cliente: pode citar dados da conta. O motivo vai só para o registro do servidor.
      await this.logRefusal(method, path, res);
      throw new AppError(502, 'gateway_error', 'O provedor de pagamento recusou o pedido. Tente de novo.');
    }
    return res.json();
  }

  private async logRefusal(method: string, path: string, res: Response): Promise<void> {
    let errors: string[] = [];
    try {
      const body = (await res.clone().json()) as { errors?: Array<{ code?: unknown; description?: unknown }> };
      errors = (body.errors ?? []).slice(0, 5).map((e) => `${String(e.code ?? '?').slice(0, 60)}: ${String(e.description ?? '').slice(0, 200)}`);
    } catch {
      /* corpo que não é JSON: só o código HTTP */
    }
    const route = path.replace(/\?.*$/, '').replace(/\/[A-Za-z0-9_-]{8,}/g, '/:id'); // sem ids no registro
    console.error(JSON.stringify({ level: 50, msg: 'asaas_erro', metodo: method, caminho: route, status: res.status, erros: errors }));
  }

  async createPix(input: { orderId: string; amountCents: number; expiresAt: Date }): Promise<PixCharge> {
    const seconds = Math.max(60, Math.round((input.expiresAt.getTime() - Date.now()) / 1000));
    const data = (await this.call('POST', '/pix/qrCodes/static', {
      addressKey: this.o.pixKey,
      description: `Folego ${input.orderId.slice(0, 8)}`,
      value: input.amountCents / 100,
      format: 'PAYLOAD',
      expirationSeconds: seconds,
      allowsMultiplePayments: false,
      externalReference: input.orderId,
    })) as { id?: unknown; payload?: unknown };
    if (typeof data.id !== 'string' || typeof data.payload !== 'string') {
      throw new AppError(502, 'gateway_error', 'Resposta inesperada do provedor de pagamento.');
    }
    return { providerPaymentId: data.id, pixCopyPaste: data.payload, expiresAt: input.expiresAt };
  }

  private async callDelete(path: string): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.o.baseUrl}${path}`, { method: 'DELETE', headers: { access_token: this.o.apiKey, 'User-Agent': 'Folego/1.0' }, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new AppError(502, 'gateway_unreachable', 'Não consegui falar com o provedor de pagamento. Tente de novo.');
    }
    // 404 = a assinatura já não existe no provedor: o objetivo (parar de cobrar) está cumprido.
    if (!res.ok && res.status !== 404) throw new AppError(502, 'gateway_error', 'O provedor de pagamento recusou o pedido. Tente de novo.');
  }

  /**
   * Assinatura mensal no cartão: cria o cliente e a assinatura (billingType CREDIT_CARD) SEM dados de cartão.
   * A primeira cobrança vem com uma página do Asaas (invoiceUrl) onde a pessoa digita o cartão; o Asaas guarda o
   * cartão e cobra as próximas mensalidades sozinho. Nenhum dado de cartão passa pelo nosso servidor (fora do escopo PCI).
   */
  async createCardSubscription(input: CardSubscriptionInput): Promise<CardSubscription> {
    const customer = (await this.call('POST', '/customers', { name: input.name, email: input.email, externalReference: input.subscriberId, ...(input.cpf ? { cpfCnpj: input.cpf } : {}) })) as { id?: unknown };
    if (typeof customer.id !== 'string') throw new AppError(502, 'gateway_error', 'Resposta inesperada do provedor de pagamento.');
    const sub = (await this.call('POST', '/subscriptions', {
      customer: customer.id,
      billingType: 'CREDIT_CARD',
      value: input.valueCents / 100,
      nextDueDate: input.firstDueOn,
      cycle: 'MONTHLY',
      description: `Prumo (Fôlego) - plano ${input.planName}`,
      externalReference: input.orderId,
    })) as { id?: unknown };
    if (typeof sub.id !== 'string') throw new AppError(502, 'gateway_error', 'Resposta inesperada do provedor de pagamento.');
    const pays = (await this.call('GET', `/subscriptions/${encodeURIComponent(sub.id)}/payments?limit=1`)) as { data?: Array<{ id?: unknown; invoiceUrl?: unknown }> };
    const first = pays.data?.[0];
    if (!first || typeof first.id !== 'string' || typeof first.invoiceUrl !== 'string') throw new AppError(502, 'gateway_error', 'Resposta inesperada do provedor de pagamento.');
    return { providerCustomerId: customer.id, providerSubscriptionId: sub.id, providerPaymentId: first.id, checkoutUrl: first.invoiceUrl };
  }

  async updateCardSubscriptionValue(providerSubscriptionId: string, valueCents: number): Promise<void> {
    // updatePendingPayments: a cobrança do próximo mês, se já foi gerada, também muda para o valor novo.
    await this.call('POST', `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { value: valueCents / 100, updatePendingPayments: true });
  }

  async cancelCardSubscription(providerSubscriptionId: string): Promise<void> {
    await this.callDelete(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`);
  }

  async getPaymentStatus(providerPaymentId: string, expectedAmountCents: number): Promise<GatewayPaymentStatus> {
    if (providerPaymentId.startsWith('pay_')) {
      const p = (await this.call('GET', `/payments/${encodeURIComponent(providerPaymentId)}`)) as { status?: string; value?: number };
      const paid = (p.status === 'RECEIVED' || p.status === 'CONFIRMED') && typeof p.value === 'number' && Math.round(p.value * 100) >= expectedAmountCents;
      if (paid) return 'confirmed';
      return p.status === 'OVERDUE' || p.status === 'REFUNDED' ? 'failed' : 'pending';
    }
    const data = (await this.call('GET', `/payments?pixQrCodeId=${encodeURIComponent(providerPaymentId)}&limit=10`)) as { data?: Array<{ status?: string; value?: number }> };
    const list = Array.isArray(data.data) ? data.data : [];
    if (list.length === 0) return 'pending';
    const paid = list.some((p) => (p.status === 'RECEIVED' || p.status === 'CONFIRMED') && typeof p.value === 'number' && Math.round(p.value * 100) >= expectedAmountCents);
    return paid ? 'confirmed' : 'pending';
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): WebhookParse {
    const given = headers['asaas-access-token'];
    if (typeof given !== 'string' || !safeEqual(given, this.o.webhookToken)) return { kind: 'invalid' };
    const b = body as { id?: unknown; event?: unknown; payment?: { id?: unknown; pixQrCodeId?: unknown; subscription?: unknown; value?: unknown }; subscription?: { id?: unknown } } | null;
    if (!b || typeof b.id !== 'string' || typeof b.event !== 'string') return { kind: 'ignore' };
    const paymentSub = typeof b.payment?.subscription === 'string' ? b.payment.subscription : null;
    if (b.event === 'PAYMENT_RECEIVED' || b.event === 'PAYMENT_CONFIRMED') {
      const qr = b.payment?.pixQrCodeId;
      if (typeof qr === 'string' && qr !== '') return { kind: 'payment', event: { providerEventId: b.id, providerPaymentId: qr } };
      if (paymentSub && typeof b.payment?.id === 'string') {
        return {
          kind: 'payment',
          event: { providerEventId: b.id, providerPaymentId: b.payment.id, providerSubscriptionId: paymentSub, ...(typeof b.payment.value === 'number' ? { valueCents: Math.round(b.payment.value * 100) } : {}) },
        };
      }
      return { kind: 'ignore' };
    }
    if (b.event === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED' && paymentSub) return { kind: 'billing', event: { providerEventId: b.id, providerSubscriptionId: paymentSub, type: 'charge_refused' } };
    if ((b.event === 'SUBSCRIPTION_DELETED' || b.event === 'SUBSCRIPTION_INACTIVATED') && typeof b.subscription?.id === 'string') {
      return { kind: 'billing', event: { providerEventId: b.id, providerSubscriptionId: b.subscription.id, type: 'subscription_ended' } };
    }
    return { kind: 'ignore' };
  }
}
