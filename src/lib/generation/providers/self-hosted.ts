// =====================================================================
// SelfHostedProvider — the platform's own open-weights inference service.
//
// Contract (documented in docs/SELF_HOSTED_AI.md; any model server can
// implement it):
//   POST {SELF_HOSTED_INFERENCE_URL}/v1/text-to-3d  {prompt, negative_prompt}
//        → 202 {"task_id": "..."}
//   GET  {SELF_HOSTED_INFERENCE_URL}/v1/tasks/{id}
//        → {"status": "queued|running|succeeded|failed", "progress": 0-100,
//           "output_url": "/v1/tasks/{id}/output.glb", "error": "..."}
//   GET  output_url (relative to the service) → GLB bytes
// Authentication: "Authorization: Bearer {SELF_HOSTED_INFERENCE_TOKEN}".
//
// The service runs on infrastructure we control, so its URL comes from server
// configuration only; output URLs must stay on that same origin.
// =====================================================================

import { ProviderError, isTransientHttpStatus } from '../errors.ts';
import type { DownloadedOutput, GenerationInput, ModelGenerationProvider, PollResult, StartResult } from '../provider.ts';

export class SelfHostedProvider implements ModelGenerationProvider {
  readonly id = 'SELF_HOSTED' as const;
  readonly paid = false;
  readonly pollIntervalMs = 3000;

  private get base(): string | null {
    return process.env.SELF_HOSTED_INFERENCE_URL?.replace(/\/$/, '') || null;
  }

  configured() {
    if (!this.base) return { ok: false, reason: 'SELF_HOSTED_INFERENCE_URL is not set' } as const;
    if (!process.env.SELF_HOSTED_INFERENCE_TOKEN) return { ok: false, reason: 'SELF_HOSTED_INFERENCE_TOKEN is not set' } as const;
    return { ok: true } as const;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const base = this.base;
    if (!base) throw new ProviderError('NOT_CONFIGURED', 'SELF_HOSTED_INFERENCE_URL is not set');
    const url = new URL(path, base + '/');
    if (url.origin !== new URL(base).origin) throw new ProviderError('UNSAFE_URL', 'self-hosted output must stay on the inference origin');
    try {
      return await fetch(url, {
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${process.env.SELF_HOSTED_INFERENCE_TOKEN ?? ''}` },
        signal: AbortSignal.timeout(60_000),
        redirect: 'error',
      });
    } catch (e) {
      throw new ProviderError('TRANSIENT', `self-hosted inference unreachable: ${(e as Error).message}`, true);
    }
  }

  async start(input: GenerationInput): Promise<StartResult> {
    const res = await this.call('v1/text-to-3d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: input.prompt, negative_prompt: input.negativePrompt ?? null, job_id: input.jobId }),
    });
    if (!res.ok) {
      const transient = isTransientHttpStatus(res.status);
      throw new ProviderError(transient ? 'TRANSIENT' : 'REJECTED', `self-hosted submit HTTP ${res.status}`, transient);
    }
    const body = (await res.json()) as { task_id?: string; model?: string };
    if (!body.task_id) throw new ProviderError('REJECTED', 'self-hosted service returned no task_id');
    return { kind: 'pending', externalTaskId: body.task_id, model: body.model ?? 'self-hosted' };
  }

  async poll(taskId: string): Promise<PollResult> {
    const res = await this.call(`v1/tasks/${encodeURIComponent(taskId)}`);
    if (!res.ok) throw new ProviderError('TRANSIENT', `self-hosted status HTTP ${res.status}`, true, true);
    const b = (await res.json()) as { status: string; progress?: number; output_url?: string; error?: string };
    if (b.status === 'succeeded') return { state: 'succeeded', progress: 100, outputUrl: b.output_url };
    if (b.status === 'failed') return { state: 'failed', error: b.error ?? 'self-hosted generation failed' };
    return { state: 'pending', progress: typeof b.progress === 'number' ? b.progress : undefined };
  }

  async download(poll: PollResult): Promise<DownloadedOutput> {
    if (!poll.outputUrl) throw new ProviderError('TASK_FAILED', 'no output_url', false, true);
    const res = await this.call(poll.outputUrl);
    if (!res.ok) throw new ProviderError(res.status === 404 ? 'OUTPUT_EXPIRED' : 'DOWNLOAD_FAILED', `output HTTP ${res.status}`, true, true);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length === 0) throw new ProviderError('DOWNLOAD_FAILED', 'empty output', true, true);
    return { data, filename: 'self-hosted-output.glb', sourceUnits: 'm', upAxis: 'y' };
  }
}
