// In-memory GenerationRepository with the same compare-and-set semantics as the Prisma one.

import { randomUUID } from 'node:crypto';
import type {
  AttemptPatch, CompletedModel, GenerationRepository, JobPatch, JobRecord,
} from '../../../src/lib/generation/repository.ts';
import { StateConflict } from '../../../src/lib/generation/repository.ts';
import type { ProviderId } from '../../../src/lib/generation/provider.ts';
import type { GenerationState } from '../../../src/lib/generation/states.ts';

export type StoredJob = JobRecord & Omit<JobPatch, 'attempts' | 'provider' | 'externalTaskId'> & {
  lockedBy: string | null;
  history: GenerationState[];
};

export class MemoryRepo implements GenerationRepository {
  jobs = new Map<string, StoredJob>();
  attempts = new Map<string, { jobId: string; provider: ProviderId } & Partial<AttemptPatch>>();
  revisions = new Map<string, { status: string; model?: CompletedModel; failure?: string }>();
  notifications: { userId: string; type: string; message: string }[] = [];

  add(job: Partial<JobRecord> & Pick<JobRecord, 'provider' | 'input'>): StoredJob {
    const id = job.id ?? randomUUID();
    const rec: StoredJob = {
      id,
      status: 'QUEUED',
      externalTaskId: null,
      attempts: 0,
      maxAttempts: 3,
      projectId: 'proj1',
      projectName: 'Test project',
      revisionId: `rev-${id}`,
      ownerId: 'user1',
      lockedBy: null,
      history: ['QUEUED'],
      ...job,
    } as StoredJob;
    this.jobs.set(id, rec);
    this.revisions.set(rec.revisionId, { status: 'PROCESSING' });
    return rec;
  }

  async claimNext(workerId: string, now: Date): Promise<JobRecord | null> {
    for (const j of this.jobs.values()) {
      const due = !j.nextAttemptAt || j.nextAttemptAt <= now;
      if (j.status === 'QUEUED' && due && !j.lockedBy) {
        j.lockedBy = workerId;
        return { ...j };
      }
    }
    return null;
  }

  async transition(jobId: string, from: GenerationState, to: GenerationState, patch: JobPatch = {}) {
    const j = this.jobs.get(jobId)!;
    if (j.status !== from) throw new StateConflict(jobId, from, j.status);
    Object.assign(j, patch, { status: to });
    j.history.push(to);
  }

  async update(jobId: string, patch: JobPatch) {
    Object.assign(this.jobs.get(jobId)!, patch);
  }

  async release(jobId: string) {
    this.jobs.get(jobId)!.lockedBy = null;
  }

  async startAttempt(jobId: string, provider: ProviderId) {
    const id = randomUUID();
    this.attempts.set(id, { jobId, provider, status: 'SUBMITTING' });
    return id;
  }

  async finishAttempt(id: string, patch: AttemptPatch) {
    Object.assign(this.attempts.get(id)!, patch);
  }

  async hasUnresolvedSubmission(jobId: string) {
    return [...this.attempts.values()].some(
      (a) => a.jobId === jobId && (a.status === 'SUBMITTING' || (a.status === 'FAILED' && a.taskMayExist)),
    );
  }

  async completeRevision(job: JobRecord, model: CompletedModel) {
    this.revisions.set(job.revisionId, { status: 'REVIEW_REQUIRED', model });
  }

  async failRevision(job: JobRecord, message: string) {
    this.revisions.set(job.revisionId, { status: 'DRAFT', failure: message });
  }

  async notify(userId: string, n: { type: string; message: string }) {
    this.notifications.push({ userId, ...n });
  }

  attemptsFor(jobId: string) {
    return [...this.attempts.values()].filter((a) => a.jobId === jobId);
  }
}

export class MemoryStorage {
  files = new Map<string, Buffer>();
  async saveFile(kind: 'models', data: Buffer, ext: string, prefix = '') {
    const { createHash } = await import('node:crypto');
    const key = `${prefix}-${randomUUID()}.${ext}`;
    this.files.set(key, data);
    return { url: `/api/${kind}/${key}`, sha256: createHash('sha256').update(data).digest('hex'), sizeBytes: data.length };
  }
}
