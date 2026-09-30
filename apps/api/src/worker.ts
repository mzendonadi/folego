// Processo do worker (container próprio em produção): gera roteiros e cartas em segundo plano.
import { loadConfig } from './config.ts';
import { createPgliteDb, createPostgresDb, ensureSchema } from './db.ts';
import type { Db } from './db.ts';
import { FakeGateway } from './gateway.ts';
import { runWorker } from './generation/worker.ts';
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

const opts = workerOptions(config, log);
log({ evento: 'worker_iniciado', ia: opts.generator ? config.aiModel : 'desligada (modelos determinísticos)', tetoDiarioIA: config.aiMaxCallsPerDay });

// O worker não usa o gateway de pagamento; o objeto só existe para satisfazer o contrato do contexto.
await runWorker({ db, config, gateway: new FakeGateway(config.webhookSecret) }, opts, control);
await db.close();
log({ evento: 'worker_encerrado' });
process.exit(0);
