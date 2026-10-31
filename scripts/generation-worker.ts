// =====================================================================
// Generation worker process.  Run:  bun run worker
//
// Claims queued generation jobs from the database and drives them through
// the provider → engine → storage pipeline (src/lib/generation/worker.ts).
// Safe to run several copies: jobs are claimed with compare-and-set.
// =====================================================================

import { hostname } from 'node:os';
import { db } from '../src/lib/db.ts';
import { EngineClient } from '../src/lib/generation/engine-client.ts';
import { PrismaGenerationRepository } from '../src/lib/generation/prisma-repository.ts';
import { buildRegistry, parseFallbacks, providerStatus } from '../src/lib/generation/registry.ts';
import { runOnce, type WorkerDeps } from '../src/lib/generation/worker.ts';
import { saveFile } from '../src/lib/storage.ts';

const workerId = `${hostname()}:${process.pid}`;
const idleMs = Number(process.env.WORKER_IDLE_MS || 2000);
let stopping = false;

const engine = EngineClient.fromEnv();
const providers = buildRegistry(engine);
const deps: WorkerDeps = {
  repo: new PrismaGenerationRepository(db),
  providers,
  engine,
  storage: { saveFile: (kind, data, ext, prefix) => saveFile(kind, data, ext, prefix) },
  fallbacks: parseFallbacks(),
  log: (msg, extra) => console.log(JSON.stringify({ at: new Date().toISOString(), worker: workerId, msg, ...extra })),
};

async function main() {
  console.log(JSON.stringify({ msg: 'generation worker started', workerId, engine: !!engine, providers: providerStatus(providers) }));
  if (!engine) console.warn('ENGINE_URL / ENGINE_SERVICE_TOKEN not set: parametric generation and STL conversion will fail with a clear error.');
  while (!stopping) {
    try {
      const r = await runOnce(deps, workerId);
      if (r === 'idle') await new Promise((res) => setTimeout(res, idleMs));
    } catch (e) {
      console.error(JSON.stringify({ msg: 'worker loop error', error: String(e) }));
      await new Promise((res) => setTimeout(res, idleMs * 5));
    }
  }
  await db.$disconnect();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(JSON.stringify({ msg: `received ${sig}, finishing current job`, workerId }));
    stopping = true;
  });
}

main();
