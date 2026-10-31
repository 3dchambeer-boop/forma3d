// =====================================================================
// Meshy (https://docs.meshy.ai): text-to-3D (preview = geometry only) and image-to-3D (untextured).
// API as documented (checked 2026-10-30):
//   POST /openapi/v2/text-to-3d   {mode:"preview", prompt<=800, ai_model, target_formats}      -> {result: task id}
//   GET  /openapi/v2/text-to-3d/:id                                                          -> {status, progress, model_urls, task_error, consumed_credits}
//   POST /openapi/v1/image-to-3d  {image_url: data URI (jpg/png/webp <= 20 MB), should_texture:false, target_formats}
//   GET  /openapi/v1/image-to-3d/:id
//   status: PENDING | IN_PROGRESS | SUCCEEDED | FAILED | CANCELED;  errors: 400, 401, 402 (credits), 429
// Auth: Authorization: Bearer MESHY_API_KEY (server only). Geometry is taken as GLB (glTF: metres, +Y up); the
// engine converts it and applies the size the customer asked for.
// A submission whose outcome is unknown (network error or 5xx after sending) may have created a paid task: it is
// never resubmitted automatically (taskMayExist), the same policy as Tripo.
// =====================================================================

import { validateImageDataUrl } from '../../security/file-validation.ts';
import { ProviderError, isTransientHttpStatus } from '../errors.ts';
import type { DownloadedOutput, GenerationInput, ModelGenerationProvider, PollResult, StartResult } from '../provider.ts';
import { safeDownload } from '../safe-fetch.ts';

const cfg = () => ({
  key: process.env.MESHY_API_KEY || '',
  base: (process.env.MESHY_BASE_URL || 'https://api.meshy.ai').replace(/\/+$/, ''),
  model: process.env.MESHY_AI_MODEL || 'latest',
  hosts: (process.env.MESHY_DOWNLOAD_HOSTS || 'meshy.ai').split(',').map((s) => s.trim()).filter(Boolean),
});

// the task id carries which endpoint it belongs to: "t:<id>" text-to-3d, "i:<id>" image-to-3d
const path = (kind: 't' | 'i') => (kind === 't' ? '/openapi/v2/text-to-3d' : '/openapi/v1/image-to-3d');

export class MeshyProvider implements ModelGenerationProvider {
  readonly id = 'MESHY' as const;
  readonly paid = true;
  readonly pollIntervalMs = 5000;
  constructor(private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init)) {}

  configured() {
    return cfg().key ? ({ ok: true } as const) : ({ ok: false, reason: 'MESHY_API_KEY is not set' } as const);
  }

  private async call(method: 'GET' | 'POST', p: string, body?: unknown): Promise<Response> {
    const c = cfg();
    if (!c.key) throw new ProviderError('NOT_CONFIGURED', 'MESHY_API_KEY is not set');
    return this.fetchImpl(c.base + p, {
      method,
      headers: { authorization: `Bearer ${c.key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  }

  async start(input: GenerationInput): Promise<StartResult> {
    const c = cfg();
    let kind: 't' | 'i' = 't', body: Record<string, unknown>;
    if (input.referenceImageDataUrl) {
      const v = validateImageDataUrl(input.referenceImageDataUrl, { maxBytes: 20 * 1024 * 1024, maxPixels: 40e6 });
      if (!v.ok) throw new ProviderError('REJECTED', `reference image refused: ${v.message}`);
      kind = 'i';
      body = { image_url: input.referenceImageDataUrl, ai_model: c.model, should_texture: false, target_formats: ['glb'] };
    } else {
      if (input.prompt.length > 800) throw new ProviderError('REJECTED', 'Meshy prompts are limited to 800 characters');
      body = { mode: 'preview', prompt: input.prompt, ai_model: c.model, target_formats: ['glb'] }; // preview = geometry
    }
    let res: Response;
    try {
      res = await this.call('POST', path(kind), body);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError('TRANSIENT', `Meshy submission outcome unknown: ${(e as Error).message}`, false, true);
    }
    const j = (await res.json().catch(() => ({}))) as { result?: string; message?: string };
    if (res.status === 402) throw new ProviderError('INSUFFICIENT_CREDIT', `Meshy: ${j.message || 'insufficient credits'}`);
    if (res.status === 401) throw new ProviderError('NOT_CONFIGURED', 'Meshy rejected the API key');
    if (res.status === 429) throw new ProviderError('TRANSIENT', 'Meshy rate limit; no task was created', true, false);
    if (!res.ok) {
      // a 4xx means the request was refused (no task); a 5xx after sending leaves the outcome unknown
      if (isTransientHttpStatus(res.status)) throw new ProviderError('TRANSIENT', `Meshy submission outcome unknown (HTTP ${res.status})`, false, true);
      throw new ProviderError('REJECTED', `Meshy refused the request: ${j.message || 'HTTP ' + res.status}`);
    }
    if (!j.result) throw new ProviderError('TRANSIENT', 'Meshy accepted the request but returned no task id', false, true);
    return { kind: 'pending', externalTaskId: `${kind}:${j.result}`, model: `meshy:${c.model}${kind === 'i' ? ':image' : ''}` };
  }

  async poll(externalTaskId: string): Promise<PollResult> {
    const [kind, id] = externalTaskId.split(/:(.*)/s) as ['t' | 'i', string];
    if ((kind !== 't' && kind !== 'i') || !id) throw new ProviderError('REJECTED', `not a Meshy task id: ${externalTaskId}`);
    let res: Response;
    try {
      res = await this.call('GET', `${path(kind)}/${encodeURIComponent(id)}`);
    } catch (e) {
      throw new ProviderError('TRANSIENT', `Meshy status query failed: ${(e as Error).message}`, true, true);
    }
    if (!res.ok) throw new ProviderError('TRANSIENT', `Meshy status query HTTP ${res.status}`, true, true);
    const t = (await res.json().catch(() => null)) as { status?: string; progress?: number; model_urls?: Record<string, string>; task_error?: { message?: string }; consumed_credits?: number } | null;
    if (!t || !t.status) throw new ProviderError('TRANSIENT', 'Meshy returned an unreadable status', true, true);
    if (t.status === 'SUCCEEDED') return { state: 'succeeded', progress: 100, outputUrl: t.model_urls?.glb, creditsConsumed: t.consumed_credits };
    if (t.status === 'FAILED' || t.status === 'CANCELED') return { state: 'failed', error: t.task_error?.message || `Meshy task ${t.status.toLowerCase()}`, creditsConsumed: t.consumed_credits ?? 0 };
    if (t.status === 'PENDING' || t.status === 'IN_PROGRESS') return { state: 'pending', progress: typeof t.progress === 'number' ? t.progress : undefined };
    throw new ProviderError('TRANSIENT', `Meshy returned an unknown status "${t.status}"`, true, true);
  }

  async download(poll: PollResult): Promise<DownloadedOutput> {
    if (!poll.outputUrl) throw new ProviderError('TASK_FAILED', 'Meshy reported success without a GLB model URL', false, true);
    const data = await safeDownload(poll.outputUrl, { allowedHostSuffixes: cfg().hosts, maxBytes: 150 * 1024 * 1024 });
    return { data, filename: 'meshy-output.glb', sourceUnits: 'm', upAxis: 'y' };
  }
}
