// Generation pipeline tests: worker state machine, provider policies, SSRF guard,
// and a Tripo integration test against a LOCAL SIMULATOR of the Tripo API.
// Geometry is real: STL files come from the actual Python engine.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { ProviderError } from '../../src/lib/generation/errors.ts';
import type { ModelGenerationProvider, PollResult, ProviderRegistry } from '../../src/lib/generation/provider.ts';
import { MockProvider } from '../../src/lib/generation/providers/mock.ts';
import { ParametricProvider } from '../../src/lib/generation/providers/parametric.ts';
import { TripoProvider } from '../../src/lib/generation/providers/tripo.ts';
import { hostAllowed, isPrivateAddress, safeDownload } from '../../src/lib/generation/safe-fetch.ts';
import { canTransition } from '../../src/lib/generation/states.ts';
import { processJob, runOnce, type WorkerDeps } from '../../src/lib/generation/worker.ts';
import type { EngineClient } from '../../src/lib/generation/engine-client.ts';
import { MemoryRepo, MemoryStorage } from './helpers/memory-repo.ts';
import { PythonEngine } from './helpers/python-engine.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const EXAMPLE_AR = 'صمّم حامل هاتف مكتبي قابلًا للطباعة ثلاثية الأبعاد، بعرض 90 مم، وارتفاع 110 مم، وقاعدة مستقرة، وفتحة لشحن الهاتف، وزاوية ميل 65 درجة.';
const noSleep = async () => undefined;

function deps(repo: MemoryRepo, providers: ProviderRegistry, engine: PythonEngine | null, extra: Partial<WorkerDeps> = {}): WorkerDeps {
  return { repo, providers, engine: engine as unknown as EngineClient, storage: new MemoryStorage(), sleep: noSleep, ...extra };
}

function stlSize(stl: Buffer): { x: number; y: number; z: number } {
  const n = stl.readUInt32LE(80);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let v = 0; v < 3; v++) {
      for (let a = 0; a < 3; a++) {
        const val = stl.readFloatLE(84 + i * 50 + 12 + v * 12 + a * 4);
        min[a] = Math.min(min[a], val);
        max[a] = Math.max(max[a], val);
      }
    }
  }
  return { x: +(max[0] - min[0]).toFixed(3), y: +(max[1] - min[1]).toFixed(3), z: +(max[2] - min[2]).toFixed(3) };
}

describe('state machine', () => {
  test('allows the happy path and forbids skipping review', () => {
    assert.ok(canTransition('QUEUED', 'GENERATING'));
    assert.ok(canTransition('VALIDATING', 'REVIEW_REQUIRED'));
    assert.ok(!canTransition('QUEUED', 'REVIEW_REQUIRED'));
    assert.ok(!canTransition('FAILED', 'QUEUED'));
    assert.ok(!canTransition('REVIEW_REQUIRED', 'GENERATING'));
  });
});

describe('worker with the real geometry engine', () => {
  test('Arabic example prompt → parametric STL 90×80×110 mm, stored and sent to review', async () => {
    const engine = new PythonEngine();
    const repo = new MemoryRepo();
    const storage = new MemoryStorage();
    const job = repo.add({ provider: 'PARAMETRIC', input: { prompt: EXAMPLE_AR, userFields: {} } });
    const d = deps(repo, { PARAMETRIC: new ParametricProvider(engine as unknown as EngineClient) }, engine, { storage });
    assert.equal(await runOnce(d, 'w1'), 'processed');
    const stored = repo.jobs.get(job.id)!;
    assert.equal(stored.status, 'REVIEW_REQUIRED', stored.errorMessage ?? '');
    assert.deepEqual(stored.history, ['QUEUED', 'GENERATING', 'CONVERTING', 'VALIDATING', 'REVIEW_REQUIRED']);
    const rev = repo.revisions.get(job.revisionId)!;
    assert.equal(rev.model!.metadata.status, 'VALIDATED');
    const stl = [...storage.files.values()][0];
    assert.deepEqual(stlSize(stl), { x: 90, y: 80, z: 110 });
    assert.equal(rev.model!.stlSha256, rev.model!.metadata.stl_sha256);
    assert.equal(repo.notifications[0].type, 'GENERATION_DONE');
    assert.equal(await runOnce(d, 'w1'), 'idle');
  });

  test('out-of-range request fails with the engine\'s reason and no retry', async () => {
    const engine = new PythonEngine();
    const repo = new MemoryRepo();
    const job = repo.add({ provider: 'PARAMETRIC', input: { prompt: 'phone stand 900 mm wide', userFields: {} } });
    await runOnce(deps(repo, { PARAMETRIC: new ParametricProvider(engine as unknown as EngineClient) }, engine), 'w1');
    const j = repo.jobs.get(job.id)!;
    assert.equal(j.status, 'FAILED');
    assert.match(j.errorMessage!, /INVALID_PARAMETERS/);
    assert.equal(repo.revisions.get(job.revisionId)!.status, 'DRAFT');
  });

  test('async provider path: poll → download → engine conversion (mock provider, real engine)', async () => {
    process.env.ENABLE_MOCK_PROVIDER = '1';
    const engine = new PythonEngine();
    const repo = new MemoryRepo();
    const job = repo.add({ provider: 'MOCK', input: { prompt: 'cube', userFields: {}, targetLongestMm: 40 } });
    await runOnce(deps(repo, { MOCK: new MockProvider() }, engine), 'w1');
    const j = repo.jobs.get(job.id)!;
    assert.equal(j.status, 'REVIEW_REQUIRED', j.errorMessage ?? '');
    assert.deepEqual(j.history, ['QUEUED', 'GENERATING', 'DOWNLOADING', 'CONVERTING', 'VALIDATING', 'REVIEW_REQUIRED']);
    assert.deepEqual(repo.revisions.get(job.revisionId)!.model!.metadata.size_mm, { x: 40, y: 40, z: 40 });
    assert.ok(repo.revisions.get(job.revisionId)!.model!.sourceUrl, 'source file kept alongside the STL');
    assert.ok(repo.revisions.get(job.revisionId)!.model!.metadata.transforms.some((t) => t.includes('uniformly scaled')));
  });

  test('checksum mismatch between engine report and file stores nothing', async () => {
    const engine = new PythonEngine();
    engine.corruptNext = true;
    const repo = new MemoryRepo();
    const storage = new MemoryStorage();
    const job = repo.add({ provider: 'PARAMETRIC', input: { prompt: 'box 60x40x30 mm', userFields: {} }, maxAttempts: 1 });
    await runOnce(deps(repo, { PARAMETRIC: new ParametricProvider(engine as unknown as EngineClient) }, engine, { storage }), 'w1');
    assert.equal(repo.jobs.get(job.id)!.status, 'FAILED');
    assert.match(repo.jobs.get(job.id)!.errorMessage!, /checksum/);
    assert.equal(storage.files.size, 0);
  });
});

describe('provider policies (no geometry needed)', () => {
  class ScriptedProvider implements ModelGenerationProvider {
    readonly id = 'TRIPO' as const;
    readonly paid = true;
    readonly pollIntervalMs = 1;
    starts = 0;
    polls = 0;
    constructor(private script: { start?: () => never | void; pollErrors?: number; configured?: boolean } = {}) {}
    configured() {
      return this.script.configured === false ? ({ ok: false, reason: 'no key' } as const) : ({ ok: true } as const);
    }
    async start() {
      this.starts++;
      this.script.start?.();
      return { kind: 'pending' as const, externalTaskId: 'task-1', model: 'scripted' };
    }
    async poll(): Promise<PollResult> {
      this.polls++;
      if (this.polls <= (this.script.pollErrors ?? 0)) throw new ProviderError('TRANSIENT', 'HTTP 503', true, true);
      return { state: 'failed' as const, error: 'provider says no' };
    }
    async download(): Promise<never> {
      throw new Error('unreachable');
    }
  }

  test('transient poll errors are retried on the same task; provider failure is not resubmitted', async () => {
    const repo = new MemoryRepo();
    const p = new ScriptedProvider({ pollErrors: 3 });
    const job = repo.add({ provider: 'TRIPO', input: { prompt: 'x', userFields: {} } });
    await runOnce(deps(repo, { TRIPO: p }, null), 'w1');
    assert.equal(p.starts, 1);
    assert.equal(p.polls, 4);
    assert.equal(repo.jobs.get(job.id)!.status, 'FAILED');
    assert.match(repo.jobs.get(job.id)!.errorMessage!, /TASK_FAILED/);
  });

  test('unknown submission outcome on a paid provider is never resubmitted', async () => {
    const repo = new MemoryRepo();
    const p = new ScriptedProvider({ start: () => { throw new ProviderError('TRANSIENT', 'socket hang up', false, true); } });
    const job = repo.add({ provider: 'TRIPO', input: { prompt: 'x', userFields: {} } });
    await runOnce(deps(repo, { TRIPO: p }, null), 'w1');
    assert.equal(repo.jobs.get(job.id)!.status, 'FAILED');
    // even if an operator re-queues the job, the worker refuses to submit again
    repo.jobs.get(job.id)!.status = 'QUEUED';
    await runOnce(deps(repo, { TRIPO: p }, null), 'w1');
    assert.equal(p.starts, 1);
    assert.match(repo.jobs.get(job.id)!.errorMessage!, /not resent/);
  });

  test('retryable failure before any task exists is re-queued with backoff, then succeeds next run', async () => {
    const repo = new MemoryRepo();
    let first = true;
    const p = new ScriptedProvider({ start: () => { if (first) { first = false; throw new ProviderError('TRANSIENT', 'connection refused', true, false); } } });
    const job = repo.add({ provider: 'TRIPO', input: { prompt: 'x', userFields: {} } });
    const t0 = new Date('2026-01-01T00:00:00Z');
    await runOnce(deps(repo, { TRIPO: p }, null, { now: () => t0 }), 'w1');
    const j = repo.jobs.get(job.id)!;
    assert.equal(j.status, 'QUEUED');
    assert.ok(j.nextAttemptAt! > t0);
    assert.equal(await runOnce(deps(repo, { TRIPO: p }, null, { now: () => t0 }), 'w1'), 'idle', 'not due yet');
    await runOnce(deps(repo, { TRIPO: p }, null, { now: () => new Date(t0.getTime() + 3_600_000) }), 'w1');
    assert.equal(p.starts, 2);
  });

  test('falls back to another provider only when no task can exist', async () => {
    process.env.ENABLE_MOCK_PROVIDER = '1';
    const repo = new MemoryRepo();
    const engine = new PythonEngine();
    const job = repo.add({ provider: 'TRIPO', input: { prompt: 'x', userFields: {}, targetLongestMm: 20 } });
    await runOnce(deps(repo, { TRIPO: new ScriptedProvider({ configured: false }), MOCK: new MockProvider() }, engine, { fallbacks: { TRIPO: 'MOCK' } }), 'w1');
    const j = repo.jobs.get(job.id)!;
    assert.equal(j.status, 'REVIEW_REQUIRED', j.errorMessage ?? '');
    assert.equal(j.provider, 'MOCK');
  });

  test('a job cancelled mid-flight is left cancelled', async () => {
    const repo = new MemoryRepo();
    const p = new ScriptedProvider();
    const job = repo.add({ provider: 'TRIPO', input: { prompt: 'x', userFields: {} } });
    p.poll = async () => {
      repo.jobs.get(job.id)!.status = 'CANCELLED';
      return { state: 'succeeded' as const, outputUrl: 'https://x.tripo3d.ai/a.glb' };
    };
    const rec = (await repo.claimNext('w1', new Date()))!;
    await processJob(rec, deps(repo, { TRIPO: p }, null));
    assert.equal(repo.jobs.get(job.id)!.status, 'CANCELLED');
  });

  test('mock provider refuses to run in production', async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    try {
      assert.equal(new MockProvider().configured().ok, false);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });
});

describe('SSRF guard for provider downloads', () => {
  test('host allow-list matches suffixes, not substrings', () => {
    assert.ok(hostAllowed('cdn.tripo3d.ai', ['tripo3d.ai']));
    assert.ok(hostAllowed('tripo3d.ai', ['tripo3d.ai']));
    assert.ok(!hostAllowed('tripo3d.ai.evil.com', ['tripo3d.ai']));
    assert.ok(!hostAllowed('eviltripo3d.ai', ['tripo3d.ai']));
  });

  test('private, loopback and metadata addresses are private', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1']) {
      assert.ok(isPrivateAddress(ip), ip);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
  });

  test('rejects http, foreign hosts and IP literals', async () => {
    const opts = { allowedHostSuffixes: ['tripo3d.ai'], maxBytes: 1000 };
    await assert.rejects(safeDownload('http://cdn.tripo3d.ai/a.glb', opts), /non-https/);
    await assert.rejects(safeDownload('https://example.com/a.glb', opts), /not in the allow-list/);
    await assert.rejects(safeDownload('https://169.254.169.254/latest/meta-data', { ...opts, allowedHostSuffixes: ['169.254.169.254'] }), /private address/);
  });
});

// ---------------------------------------------------------------- Tripo simulator
// A local HTTP server that speaks the subset of the Tripo v3 API the adapter uses.
// It proves our adapter + worker + engine wiring; it is NOT evidence that the real
// Tripo service works today (that needs `bun run test:acceptance:tripo` with a key).

describe('Tripo adapter against a local simulator', () => {
  let server: Server;
  let base = '';
  let submits = 0;
  let polls = 0;
  let downloads = 0;
  const glb = readFileSync(join(ROOT, 'storage/models/cmvmyhhgh0007oo5mg7g8edu8-rev-1-v3.glb'));

  before(async () => {
    server = createServer((req, res) => {
      const send = (code: number, body: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url?.startsWith('/v3/') && req.headers.authorization !== 'Bearer tsk_test') return send(401, { code: 1002, message: 'bad key' });
      if (req.url === '/v3/account/balance') return send(200, { code: 0, data: { balance: 100, frozen: 0 } });
      if (req.url === '/v3/generation/text-to-model' && req.method === 'POST') {
        submits++;
        return send(200, { code: 0, data: { task_id: 'sim-task-1' } });
      }
      if (req.url === '/v3/tasks/sim-task-1') {
        polls++;
        if (polls < 3) return send(200, { code: 0, data: { task_id: 'sim-task-1', status: 'running', progress: polls * 30 } });
        // first link handed out is already expired, the second one works
        const file = polls === 3 ? 'expired.glb' : 'model.glb';
        return send(200, { code: 0, data: { task_id: 'sim-task-1', status: 'success', progress: 100, credits_consumed: 10, output: { model_url: `${base}/files/${file}` } } });
      }
      if (req.url === '/files/expired.glb') { downloads++; res.writeHead(403); return res.end(); }
      if (req.url === '/files/model.glb') {
        downloads++;
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': glb.length });
        return res.end(glb);
      }
      send(404, { code: 404 });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.TRIPO_API_KEY = 'tsk_test';
    process.env.TRIPO_API_BASE = `${base}/v3`;
    process.env.SAFE_FETCH_TEST_HOSTS = '127.0.0.1';
  });

  after(() => server.close());

  test('submit once → poll → expired link re-polled → GLB converted to a 120 mm STL', async () => {
    // tripo.ts reads TRIPO_API_BASE at import time, so import it after the env is set
    const { TripoProvider: FreshTripo } = await import(`../../src/lib/generation/providers/tripo.ts?sim=${Date.now()}`) as { TripoProvider: typeof TripoProvider };
    const engine = new PythonEngine();
    const repo = new MemoryRepo();
    const job = repo.add({ provider: 'TRIPO', input: { prompt: 'ornamental Quran stand', userFields: {}, targetLongestMm: 120 } });
    const tripo = new FreshTripo();
    Object.defineProperty(tripo, 'pollIntervalMs', { value: 1 });
    await runOnce(deps(repo, { TRIPO: tripo }, engine), 'w1');
    const j = repo.jobs.get(job.id)!;
    assert.equal(j.status, 'REVIEW_REQUIRED', j.errorMessage ?? '');
    assert.equal(submits, 1, 'exactly one paid submission');
    assert.equal(j.externalTaskId, 'sim-task-1');
    assert.equal(j.costCredits, 10);
    assert.equal(downloads, 2, 'expired link retried with a fresh one');
    const md = repo.revisions.get(job.revisionId)!.model!.metadata;
    assert.equal(Math.max(md.size_mm!.x, md.size_mm!.y, md.size_mm!.z), 120);
    assert.ok(md.transforms.some((t) => t.includes('m → mm')));
    assert.ok(['VALIDATED', 'VALID_WITH_WARNINGS', 'REPAIR_REQUIRED'].includes(md.status));
  });
});
