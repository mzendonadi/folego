import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createPgliteDb, createPostgresDb, ensureSchema } from './db.ts';
import { ensureDefaultEbook } from './ebook.ts';
import type { Db } from './db.ts';
import { AsaasGateway, FakeGateway } from './gateway.ts';
import { ConsoleSender, ResendSender } from './email.ts';
import type { PaymentGateway } from './gateway.ts';
import { PluggyProvider } from './openfinance.ts';
import { purgeExpired } from './services.ts';
import { runWorker } from './generation/worker.ts';
import { workerOptions } from './generation/setup.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
// Em desenvolvimento, serve o front-end de apps/web para testar tudo junto.
if (config.env !== 'production' && !config.staticDir) config.staticDir = path.resolve(here, '../../web');

let db: Db;
if (config.databaseUrl) {
  db = createPostgresDb(config.databaseUrl);
} else {
  // PGLITE_DIR (só fora de produção): guarda os dados do ambiente local de testes numa pasta, para não sumirem ao reiniciar.
  db = await createPgliteDb(config.env !== 'production' ? process.env.PGLITE_DIR : undefined);
}
await ensureSchema(db);
await ensureDefaultEbook(db).catch(() => false); // primeira subida: importa o eBook que vem com o sistema // banco vazio recebe o schema; migrações pendentes entram sempre (db/migrations)

const gateway: PaymentGateway = config.asaas ? new AsaasGateway(config.asaas) : new FakeGateway(config.webhookSecret);
const email = config.email ? new ResendSender(config.email) : (config.env !== 'production' && (config.leadsEnabled || config.subscriptionsEnabled) ? new ConsoleSender() : undefined);
// RATE_LIMITS=relaxed só vale fora de produção (popular dados de exemplo sem esbarrar nos limites por IP).
const openFinance = config.openFinance ? new PluggyProvider(config.openFinance) : undefined;
const app = await buildApp({ config, db, gateway, email, ...(openFinance ? { openFinance } : {}), rateLimits: config.env !== 'production' && process.env.RATE_LIMITS === 'relaxed' ? 'relaxed' : 'strict' });

// Worker dentro do processo só em desenvolvimento (em produção é um container próprio: src/worker.ts).
const workerControl = { stopped: false };
if (config.workerInline) {
  const opts = workerOptions(config, (event) => app.log.info({ servico: 'worker', ...event }));
  void runWorker({ db, config, gateway, ...(openFinance ? { openFinance } : {}) }, opts, workerControl, 1500);
  app.log.info(`Worker embutido ativo. IA: ${opts.generator ? config.aiModel : 'desligada (modelos determinísticos)'}`);
}

// Expurgo por prazo (LGPD): a cada hora.
const purgeTimer = setInterval(() => {
  purgeExpired({ db, config, gateway })
    .then((n) => {
      if (n > 0) app.log.info({ purged: n }, 'casos expurgados');
    })
    .catch((err) => app.log.error({ err }, 'falha no expurgo'));
}, 60 * 60 * 1000);
purgeTimer.unref();

const shutdown = async () => {
  clearInterval(purgeTimer);
  workerControl.stopped = true;
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
if (config.asaas && !config.asaas.apiKey.startsWith('$aact_')) {
  app.log.warn('ASAAS_API_KEY não começa com "$aact_". Se a chave foi colocada no .env sem aspas simples, o "$" foi interpretado e a chave está corrompida.');
}
if (gateway.name === 'fake') app.log.warn('ATENÇÃO: provedor de pagamento de MENTIRA ativo. Nenhum Pix é real.');
if (config.env !== 'production') app.log.warn(`Modo desenvolvimento: banco ${db.dialect}, gateway "${gateway.name}" (pagamento simulado). Abra http://localhost:${config.port}`);
