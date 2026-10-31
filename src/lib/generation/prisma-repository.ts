// =====================================================================
// Prisma implementation of GenerationRepository.
// Every status change is a compare-and-set (updateMany with the expected
// status in the WHERE clause), so two workers — or a worker and a user
// cancelling — can never both win.
// =====================================================================

import type { PrismaClient } from '@prisma/client';
import type { GenerationInput, ProviderId } from './provider.ts';
import {
  StateConflict,
  type AttemptPatch,
  type CompletedModel,
  type GenerationRepository,
  type JobPatch,
  type JobRecord,
} from './repository.ts';
import type { GenerationState } from './states.ts';

const IN_FLIGHT: GenerationState[] = ['GENERATING', 'DOWNLOADING', 'CONVERTING', 'VALIDATING'];

type JobRow = {
  id: string;
  status: string;
  provider: string;
  requestJson: string | null;
  textPrompt: string | null;
  externalTaskId: string | null;
  attempts: number;
  maxAttempts: number;
  projectId: string;
  revisionId: string | null;
  initiatedById: string;
  project: { name: string };
};

function toRecord(row: JobRow): JobRecord {
  const input = row.requestJson
    ? (JSON.parse(row.requestJson) as Omit<GenerationInput, 'jobId'>)
    : { prompt: row.textPrompt ?? '', userFields: {} };
  if (!row.revisionId) throw new Error(`generation job ${row.id} has no revision`);
  return {
    id: row.id,
    status: row.status as GenerationState,
    provider: row.provider as ProviderId,
    input,
    externalTaskId: row.externalTaskId,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    projectId: row.projectId,
    projectName: row.project.name,
    revisionId: row.revisionId,
    ownerId: row.initiatedById,
  };
}

function patchData(patch: JobPatch): Record<string, unknown> {
  const data: Record<string, unknown> = { ...patch };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  return data;
}

export class PrismaGenerationRepository implements GenerationRepository {
  constructor(private readonly db: PrismaClient) {}

  async claimNext(workerId: string, now: Date, staleAfterMs: number): Promise<JobRecord | null> {
    // 1) recover jobs whose worker died mid-flight: back to QUEUED (provider task id is kept,
    //    so the next run resumes polling instead of submitting again)
    await this.db.aIGenerationJob.updateMany({
      where: { status: { in: IN_FLIGHT }, lockedAt: { lt: new Date(now.getTime() - staleAfterMs) } },
      data: { status: 'QUEUED', stage: 'QUEUED', lockedBy: null, lockedAt: null, errorMessage: 'worker restarted; resuming' },
    });
    // 2) pick the oldest due job and lock it with a compare-and-set
    for (let i = 0; i < 5; i++) {
      const candidate = await this.db.aIGenerationJob.findFirst({
        where: { status: 'QUEUED', lockedBy: null, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!candidate) return null;
      const won = await this.db.aIGenerationJob.updateMany({
        where: { id: candidate.id, status: 'QUEUED', lockedBy: null },
        data: { lockedBy: workerId, lockedAt: now },
      });
      if (won.count === 1) {
        const row = await this.db.aIGenerationJob.findUniqueOrThrow({
          where: { id: candidate.id },
          include: { project: { select: { name: true } } },
        });
        return toRecord(row as unknown as JobRow);
      }
    }
    return null;
  }

  async transition(jobId: string, from: GenerationState, to: GenerationState, patch: JobPatch = {}) {
    const res = await this.db.aIGenerationJob.updateMany({
      where: { id: jobId, status: from },
      data: { ...patchData(patch), status: to, lockedAt: new Date() },
    });
    if (res.count !== 1) {
      const cur = await this.db.aIGenerationJob.findUnique({ where: { id: jobId }, select: { status: true } });
      throw new StateConflict(jobId, from, cur?.status ?? 'missing');
    }
  }

  async update(jobId: string, patch: JobPatch) {
    await this.db.aIGenerationJob.update({ where: { id: jobId }, data: { ...patchData(patch), lockedAt: new Date() } });
  }

  async release(jobId: string) {
    await this.db.aIGenerationJob.update({ where: { id: jobId }, data: { lockedBy: null, lockedAt: null } });
  }

  async startAttempt(jobId: string, provider: ProviderId) {
    const a = await this.db.generationProviderAttempt.create({ data: { jobId, provider, status: 'SUBMITTING' } });
    return a.id;
  }

  async finishAttempt(attemptId: string, patch: AttemptPatch) {
    await this.db.generationProviderAttempt.update({
      where: { id: attemptId },
      data: {
        status: patch.status,
        externalTaskId: patch.externalTaskId,
        errorCode: patch.errorCode,
        errorMessage: patch.errorMessage?.slice(0, 2000),
        taskMayExist: patch.taskMayExist ?? false,
        creditsConsumed: patch.creditsConsumed,
        finishedAt: new Date(),
      },
    });
  }

  async hasUnresolvedSubmission(jobId: string) {
    const n = await this.db.generationProviderAttempt.count({
      where: { jobId, OR: [{ status: 'SUBMITTING' }, { status: 'FAILED', taskMayExist: true }] },
    });
    return n > 0;
  }

  async completeRevision(job: JobRecord, m: CompletedModel) {
    const md = m.metadata;
    await this.db.$transaction([
      this.db.designRevision.update({
        where: { id: job.revisionId },
        data: {
          status: 'REVIEW_REQUIRED',
          modelUrl: m.stlUrl, // the viewer and slicer use the printable STL
          format: 'STL',
          stlUrl: m.stlUrl,
          stlSha256: m.stlSha256,
          sourceModelUrl: m.sourceUrl,
          validationStatus: md.status,
          validationReport: JSON.stringify(md.post_export_validation),
          specJson: md.spec ? JSON.stringify(md.spec) : null,
          faceCount: md.triangles,
          boundingBoxX: md.size_mm?.x ?? null,
          boundingBoxY: md.size_mm?.y ?? null,
          boundingBoxZ: md.size_mm?.z ?? null,
        },
      }),
      this.db.aIGenerationJob.update({ where: { id: job.id }, data: { outputModelUrl: m.stlUrl } }),
    ]);
  }

  async failRevision(job: JobRecord) {
    await this.db.designRevision.update({ where: { id: job.revisionId }, data: { status: 'DRAFT' } });
  }

  async notify(userId: string, n: { type: string; title: string; message: string; link?: string }) {
    await this.db.notification.create({ data: { userId, type: n.type, title: n.title, message: n.message.slice(0, 1000), link: n.link } });
  }
}
