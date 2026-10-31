// =====================================================================
// Generation worker: drives one job through
//   QUEUED → GENERATING → (DOWNLOADING) → CONVERTING → VALIDATING → REVIEW_REQUIRED
//
// Rules that protect the user's money and data:
//   * a paid provider task is submitted at most once per job: the external
//     task id is persisted before anything else, and a submission whose
//     outcome is unknown is never retried automatically;
//   * transient failures (network, 5xx, 429) are retried with backoff on the
//     SAME step — polling and downloading resume the existing task;
//   * fallback to another provider happens only when no task can exist
//     (not configured / rejected before creation);
//   * the STL fetched from the engine must match the engine's SHA-256,
//     otherwise nothing is stored;
//   * progress is only what the provider reports — never invented.
// =====================================================================

import { createHash } from 'node:crypto';
import type { EngineClient, EngineJobResult } from './engine-client.ts';
import { ProviderError, asProviderError } from './errors.ts';
import type { GenerationInput, ModelGenerationProvider, PollResult, ProviderId, ProviderRegistry } from './provider.ts';
import { StateConflict, type GenerationRepository, type JobRecord } from './repository.ts';
import type { GenerationState } from './states.ts';
import { assertTransition } from './states.ts';

export interface FileSaver {
  saveFile(kind: 'models', data: Buffer, ext: string, prefix?: string): Promise<{ url: string; sha256: string; sizeBytes: number }>;
}

export interface WorkerDeps {
  repo: GenerationRepository;
  providers: ProviderRegistry;
  engine: EngineClient | null;
  storage: FileSaver;
  /** provider to try when the primary cannot have created a task */
  fallbacks?: Partial<Record<ProviderId, ProviderId>>;
  maxPollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class Job {
  status: GenerationState;
  constructor(readonly rec: JobRecord, private readonly deps: WorkerDeps) {
    this.status = rec.status;
  }
  async to(next: GenerationState, patch: Parameters<GenerationRepository['transition']>[3] = {}) {
    assertTransition(this.status, next);
    await this.deps.repo.transition(this.rec.id, this.status, next, { stage: next, ...patch });
    this.status = next;
  }
}

// staleAfterMs must exceed the longest silent step (polling window, default 15 min)
export async function runOnce(deps: WorkerDeps, workerId: string, staleAfterMs = 20 * 60_000): Promise<'idle' | 'processed'> {
  const now = deps.now?.() ?? new Date();
  const rec = await deps.repo.claimNext(workerId, now, staleAfterMs);
  if (!rec) return 'idle';
  try {
    await processJob(rec, deps);
  } finally {
    await deps.repo.release(rec.id).catch(() => undefined);
  }
  return 'processed';
}

export async function processJob(rec: JobRecord, deps: WorkerDeps): Promise<void> {
  const job = new Job(rec, deps);
  const log = deps.log ?? (() => undefined);
  const now = () => deps.now?.() ?? new Date();
  let providerId = rec.provider;
  const input: GenerationInput = { jobId: rec.id, ...rec.input };

  try {
    let engineResult: EngineJobResult | null = null;
    let directStl: Buffer | null = null; // providers that build the STL themselves (AI designer)
    let externalTaskId = rec.externalTaskId;
    let provider = deps.providers[providerId];
    let source: { data: Buffer; ext: string } | null = null;

    if (!externalTaskId) {
      if (await deps.repo.hasUnresolvedSubmission(rec.id)) {
        throw new ProviderError(
          'TASK_FAILED',
          'An earlier submission to the provider never returned a result. To avoid paying twice it was not resent; check the provider dashboard, then create a new generation.',
        );
      }
      // try the primary provider, then the configured fallback when no task can exist
      for (let hop = 0; ; hop++) {
        if (!provider) throw new ProviderError('NOT_CONFIGURED', `provider ${providerId} is not available`);
        const cfg = provider.configured();
        if (!cfg.ok) {
          const fb = deps.fallbacks?.[providerId];
          if (fb && hop === 0 && deps.providers[fb]?.configured().ok) {
            log('fallback (not configured)', { from: providerId, to: fb });
            providerId = fb;
            provider = deps.providers[fb];
            continue;
          }
          throw new ProviderError('NOT_CONFIGURED', `${providerId}: ${cfg.reason}`);
        }
        if (job.status !== 'GENERATING') {
          await job.to('GENERATING', { provider: providerId, startedAt: now(), attempts: rec.attempts + 1, errorMessage: null });
        }
        const attemptId = await deps.repo.startAttempt(rec.id, providerId);
        try {
          const started = await provider.start(input);
          if (started.kind === 'pending') {
            externalTaskId = started.externalTaskId;
            await deps.repo.finishAttempt(attemptId, { status: 'ACCEPTED', externalTaskId });
            await deps.repo.update(rec.id, { externalTaskId, providerModel: started.model, provider: providerId });
          } else {
            await deps.repo.finishAttempt(attemptId, { status: 'SUCCEEDED' });
            await deps.repo.update(rec.id, { providerModel: started.model, provider: providerId });
            if (started.kind === 'direct') {
              directStl = started.stl;
              engineResult = { artifactId: '', metadata: started.metadata };
            } else engineResult = started.engine;
          }
          break;
        } catch (e) {
          const pe = asProviderError(e, `${providerId} submit`);
          await deps.repo.finishAttempt(attemptId, {
            status: 'FAILED', errorCode: pe.code, errorMessage: pe.message, taskMayExist: pe.taskMayExist,
          });
          const fb = deps.fallbacks?.[providerId];
          const safeToSwitch = !pe.taskMayExist && (pe.code === 'REJECTED' || pe.code === 'NOT_CONFIGURED' || pe.code === 'INSUFFICIENT_CREDIT');
          if (fb && hop === 0 && safeToSwitch && deps.providers[fb]?.configured().ok) {
            log('fallback (rejected)', { from: providerId, to: fb, code: pe.code });
            providerId = fb;
            provider = deps.providers[fb];
            continue;
          }
          throw pe;
        }
      }
    } else if (job.status !== 'GENERATING') {
      await job.to('GENERATING', { attempts: rec.attempts + 1, errorMessage: null });
    }

    if (!engineResult) {
      // ---------------- asynchronous provider: poll → download → convert
      if (!provider?.poll || !provider.download || !externalTaskId) {
        throw new ProviderError('NOT_CONFIGURED', `provider ${providerId} cannot resume task ${externalTaskId}`);
      }
      const poll = await pollUntilDone(provider, externalTaskId, rec.id, deps);
      if (poll.state === 'failed') {
        throw new ProviderError('TASK_FAILED', poll.error ?? 'provider reported failure', false, true);
      }
      if (poll.creditsConsumed !== undefined) await deps.repo.update(rec.id, { costCredits: poll.creditsConsumed });
      await job.to('DOWNLOADING');
      let output;
      try {
        output = await provider.download(poll, externalTaskId);
      } catch (e) {
        if (e instanceof ProviderError && e.code === 'OUTPUT_EXPIRED') {
          log('output link expired; re-polling for a fresh link', { jobId: rec.id });
          output = await provider.download(await provider.poll(externalTaskId), externalTaskId);
        } else {
          throw e;
        }
      }
      source = { data: output.data, ext: output.filename.split('.').pop() || 'glb' };
      await job.to('CONVERTING');
      if (!deps.engine) throw new ProviderError('NOT_CONFIGURED', 'geometry engine is not configured; cannot convert to STL');
      engineResult = await deps.engine.processMesh(output.data, output.filename, {
        sourceUnits: output.sourceUnits,
        upAxis: output.upAxis,
        targetLongestMm: rec.input.targetLongestMm ?? null,
        constraints: rec.input.constraints,
      });
    } else {
      await job.to('CONVERTING');
    }

    // ---------------- validation result + storage
    await job.to('VALIDATING');
    let stl: Buffer;
    if (directStl) stl = directStl;
    else {
      if (!deps.engine) throw new ProviderError('NOT_CONFIGURED', 'geometry engine is not configured');
      stl = await deps.engine.fetchArtifact(engineResult.artifactId);
    }
    const digest = createHash('sha256').update(stl).digest('hex');
    if (digest !== engineResult.metadata.stl_sha256) {
      throw new ProviderError('ENGINE_ERROR', 'STL checksum mismatch between engine report and downloaded file', true);
    }
    const savedStl = await deps.storage.saveFile('models', stl, 'stl', rec.projectId);
    const savedSource = source && ['glb', 'obj', 'stl'].includes(source.ext)
      ? await deps.storage.saveFile('models', source.data, source.ext, `${rec.projectId}-src`)
      : null;
    await deps.repo.completeRevision(rec, {
      stlUrl: savedStl.url,
      stlSha256: savedStl.sha256,
      stlBytes: savedStl.sizeBytes,
      sourceUrl: savedSource?.url ?? null,
      metadata: engineResult.metadata,
    });
    await job.to('REVIEW_REQUIRED', {
      progress: 100,
      completedAt: now(),
      resultJson: JSON.stringify({
        status: engineResult.metadata.status,
        size_mm: engineResult.metadata.size_mm,
        triangles: engineResult.metadata.triangles,
        transforms: engineResult.metadata.transforms,
        stl_sha256: engineResult.metadata.stl_sha256,
      }),
    });
    await deps.repo.notify(rec.ownerId, {
      type: 'GENERATION_DONE',
      title: 'Model ready for review',
      message: `"${rec.projectName}": STL generated (${engineResult.metadata.status}). A designer will review it before printing.`,
      link: 'model_viewer',
    });
    log('job complete', { jobId: rec.id, status: engineResult.metadata.status });
  } catch (e) {
    if (e instanceof StateConflict) {
      log('job state changed underneath the worker (cancelled?)', { jobId: rec.id, error: e.message });
      return;
    }
    const pe = asProviderError(e, 'generation');
    const attempts = rec.attempts + 1;
    if (pe.retryable && attempts < rec.maxAttempts && job.status !== 'VALIDATING') {
      const delay = Math.min(15_000 * 2 ** (attempts - 1), 10 * 60_000);
      log('transient failure, will retry', { jobId: rec.id, code: pe.code, delay });
      await job.to('QUEUED', { errorMessage: `[${pe.code}] ${pe.message} — retry ${attempts}/${rec.maxAttempts - 1}`, nextAttemptAt: new Date(now().getTime() + delay) });
      return;
    }
    log('job failed', { jobId: rec.id, code: pe.code, message: pe.message });
    await deps.repo.transition(rec.id, job.status, 'FAILED', { stage: 'FAILED', errorMessage: `[${pe.code}] ${pe.message}`, completedAt: now() })
      .catch((err) => log('could not mark job failed', { error: String(err) }));
    await deps.repo.failRevision(rec, pe.message).catch(() => undefined);
    await deps.repo.notify(rec.ownerId, {
      type: 'SYSTEM',
      title: 'Generation failed',
      message: `"${rec.projectName}": ${pe.message}`,
      link: 'new_project',
    }).catch(() => undefined);
  }
}

async function pollUntilDone(provider: ModelGenerationProvider, taskId: string, jobId: string, deps: WorkerDeps): Promise<PollResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const deadline = Date.now() + (deps.maxPollMs ?? 15 * 60_000);
  let consecutiveErrors = 0;
  let lastProgress: number | undefined;
  while (Date.now() < deadline) {
    let r: PollResult;
    try {
      r = await provider.poll!(taskId);
      consecutiveErrors = 0;
    } catch (e) {
      const pe = asProviderError(e, 'poll');
      if (!pe.retryable || ++consecutiveErrors >= 5) throw pe;
      await sleep((provider.pollIntervalMs ?? 3000) * consecutiveErrors);
      continue;
    }
    if (r.state !== 'pending') return r;
    if (typeof r.progress === 'number' && r.progress !== lastProgress) {
      lastProgress = r.progress;
      await deps.repo.update(jobId, { progress: Math.max(0, Math.min(99, Math.round(r.progress))) });
    }
    await sleep(provider.pollIntervalMs ?? 3000);
  }
  // the task keeps running at the provider; a later retry resumes polling it
  throw new ProviderError('TIMEOUT', `provider task ${taskId} still running after polling window`, true, true);
}
