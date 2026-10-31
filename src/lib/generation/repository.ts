// =====================================================================
// Persistence contract used by the generation worker.
// The Prisma implementation lives in prisma-repository.ts; tests use an
// in-memory implementation, so the worker's logic is verified without a DB.
// =====================================================================

import type { EngineMetadata } from './engine-client.ts';
import type { GenerationInput, ProviderId } from './provider.ts';
import type { GenerationState } from './states.ts';

export interface JobRecord {
  id: string;
  status: GenerationState;
  provider: ProviderId;
  input: Omit<GenerationInput, 'jobId'>;
  externalTaskId: string | null;
  attempts: number;
  maxAttempts: number;
  projectId: string;
  projectName: string;
  revisionId: string;
  ownerId: string;
}

export interface JobPatch {
  progress?: number;
  stage?: string | null;
  errorMessage?: string | null;
  externalTaskId?: string | null;
  provider?: ProviderId;
  providerModel?: string | null;
  attempts?: number;
  nextAttemptAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  costCredits?: number | null;
  resultJson?: string | null;
}

export type AttemptStatus = 'SUBMITTING' | 'ACCEPTED' | 'SUCCEEDED' | 'FAILED' | 'TASK_FAILED';

export interface AttemptPatch {
  status: AttemptStatus;
  externalTaskId?: string;
  errorCode?: string;
  errorMessage?: string;
  creditsConsumed?: number;
  taskMayExist?: boolean;
}

export interface CompletedModel {
  stlUrl: string;
  stlSha256: string;
  stlBytes: number;
  sourceUrl: string | null;
  metadata: EngineMetadata;
}

export interface GenerationRepository {
  /** Atomically lock the next due job (or a job whose worker died) for this worker. */
  claimNext(workerId: string, now: Date, staleAfterMs: number): Promise<JobRecord | null>;
  /** Compare-and-set status change; throws StateConflict if the row is no longer in `from` (e.g. cancelled). */
  transition(jobId: string, from: GenerationState, to: GenerationState, patch?: JobPatch): Promise<void>;
  update(jobId: string, patch: JobPatch): Promise<void>;
  release(jobId: string): Promise<void>;
  startAttempt(jobId: string, provider: ProviderId): Promise<string>;
  finishAttempt(attemptId: string, patch: AttemptPatch): Promise<void>;
  /** True if an earlier submission never got an answer — resubmitting could create a duplicate paid task. */
  hasUnresolvedSubmission(jobId: string): Promise<boolean>;
  completeRevision(job: JobRecord, model: CompletedModel): Promise<void>;
  failRevision(job: JobRecord, message: string): Promise<void>;
  notify(userId: string, n: { type: string; title: string; message: string; link?: string }): Promise<void>;
}

export class StateConflict extends Error {
  constructor(jobId: string, expected: string, actual: string) {
    super(`job ${jobId} is ${actual}, expected ${expected}`);
    this.name = 'StateConflict';
  }
}
