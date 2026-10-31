// =====================================================================
// POST /api/reviews/[id]/request-changes
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, logAuditSafe } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';
import { z } from 'zod';

const BodySchema = z.object({
  comments: z.string().min(3).max(2000),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['DESIGNER', 'ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }
  const reviewer = auth.user;
  const { id: revisionId } = await params;

  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return apiErrors.badRequest('Invalid body', parsed.error.issues);

  const result = await db.$transaction(async (tx) => {
    const revision = await tx.designRevision.findUnique({
      where: { id: revisionId },
      include: { project: true },
    });
    if (!revision) return { error: 'not_found' as const };
    if (revision.status !== 'REVIEW_REQUIRED') {
      return { error: 'invalid_state' as const, currentStatus: revision.status };
    }

    const updated = await tx.designRevision.update({
      where: { id: revisionId },
      data: { status: 'CHANGES_REQUESTED' },
    });

    const review = await tx.humanReview.create({
      data: {
        revisionId,
        reviewerId: reviewer.id,
        status: 'CHANGES_REQUESTED',
        comments: parsed.data.comments,
        decidedAt: new Date(),
      },
    });

    await tx.notification.create({
      data: {
        userId: revision.project.ownerId,
        type: 'REVIEW_DECISION',
        title: 'Changes requested',
        message: `${reviewer.name} requested changes on ${revision.project.name} v${revision.version}.`,
        link: 'model_viewer',
      },
    });

    return { review, revision: updated };
  });

  if ('error' in result) {
    if (result.error === 'not_found') return apiErrors.notFound('Revision');
    return apiErrors.conflict(`Cannot request changes for revision in status: ${result.currentStatus}`);
  }

  await logAuditSafe({
    actorId: reviewer.id,
    action: 'REVIEW_CHANGES_REQUESTED',
    resourceType: 'DesignRevision',
    resourceId: revisionId,
    metadata: { comments: parsed.data.comments },
    ipAddress: req.headers.get('x-forwarded-for') || undefined,
  });

  return ok(result);
}
