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
}

/** Resultado de ler um webhook: assinatura inválida, evento que não nos interessa, ou um pagamento a conferir. */
export type WebhookParse = { kind: 'invalid' } | { kind: 'ignore' } | { kind: 'payment'; event: GatewayEvent };

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
    const b = body as { eventId?: unknown; paymentId?: unknown } | null;
    if (!b || typeof b.eventId !== 'string' || typeof b.paymentId !== 'string') return { kind: 'ignore' };
    return { kind: 'payment', event: { providerEventId: b.eventId, providerPaymentId: b.paymentId } };
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
      // Nunca repassamos o corpo do erro ao cliente: pode citar dados da conta.
      throw new AppError(502, 'gateway_error', 'O provedor de pagamento recusou o pedido. Tente de novo.');
    }
    return res.json();
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

  async getPaymentStatus(providerPaymentId: string, expectedAmountCents: number): Promise<GatewayPaymentStatus> {
    const data = (await this.call('GET', `/payments?pixQrCodeId=${encodeURIComponent(providerPaymentId)}&limit=10`)) as { data?: Array<{ status?: string; value?: number }> };
    const list = Array.isArray(data.data) ? data.data : [];
    if (list.length === 0) return 'pending';
    const paid = list.some((p) => (p.status === 'RECEIVED' || p.status === 'CONFIRMED') && typeof p.value === 'number' && Math.round(p.value * 100) >= expectedAmountCents);
    return paid ? 'confirmed' : 'pending';
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): WebhookParse {
    const given = headers['asaas-access-token'];
    if (typeof given !== 'string' || !safeEqual(given, this.o.webhookToken)) return { kind: 'invalid' };
    const b = body as { id?: unknown; event?: unknown; payment?: { pixQrCodeId?: unknown } } | null;
    if (!b || typeof b.id !== 'string' || (b.event !== 'PAYMENT_RECEIVED' && b.event !== 'PAYMENT_CONFIRMED')) return { kind: 'ignore' };
    const qr = b.payment?.pixQrCodeId;
    if (typeof qr !== 'string' || qr === '') return { kind: 'ignore' };
    return { kind: 'payment', event: { providerEventId: b.id, providerPaymentId: qr } };
  }
}
