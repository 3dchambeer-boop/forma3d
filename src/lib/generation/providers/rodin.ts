// =====================================================================
// Hyper3D Rodin (https://docs.hyper3d.ai): text-to-3D and image-to-3D.
// API as documented (checked 2026-10-30), base https://api.hyper3d.com/api/v2, Authorization: Bearer RODIN_API_KEY:
//   POST /rodin     multipart: prompt (<= 1024) and/or images (1-5 files), tier, geometry_file_format, material, quality
//                   -> 201 {error?, message, uuid, jobs: {uuids, subscription_key}}   (an error can come with HTTP 201)
//   POST /status    {subscription_key} -> 201 {error?, jobs: [{uuid, status: Waiting|Generating|Done|Failed}]}
//   POST /download  {task_uuid}        -> 201 {error?, list: [{url, name}]}           (links expire: fetch promptly)
// The task id stored here is "<uuid>|<subscription_key>". Geometry is taken as GLB (metres, +Y up), untextured.
// Unknown submission outcomes are never resubmitted (taskMayExist), as for Tripo and Meshy.
// =====================================================================

import { validateImageDataUrl } from '../../security/file-validation.ts';
import { ProviderError, isTransientHttpStatus } from '../errors.ts';
import type { DownloadedOutput, GenerationInput, ModelGenerationProvider, PollResult, StartResult } from '../provider.ts';
import { safeDownload } from '../safe-fetch.ts';

const cfg = () => ({
  key: process.env.RODIN_API_KEY || '',
  base: (process.env.RODIN_BASE_URL || 'https://api.hyper3d.com/api/v2').replace(/\/+$/, ''),
  tier: process.env.RODIN_TIER || 'Gen-2.5-Medium',
  // download links are served from Hyper3D's file hosts; confirm on the first real run and adjust if needed
  hosts: (process.env.RODIN_DOWNLOAD_HOSTS || 'hyper3d.com,hyper3d.ai,deemos.com').split(',').map((s) => s.trim()).filter(Boolean),
});

export class RodinProvider implements ModelGenerationProvider {
  readonly id = 'RODIN' as const;
  readonly paid = true;
  readonly pollIntervalMs = 5000;
  constructor(private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {}

  configured() {
    return cfg().key ? ({ ok: true } as const) : ({ ok: false, reason: 'RODIN_API_KEY is not set' } as const);
  }

  private async post(p: string, body: FormData | Record<string, unknown>): Promise<Response> {
    const c = cfg();
    if (!c.key) throw new ProviderError('NOT_CONFIGURED', 'RODIN_API_KEY is not set');
    const isForm = body instanceof FormData;
    return this.fetchImpl(c.base + p, {
      method: 'POST',
      headers: { authorization: `Bearer ${c.key}`, ...(isForm ? {} : { 'content-type': 'application/json' }) },
      body: isForm ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  }

  async start(input: GenerationInput): Promise<StartResult> {
    const c = cfg();
    const form = new FormData();
    if (input.referenceImageDataUrl) {
      const v = validateImageDataUrl(input.referenceImageDataUrl, { maxBytes: 20 * 1024 * 1024, maxPixels: 40e6 });
      if (!v.ok) throw new ProviderError('REJECTED', `reference image refused: ${v.message}`);
      form.append('images', new Blob([new Uint8Array(v.bytes!)], { type: `image/${v.kind}` }), `reference.${v.kind === 'jpeg' ? 'jpg' : v.kind}`);
      if (input.prompt) form.append('prompt', input.prompt.slice(0, 1024));
    } else {
      if (input.prompt.length > 1024) throw new ProviderError('REJECTED', 'Rodin prompts are limited to 1024 characters');
      form.append('prompt', input.prompt);
    }
    form.append('tier', c.tier);
    form.append('geometry_file_format', 'glb');
    form.append('material', 'None'); // geometry only: printing ignores textures
    form.append('quality', 'medium');
    let res: Response;
    try {
      res = await this.post('/rodin', form);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError('TRANSIENT', `Rodin submission outcome unknown: ${(e as Error).message}`, false, true);
    }
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string; uuid?: string; jobs?: { subscription_key?: string } };
    if (res.status === 401) throw new ProviderError('NOT_CONFIGURED', 'Rodin rejected the API key');
    if (res.status === 429) throw new ProviderError('TRANSIENT', 'Rodin throttled the request; no task was created', true, false);
    if (!res.ok) {
      if (isTransientHttpStatus(res.status)) throw new ProviderError('TRANSIENT', `Rodin submission outcome unknown (HTTP ${res.status})`, false, true);
      throw new ProviderError('REJECTED', `Rodin refused the request: ${j.message || j.error || 'HTTP ' + res.status}`);
    }
    // documented: accepted only when error is empty and uuid is set (an error may arrive with HTTP 201)
    if (j.error) {
      if (/credit|balance|insufficient/i.test(`${j.error} ${j.message ?? ''}`)) throw new ProviderError('INSUFFICIENT_CREDIT', `Rodin: ${j.message || j.error}`);
      throw new ProviderError('REJECTED', `Rodin refused the request: ${j.error}${j.message ? ' — ' + j.message : ''}`);
    }
    if (!j.uuid || !j.jobs?.subscription_key) throw new ProviderError('TRANSIENT', 'Rodin returned no task id', false, true);
    return { kind: 'pending', externalTaskId: `${j.uuid}|${j.jobs.subscription_key}`, model: `rodin:${c.tier}${input.referenceImageDataUrl ? ':image' : ''}` };
  }

  async poll(externalTaskId: string): Promise<PollResult> {
    const [uuid, key] = externalTaskId.split('|');
    if (!uuid || !key) throw new ProviderError('REJECTED', `not a Rodin task id: ${externalTaskId}`);
    let res: Response;
    try {
      res = await this.post('/status', { subscription_key: key });
    } catch (e) {
      throw new ProviderError('TRANSIENT', `Rodin status query failed: ${(e as Error).message}`, true, true);
    }
    if (!res.ok) throw new ProviderError('TRANSIENT', `Rodin status query HTTP ${res.status}`, true, true);
    const s = (await res.json().catch(() => null)) as { error?: string; message?: string; jobs?: { status?: string }[] } | null;
    if (!s) throw new ProviderError('TRANSIENT', 'Rodin returned an unreadable status', true, true);
    if (s.error === 'NO_SUCH_TASK') return { state: 'failed', error: 'Rodin has no such task' };
    if (s.error) throw new ProviderError('TRANSIENT', `Rodin status error ${s.error}`, true, true);
    const jobs = s.jobs ?? [];
    if (!jobs.length) return { state: 'pending' };
    const st = jobs.map((x) => x.status);
    if (st.some((x) => x === 'Failed')) return { state: 'failed', error: s.message || 'Rodin job failed' };
    if (st.every((x) => x === 'Done')) return { state: 'succeeded', progress: 100 };
    if (st.every((x) => x === 'Done' || x === 'Waiting' || x === 'Generating')) return { state: 'pending' }; // Rodin reports no percentage
    throw new ProviderError('TRANSIENT', `Rodin returned an unknown job status "${st.join(',')}"`, true, true);
  }

  async download(_poll: PollResult, externalTaskId: string): Promise<DownloadedOutput> {
    const [uuid] = externalTaskId.split('|');
    let res: Response;
    try {
      res = await this.post('/download', { task_uuid: uuid });
    } catch (e) {
      throw new ProviderError('DOWNLOAD_FAILED', `Rodin download list failed: ${(e as Error).message}`, true, true);
    }
    const j = (await res.json().catch(() => ({}))) as { error?: string; list?: { url?: string; name?: string }[] };
    if (!res.ok || j.error) throw new ProviderError('DOWNLOAD_FAILED', `Rodin download list: ${j.error || 'HTTP ' + res.status}`, res.status >= 500, true);
    const item = (j.list ?? []).find((x) => x.url && /\.glb$/i.test(x.name || ''));
    if (!item) throw new ProviderError('TASK_FAILED', 'Rodin finished without a GLB file', false, true);
    // links are fetched right away (they expire); the download list is asked for again on a retry
    const data = await safeDownload(item.url!, { allowedHostSuffixes: cfg().hosts, maxBytes: 150 * 1024 * 1024 });
    return { data, filename: 'rodin-output.glb', sourceUnits: 'm', upAxis: 'y' };
  }
}
