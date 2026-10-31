// =====================================================================
// TripoProvider — free-form text-to-3D through the existing Tripo adapter.
// Best for artistic/organic shapes; it does not guarantee millimetre
// dimensions, so the requested size is applied by the engine and recorded.
// =====================================================================

import { createImageToModelTask, createTextToModelTask, getTaskStatus, isTripoConfigured, TripoError, uploadImageFile } from '../../tripo.ts';
import { validateImageDataUrl } from '../../security/file-validation.ts';
import { ProviderError } from '../errors.ts';
import type { DownloadedOutput, GenerationInput, ModelGenerationProvider, PollResult, StartResult } from '../provider.ts';
import { safeDownload } from '../safe-fetch.ts';

const MODEL = 'v3.0-20250812';

function downloadHosts(): string[] {
  return (process.env.TRIPO_DOWNLOAD_HOSTS || 'tripo3d.ai,tripo3d.com')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
}

export class TripoProvider implements ModelGenerationProvider {
  readonly id = 'TRIPO' as const;
  readonly paid = true;
  readonly pollIntervalMs = 4000; // Tripo recommends polling no faster than every 2 s

  configured() {
    return isTripoConfigured() ? ({ ok: true } as const) : ({ ok: false, reason: 'TRIPO_API_KEY is not set' } as const);
  }

  async start(input: GenerationInput): Promise<StartResult> {
    let image: { buf: Buffer; ext: string } | null = null;
    if (input.referenceImageDataUrl) {
      const v = validateImageDataUrl(input.referenceImageDataUrl, { maxBytes: 20 * 1024 * 1024, maxPixels: 40e6 });
      if (!v.ok) throw new ProviderError('REJECTED', `reference image refused: ${v.message}`);
      image = { buf: v.bytes!, ext: v.kind === 'jpeg' ? 'jpg' : v.kind };
    }
    try {
      if (image) {
        // uploading the image creates no billable task; the image-to-model call does
        const token = await uploadImageFile(image.buf, `reference.${image.ext}`);
        const created = await createImageToModelTask({ input: token, model: MODEL, texture: false, pbr: false, faceLimit: 50000, autoSize: true });
        return { kind: 'pending', externalTaskId: created.taskId, model: `${MODEL}:image` };
      }
      const created = await createTextToModelTask({
        prompt: input.prompt.slice(0, 1024), // provider limit (documented in worklog)
        negativePrompt: input.negativePrompt?.slice(0, 255) || undefined,
        model: MODEL,
        texture: false, // geometry only: textures are irrelevant for printing
        pbr: false,
        faceLimit: 50000,
        autoSize: true,
      });
      return { kind: 'pending', externalTaskId: created.taskId, model: MODEL };
    } catch (e) {
      if (e instanceof TripoError) {
        if (e.code === 'INSUFFICIENT_CREDIT') throw new ProviderError('INSUFFICIENT_CREDIT', e.message);
        if (e.code === 'NO_API_KEY') throw new ProviderError('NOT_CONFIGURED', e.message);
        if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500 && e.statusCode !== 408 && e.statusCode !== 429) {
          throw new ProviderError('REJECTED', e.message, false, false, e.raw);
        }
      }
      // Network failure or 5xx after sending: Tripo may have created (and billed) a task.
      // Never resubmit automatically; the job fails with an explicit message instead.
      throw new ProviderError(
        'TRANSIENT',
        `Tripo submission outcome unknown: ${(e as Error).message}`,
        false,
        true,
      );
    }
  }

  async poll(taskId: string): Promise<PollResult> {
    let s;
    try {
      s = await getTaskStatus(taskId);
    } catch (e) {
      throw new ProviderError('TRANSIENT', `Tripo status query failed: ${(e as Error).message}`, true, true);
    }
    if (s.status === 'success') {
      return { state: 'succeeded', progress: 100, outputUrl: s.modelUrl, creditsConsumed: s.creditsConsumed };
    }
    if (s.status === 'failed' || s.status === 'cancelled') {
      return { state: 'failed', error: s.errorMessage || `Tripo task ${s.status}`, creditsConsumed: s.creditsConsumed };
    }
    if (s.status === 'unknown') {
      throw new ProviderError('TRANSIENT', `Tripo returned an unreadable status: ${s.errorMessage ?? ''}`, true, true);
    }
    return { state: 'pending', progress: s.progress };
  }

  async download(poll: PollResult): Promise<DownloadedOutput> {
    if (!poll.outputUrl) throw new ProviderError('TASK_FAILED', 'Tripo reported success without a model URL', false, true);
    const data = await safeDownload(poll.outputUrl, {
      allowedHostSuffixes: downloadHosts(),
      maxBytes: 150 * 1024 * 1024,
    });
    // glTF is metres, +Y up (glTF 2.0 spec). The engine converts and the user's size is applied explicitly.
    return { data, filename: 'tripo-output.glb', sourceUnits: 'm', upAxis: 'y' };
  }
}
