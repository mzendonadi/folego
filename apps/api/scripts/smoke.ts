// Teste de fumaça da geração em segundo plano, executado DENTRO do container da API (usa o Postgres real e o worker real):
//   sudo docker compose exec -T api node scripts/smoke.ts
// Cria um caso de teste, "paga" com o provedor de mentira, espera o worker gerar roteiros e cartas, confere e APAGA tudo.
import { loadConfig } from '../src/config.ts';
import { createPostgresDb } from '../src/db.ts';
import { FakeGateway } from '../src/gateway.ts';
import { createCase, createOrder, deleteCase, getDelivery, handleWebhook, resolveSession } from '../src/services.ts';

const config = loadConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL ausente');
const db = createPostgresDb(config.databaseUrl);
const gateway = new FakeGateway(config.webhookSecret);
const ctx = { db, config, gateway };

const input = {
  profile: { netIncomeCents: 320_000, fixedExpensesCents: 170_000, employmentType: 'clt' as const, ageBand: '35-44' as const, uf: 'SP' as const },
  debts: [
    { creditorName: 'Aluguel (teste)', kind: 'rent' as const, balanceCents: 150_000, monthlyRateBps: 100, daysOverdue: 25 },
    { creditorName: 'Cartão (teste)', kind: 'credit_card' as const, balanceCents: 420_000, monthlyPaymentCents: 42_000, daysOverdue: 0 },
    { creditorName: 'Loja (teste)', kind: 'store_credit' as const, balanceCents: 90_000, daysOverdue: 400 },
    { creditorName: 'Loja antiga (teste)', kind: 'store_credit' as const, balanceCents: 70_000, daysOverdue: 2500, firstDefaultOn: '2019-01-10' },
  ],
  acceptTerms: true as const,
};

let caseId: string | null = null;
let sessionId: string | null = null;
let ok = false;
try {
  sessionId = (await resolveSession(ctx, undefined, null)).sessionId;
  const created = await createCase(ctx, { sessionId, ipHash: null, userAgent: 'smoke', input });
  caseId = created.caseId;
  const order = await createOrder(ctx, { sessionId, caseId, products: ['recovery_map', 'defense_letters'], idempotencyKey: `smoke-${Date.now()}-${Math.random().toString(36).slice(2)}` });
  const pay = await db.query<{ provider_payment_id: string }>(`SELECT provider_payment_id FROM app.payments WHERE order_id = $1`, [order.orderId]);
  const paymentId = pay.rows[0]!.provider_payment_id;
  gateway.markPaid(paymentId);
  const outcome = await handleWebhook(ctx, { 'x-webhook-secret': config.webhookSecret }, { eventId: `smoke-evt-${Date.now()}`, paymentId });
  console.log(`pagamento: ${outcome}`);

  const started = Date.now();
  let generated: Record<string, { status: string; source: string | null; content: any }> = {};
  while (Date.now() - started < 90_000) {
    generated = (await getDelivery(ctx, sessionId, order.orderId)).generated;
    if (generated.scripts?.status === 'ready' && generated.letters?.status === 'ready') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const s = generated.scripts;
  const l = generated.letters;
  console.log(`roteiros: ${s?.status} (origem: ${s?.source}) em ${((Date.now() - started) / 1000).toFixed(1)}s; dívidas com roteiro: ${s?.content?.debts?.length}; avisos de prescrição: ${s?.content?.held?.length}`);
  console.log(`cartas: ${l?.status} (origem: ${l?.source}); quantidade: ${l?.content?.letters?.length}`);
  const text = JSON.stringify(generated);
  const checks = {
    roteirosProntos: s?.status === 'ready',
    cartasProntas: l?.status === 'ready',
    nomesSubstituidos: !text.includes('{{credor}}') && text.includes('Aluguel (teste)'),
    dividaPrescritaSoComoAviso: s?.content?.held?.length === 1 && s?.content?.debts?.every((d: any) => d.creditorName !== 'Loja antiga (teste)'),
    cartaDePrescricao: l?.content?.letters?.some((x: any) => x.tipo === 'prescricao') === true,
  };
  console.log('verificações:', JSON.stringify(checks));
  ok = Object.values(checks).every(Boolean);
} catch (error) {
  console.error('FALHA:', error instanceof Error ? error.message : error);
} finally {
  if (caseId && sessionId) {
    await deleteCase(ctx, sessionId, caseId).catch((e) => console.error('não consegui apagar o caso de teste:', e));
    console.log('caso de teste apagado');
  }
  await db.close();
}
console.log(ok ? 'FUMAÇA OK' : 'FUMAÇA FALHOU');
process.exit(ok ? 0 : 1);
