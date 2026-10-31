// =====================================================================
// POST /api/generations/[id]/cancel — stop a queued or running job.
// Compare-and-set on the status, so a job that already finished is not
// changed. A task already accepted by a paid provider keeps running there
// (Tripo has no cancel endpoint in the adapter); its result is discarded.
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, logAuditSafe } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';

const CANCELLABLE = ['QUEUED', 'GENERATING', 'DOWNLOADING', 'CONVERTING'] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const { id } = await params;

  const job = await db.aIGenerationJob.findUnique({ where: { id }, include: { project: { select: { ownerId: true } } } });
  if (!job || (job.project.ownerId !== auth.user.id && auth.user.role !== 'ADMIN')) return apiErrors.notFound('Generation job');

  const res = await db.aIGenerationJob.updateMany({
    where: { id, status: { in: [...CANCELLABLE] } },
    data: { status: 'CANCELLED', stage: 'CANCELLED', completedAt: new Date(), errorMessage: 'cancelled by user' },
  });
  if (res.count !== 1) return apiErrors.conflict(`Job is ${job.status} and can no longer be cancelled`);
  if (job.revisionId) await db.designRevision.update({ where: { id: job.revisionId }, data: { status: 'DRAFT' } });

  await logAuditSafe({
    actorId: auth.user.id, action: 'GENERATION_CANCEL', resourceType: 'AIGenerationJob', resourceId: id,
    metadata: { previousStatus: job.status, externalTaskId: job.externalTaskId },
    ipAddress: req.headers.get('x-forwarded-for') || undefined,
  });
  return ok({ id, status: 'CANCELLED', providerTaskMayStillRun: !!job.externalTaskId });
}
