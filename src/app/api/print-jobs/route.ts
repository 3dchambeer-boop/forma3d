// =====================================================================
// GET /api/print-jobs — list print jobs
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors, logAudit } from '@/lib/api';
import { z } from 'zod';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(['FARM_MANAGER', 'ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const jobs = await db.printJob.findMany({
    where: status ? { status: status as 'PRINTING' | 'COMPLETED' | 'FAILED' | 'QUEUED_FOR_PRINTER' | 'SLICED' } : {},
    include: {
      project: { select: { id: true, name: true } },
      revision: { select: { id: true, version: true, format: true } },
      printer: { select: { id: true, name: true, model: true, status: true } },
      slicingProfile: true,
      initiatedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return ok({ jobs });
}

// =====================================================================
// POST /api/print-jobs — the project owner requests a print of a revision.
// Allowed only once a designer has APPROVED the revision; the request then
// waits for a farm manager to slice and dispatch it.
// =====================================================================

const CreateBody = z.object({ revisionId: z.string().min(1), priority: z.number().int().min(0).max(3).optional() });

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) return apiErrors.badRequest('Invalid body', parsed.error.issues);

  const revision = await db.designRevision.findUnique({ where: { id: parsed.data.revisionId }, include: { project: true } });
  if (!revision || (revision.project.ownerId !== auth.user.id && auth.user.role !== 'ADMIN')) return apiErrors.notFound('Revision');
  if (revision.status !== 'APPROVED') {
    return apiErrors.forbidden(`Printing requires designer approval; revision is ${revision.status}`);
  }
  if (!revision.stlUrl && revision.format !== 'STL') return apiErrors.conflict('Revision has no printable STL');
  const open = await db.printJob.findFirst({
    where: { revisionId: revision.id, status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } },
    select: { id: true, status: true },
  });
  if (open) return apiErrors.conflict(`A print job for this revision is already ${open.status} (${open.id})`);

  const job = await db.printJob.create({
    data: {
      projectId: revision.projectId,
      revisionId: revision.id,
      initiatedById: auth.user.id,
      status: 'APPROVED',
      priority: parsed.data.priority ?? 0,
      projectName: revision.project.name,
      revisionVersion: revision.version,
      initiatedByName: auth.user.name,
    },
  });
  await logAudit({
    actorId: auth.user.id, action: 'PRINT_REQUEST', resourceType: 'PrintJob', resourceId: job.id,
    metadata: { revisionId: revision.id }, ipAddress: req.headers.get('x-forwarded-for') || undefined,
  });
  return ok({ job }, 201);
}
