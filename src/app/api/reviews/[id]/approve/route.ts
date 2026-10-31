// =====================================================================
// POST /api/reviews/[id]/approve — approve a revision
// Server enforces: revision must currently be in REVIEW_REQUIRED
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, logAuditSafe } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';
import { z } from 'zod';

const BodySchema = z.object({
  comments: z.string().max(2000).optional().default(''),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['DESIGNER', 'ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }
  const reviewer = auth.user;
  const { id: revisionId } = await params;

  let json: unknown;
  try { json = await req.json(); } catch { json = {}; }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return apiErrors.badRequest('Invalid body', parsed.error.issues);

  // Lock revision with transaction
  const result = await db.$transaction(async (tx) => {
    const revision = await tx.designRevision.findUnique({
      where: { id: revisionId },
      include: { project: true },
    });
    if (!revision) return { error: 'not_found' as const };

    // State transition check: only REVIEW_REQUIRED can move to APPROVED
    if (revision.status !== 'REVIEW_REQUIRED') {
      return { error: 'invalid_state' as const, currentStatus: revision.status };
    }

    // Update revision
    const updated = await tx.designRevision.update({
      where: { id: revisionId },
      data: { status: 'APPROVED' },
    });

    // Create review record
    const review = await tx.humanReview.create({
      data: {
        revisionId,
        reviewerId: reviewer.id,
        status: 'APPROVED',
        comments: parsed.data.comments || null,
        decidedAt: new Date(),
      },
    });

    // Notify project owner
    await tx.notification.create({
      data: {
        userId: revision.project.ownerId,
        type: 'REVIEW_DECISION',
        title: 'Revision approved',
        message: `Your ${revision.project.name} v${revision.version} has been approved by ${reviewer.name}.`,
        link: 'model_viewer',
      },
    });

    return { review, revision: updated };
  });

  if ('error' in result) {
    if (result.error === 'not_found') return apiErrors.notFound('Revision');
    return apiErrors.conflict(`Cannot approve revision in status: ${result.currentStatus}`);
  }

  await logAuditSafe({
    actorId: reviewer.id,
    action: 'REVIEW_APPROVE',
    resourceType: 'DesignRevision',
    resourceId: revisionId,
    metadata: { comments: parsed.data.comments },
    ipAddress: req.headers.get('x-forwarded-for') || undefined,
  });

  return ok(result);
}
