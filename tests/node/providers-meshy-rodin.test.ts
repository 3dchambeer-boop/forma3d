// Meshy and Hyper3D Rodin adapters. SIMULATED: a local HTTP server implements the documented subset of each API
// (docs.meshy.ai, docs.hyper3d.ai, checked 2026-10-30). This proves our adapters, the worker's no-duplicate-payment
// policy and the GLB → STL conversion by the real engine; it is NOT evidence that either live service works today.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

import { ProviderError } from '../../src/lib/generation/errors.ts';
import type { EngineClient } from '../../src/lib/generation/engine-client.ts';
import type { ProviderRegistry } from '../../src/lib/generation/provider.ts';
import { MeshyProvider } from '../../src/lib/generation/providers/meshy.ts';
import { RodinProvider } from '../../src/lib/generation/providers/rodin.ts';
import { runOnce, type WorkerDeps } from '../../src/lib/generation/worker.ts';
import { MemoryRepo, MemoryStorage } from './helpers/memory-repo.ts';
import { PythonEngine } from './helpers/python-engine.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const GLB = readFileSync(join(ROOT, 'storage/models/cmvmyhhgh0007oo5mg7g8edu8-rev-1-v3.glb'));
const PNG = `data:image/png;base64,${readFileSync(join(import.meta.dirname, 'fixtures/images/a.png')).toString('base64')}`;
const deps = (repo: MemoryRepo, providers: ProviderRegistry, engine: PythonEngine | null): WorkerDeps => ({ repo, providers, engine: engine as unknown as EngineClient, storage: new MemoryStorage(), sleep: async () => undefined });
const fast = <T extends object>(p: T) => { Object.defineProperty(p, 'pollIntervalMs', { value: 1 }); return p; };

const sim = {
  mode: 'ok' as 'ok' | '402' | '429' | '500' | '400' | 'rodin201error' | 'fail',
  calls: [] as { method: string; url: string; auth?: string; json?: any; form?: Record<string, string | { name: string; type: string; size: number }> }[],
  polls: 0,
};
let server: Server, base = '';
const read = async (req: IncomingMessage) => { const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer); return Buffer.concat(c); };

before(async () => {
  server = createServer(async (req, res) => {
    const raw = await read(req), url = req.url || '';
    // one request per connection: avoids a client reusing a socket the server is closing (a reset under load)
    const send = (code: number, o: unknown) => { res.writeHead(code, { 'content-type': 'application/json', connection: 'close' }); res.end(JSON.stringify(o)); };
    if (url === '/files/model.glb') { res.writeHead(200, { 'content-type': 'model/gltf-binary', 'content-length': GLB.length, connection: 'close' }); return res.end(GLB); }
    const call: (typeof sim.calls)[number] = { method: req.method!, url, auth: req.headers.authorization };
    if ((req.headers['content-type'] || '').startsWith('multipart/form-data')) {
      const fd = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type']! }, body: new Uint8Array(raw) }).formData();
      call.form = {};
      for (const [k, v] of fd.entries()) call.form[k] = typeof v === 'string' ? v : { name: v.name, type: v.type, size: v.size };
    } else if (raw.length) call.json = JSON.parse(raw.toString());
    sim.calls.push(call);
    // ---- Meshy
    if (url.startsWith('/meshy/')) {
      if (req.headers.authorization !== 'Bearer msy_test') return send(401, { message: 'Invalid API key' });
      if (req.method === 'POST') {
        if (sim.mode === '402') return send(402, { message: 'Insufficient credits' });
        if (sim.mode === '429') return send(429, { message: 'Too many requests' });
        if (sim.mode === '500') return send(500, { message: 'internal' });
        if (sim.mode === '400') return send(400, { message: 'prompt is required' });
        return send(202, { result: '0193-task' });
      }
      sim.polls++;
      if (sim.mode === 'fail') return send(200, { id: '0193-task', status: 'FAILED', progress: 0, task_error: { message: 'Moderation: prompt refused' }, consumed_credits: 0 });
      if (sim.polls < 3) return send(200, { id: '0193-task', status: sim.polls === 1 ? 'PENDING' : 'IN_PROGRESS', progress: sim.polls === 1 ? 0 : 55 });
      return send(200, { id: '0193-task', status: 'SUCCEEDED', progress: 100, consumed_credits: 20, model_urls: { glb: `${base}/files/model.glb`, fbx: `${base}/files/model.fbx` } });
    }
    // ---- Rodin (errors arrive with HTTP 201 too)
    if (url.startsWith('/rodin/')) {
      if (req.headers.authorization !== 'Bearer rdn_test') return send(401, { error: 'UNAUTHORIZED' });
      if (url === '/rodin/api/v2/rodin') {
        if (sim.mode === 'rodin201error') return send(201, { error: 'INVALID_REQUEST', message: 'tier is not allowed for this account' });
        if (sim.mode === '500') return send(502, { message: 'bad gateway' });
        return send(201, { message: 'Submitted', uuid: '123e4567-e89b-12d3-a456-426614174000', jobs: { uuids: ['j1', 'j2'], subscription_key: 'sub-key-1' }, consumed: 0.5 });
      }
      if (url === '/rodin/api/v2/status') {
        sim.polls++;
        if (call.json?.subscription_key !== 'sub-key-1') return send(201, { error: 'NO_SUCH_TASK' });
        if (sim.mode === 'fail') return send(201, { jobs: [{ uuid: 'j1', status: 'Done' }, { uuid: 'j2', status: 'Failed' }] });
        const st = sim.polls === 1 ? ['Waiting', 'Waiting'] : sim.polls === 2 ? ['Done', 'Generating'] : ['Done', 'Done'];
        return send(201, { jobs: st.map((s, i) => ({ uuid: 'j' + (i + 1), status: s })) });
      }
      if (url === '/rodin/api/v2/download') {
        if (call.json?.task_uuid !== '123e4567-e89b-12d3-a456-426614174000') return send(201, { error: 'NO_SUCH_TASK' });
        return send(201, { list: [{ url: `${base}/files/preview.webp`, name: 'preview.webp' }, { url: `${base}/files/model.glb`, name: 'base_basic_shaded.glb' }] });
      }
    }
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, { MESHY_API_KEY: 'msy_test', MESHY_BASE_URL: base + '/meshy', MESHY_DOWNLOAD_HOSTS: '127.0.0.1', RODIN_API_KEY: 'rdn_test', RODIN_BASE_URL: base + '/rodin/api/v2', RODIN_DOWNLOAD_HOSTS: '127.0.0.1', SAFE_FETCH_TEST_HOSTS: '127.0.0.1' });
});
after(() => { server.close(); for (const k of ['MESHY_API_KEY', 'MESHY_BASE_URL', 'MESHY_DOWNLOAD_HOSTS', 'RODIN_API_KEY', 'RODIN_BASE_URL', 'RODIN_DOWNLOAD_HOSTS']) delete process.env[k]; });
beforeEach(() => { sim.mode = 'ok'; sim.calls.length = 0; sim.polls = 0; });

describe('Meshy adapter (simulated Meshy API)', () => {
  test('text-to-3D: one paid preview task → progress → GLB → STL at the asked size, by the real engine', async () => {
    const repo = new MemoryRepo();
    const job = repo.add({ provider: 'MESHY', input: { prompt: 'a decorative vase with spiral ribs', userFields: {}, targetLongestMm: 90 } });
    await runOnce(deps(repo, { MESHY: fast(new MeshyProvider()) }, new PythonEngine()), 'w1');
    const j = repo.jobs.get(job.id)!;
    assert.equal(j.status, 'REVIEW_REQUIRED', j.errorMessage ?? '');
    const posts = sim.calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1, 'exactly one paid submission');
    assert.deepEqual([posts[0].url, posts[0].auth, posts[0].json.mode, posts[0].json.target_formats], ['/meshy/openapi/v2/text-to-3d', 'Bearer msy_test', 'preview', ['glb']]);
    assert.equal(j.externalTaskId, 't:0193-task'); assert.equal(j.costCredits, 20);
    const md = repo.revisions.get(job.revisionId)!.model!.metadata;
    assert.equal(Math.max(md.size_mm!.x, md.size_mm!.y, md.size_mm!.z), 90);
  });

  test('image-to-3D: the image is checked by content and sent untextured to the image endpoint', async () => {
    const p = new MeshyProvider();
    const s = await p.start({ jobId: 'j', prompt: '', userFields: {}, referenceImageDataUrl: PNG });
    assert.deepEqual(s, { kind: 'pending', externalTaskId: 'i:0193-task', model: 'meshy:latest:image' });
    assert.equal(sim.calls[0].url, '/meshy/openapi/v1/image-to-3d');
    assert.equal(sim.calls[0].json.should_texture, false); assert.equal(sim.calls[0].json.image_url, PNG);
    await assert.rejects(p.start({ jobId: 'j', prompt: '', userFields: {}, referenceImageDataUrl: PNG.replace('image/png', 'image/jpeg') }), /declared image\/jpeg but the content is png/);
    assert.equal(sim.calls.length, 1, 'a refused image costs nothing');
  });

  test('errors map to the payment-safe policy: 402 credits, 429 retry, 400 refused, 5xx outcome unknown', async () => {
    const p = new MeshyProvider(), go = () => p.start({ jobId: 'j', prompt: 'x', userFields: {} });
    sim.mode = '402'; await assert.rejects(go(), (e: ProviderError) => e.code === 'INSUFFICIENT_CREDIT' && !e.taskMayExist);
    sim.mode = '429'; await assert.rejects(go(), (e: ProviderError) => e.code === 'TRANSIENT' && e.retryable && !e.taskMayExist);
    sim.mode = '400'; await assert.rejects(go(), (e: ProviderError) => e.code === 'REJECTED' && /prompt is required/.test(e.message));
    sim.mode = '500'; await assert.rejects(go(), (e: ProviderError) => e.code === 'TRANSIENT' && !e.retryable && e.taskMayExist);
    await assert.rejects(p.start({ jobId: 'j', prompt: 'y'.repeat(801), userFields: {} }), /800 characters/);
    sim.mode = 'fail';
    assert.deepEqual(await p.poll('t:0193-task'), { state: 'failed', error: 'Moderation: prompt refused', creditsConsumed: 0 });
  });

  test('an unknown submission outcome is never resubmitted by the worker, even when re-queued', async () => {
    sim.mode = '500';
    const repo = new MemoryRepo();
    const job = repo.add({ provider: 'MESHY', input: { prompt: 'x', userFields: {}, targetLongestMm: 50 } });
    const p = fast(new MeshyProvider());
    await runOnce(deps(repo, { MESHY: p }, null), 'w1');
    assert.equal(repo.jobs.get(job.id)!.status, 'FAILED');
    repo.jobs.get(job.id)!.status = 'QUEUED';
    await runOnce(deps(repo, { MESHY: p }, null), 'w1');
    assert.equal(sim.calls.filter((c) => c.method === 'POST').length, 1);
    assert.match(repo.jobs.get(job.id)!.errorMessage!, /not resent/);
  });
});

describe('Rodin adapter (simulated Hyper3D API)', () => {
  test('image-to-3D: multipart submit → Waiting/Generating/Done → download list → GLB → STL by the real engine', async () => {
    const repo = new MemoryRepo();
    const job = repo.add({ provider: 'RODIN', input: { prompt: 'a small robot figurine', userFields: {}, targetLongestMm: 60, referenceImageDataUrl: PNG } });
    await runOnce(deps(repo, { RODIN: fast(new RodinProvider()) }, new PythonEngine()), 'w1');
    const j = repo.jobs.get(job.id)!;
    assert.equal(j.status, 'REVIEW_REQUIRED', j.errorMessage ?? '');
    const submit = sim.calls.find((c) => c.url === '/rodin/api/v2/rodin')!;
    assert.equal(submit.auth, 'Bearer rdn_test');
    assert.deepEqual([submit.form!.tier, submit.form!.geometry_file_format, submit.form!.material, (submit.form!.images as any).type], ['Gen-2.5-Medium', 'glb', 'None', 'image/png']);
    assert.equal(sim.calls.filter((c) => c.url === '/rodin/api/v2/rodin').length, 1, 'exactly one paid submission');
    assert.equal(j.externalTaskId, '123e4567-e89b-12d3-a456-426614174000|sub-key-1');
    assert.equal(sim.calls.find((c) => c.url === '/rodin/api/v2/download')!.json.task_uuid, '123e4567-e89b-12d3-a456-426614174000');
    const md = repo.revisions.get(job.revisionId)!.model!.metadata;
    assert.equal(Math.max(md.size_mm!.x, md.size_mm!.y, md.size_mm!.z), 60);
  });

  test('an error inside an HTTP 201 is a refusal; a 5xx leaves the outcome unknown; a failed job fails the task', async () => {
    const p = new RodinProvider(), go = () => p.start({ jobId: 'j', prompt: 'x', userFields: {} });
    sim.mode = 'rodin201error'; await assert.rejects(go(), (e: ProviderError) => e.code === 'REJECTED' && /INVALID_REQUEST/.test(e.message) && !e.taskMayExist);
    sim.mode = '500'; await assert.rejects(go(), (e: ProviderError) => e.code === 'TRANSIENT' && e.taskMayExist);
    sim.mode = 'ok';
    const s = await go();
    assert.equal(s.kind, 'pending');
    assert.equal(sim.calls.at(-1)!.form!.prompt, 'x');
    sim.mode = 'fail'; sim.polls = 0;
    assert.equal((await p.poll('123e4567-e89b-12d3-a456-426614174000|sub-key-1')).state, 'failed');
    assert.deepEqual(await p.poll('123e4567-e89b-12d3-a456-426614174000|other'), { state: 'failed', error: 'Rodin has no such task' });
  });
});
