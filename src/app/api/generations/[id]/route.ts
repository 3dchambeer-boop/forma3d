// =====================================================================
// GET /api/generations/[id] — authoritative job status for the owner.
// The browser polls this; it is the source of truth after reconnects.
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';
import { canViewProject } from '@/lib/access';

function parse(json: string | null): unknown {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return json; }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const { id } = await params;

  const job = await db.aIGenerationJob.findUnique({
    where: { id },
    include: { project: { select: { id: true, name: true, ownerId: true } }, revision: true },
  });
  if (!job || !canViewProject(auth.user, job.project)) return apiErrors.notFound('Generation job');

  const rev = job.revision;
  return ok({
    job: {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress, // provider-reported only
      provider: job.provider,
      providerModel: job.providerModel,
      externalTaskId: job.externalTaskId,
      attempts: job.attempts,
      errorMessage: job.errorMessage,
      costCredits: job.costCredits,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      result: parse(job.resultJson),
    },
    project: { id: job.project.id, name: job.project.name },
    revision: rev && {
      id: rev.id,
      version: rev.version,
      status: rev.status,
      modelUrl: rev.modelUrl,
      stlUrl: rev.stlUrl,
      format: rev.format,
      validationStatus: rev.validationStatus,
      validationReport: parse(rev.validationReport),
      spec: parse(rev.specJson),
      sizeMm: rev.boundingBoxX != null ? { x: rev.boundingBoxX, y: rev.boundingBoxY, z: rev.boundingBoxZ } : null,
      triangles: rev.faceCount,
    },
  });
}
