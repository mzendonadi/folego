// Processo do worker (container próprio em produção): gera roteiros e cartas e roda os trabalhos em segundo plano
// (e-mails de conta, eBook de presente, avisos de indicação, ajuste de valores no provedor, expurgo, indicadores).
// IMPORTANTE: o worker usa o MESMO e-mail e o MESMO gateway de pagamento da API (antes ele não tinha e-mail e usava gateway de mentira).
import { loadConfig } from './config.ts';
import { createPgliteDb, createPostgresDb, ensureSchema } from './db.ts';
import type { Db } from './db.ts';
import { AsaasGateway, FakeGateway } from './gateway.ts';
import type { PaymentGateway } from './gateway.ts';
import { ConsoleSender, CountingSender, ResendSender } from './email.ts';
import { runWorker } from './generation/worker.ts';
import { PluggyProvider } from './openfinance.ts';
import { workerOptions } from './generation/setup.ts';

const config = loadConfig();
const log = (event: Record<string, unknown>) => console.log(JSON.stringify({ time: new Date().toISOString(), servico: 'worker', ...event }));

let db: Db;
if (config.databaseUrl) db = createPostgresDb(config.databaseUrl);
else {
  db = await createPgliteDb();
  await ensureSchema(db);
}

const control = { stopped: false };
const stop = () => {
  control.stopped = true;
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const gateway: PaymentGateway = config.asaas ? new AsaasGateway(config.asaas) : new FakeGateway(config.webhookSecret);
const emailRaw = config.email ? new ResendSender(config.email) : config.env !== 'production' ? new ConsoleSender() : undefined;
const email = emailRaw ? new CountingSender(emailRaw, db) : undefined;

const opts = workerOptions(config, log);
log({ evento: 'worker_iniciado', ia: opts.generator ? config.aiModel : 'desligada (modelos determinísticos)', tetoDiarioIA: config.aiMaxCallsPerDay, email: email ? email.name : 'NÃO configurado', pagamento: gateway.name });

const openFinance = config.openFinance ? new PluggyProvider(config.openFinance) : undefined;
await runWorker({ db, config, gateway, email, ...(openFinance ? { openFinance } : {}) }, opts, control);
await db.close();
log({ evento: 'worker_encerrado' });
process.exit(0);
