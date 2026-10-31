// =====================================================================
// GET /api/projects/[id] — single project with revisions
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors, errorResponse } from '@/lib/api';
import { checkIfMatch, etagOf } from '@/lib/sync/etag';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const user = auth.user;
  const { id } = await params;

  const project = await db.designProject.findUnique({
    where: { id },
    include: {
      revisions: { orderBy: { version: 'asc' } },
      owner: { select: { id: true, name: true, email: true } },
      generations: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });

  if (!project) return apiErrors.notFound('Project');

  // Authorization: owner, admin, or designer (for review visibility)
  if (user.role !== 'ADMIN' && user.role !== 'DESIGNER' && project.ownerId !== user.id) {
    return apiErrors.forbidden();
  }

  const res = ok({ project });
  res.headers.set('ETag', etagOf(project.updatedAt));
  return res;
}

// PATCH /api/projects/[id] {name?, description?} — requires If-Match with the ETag from GET.
// Two people editing the same project: the second save gets 409 with the current ETag instead of
// silently overwriting the first. The update itself is conditional on updatedAt (no race between check and write).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const { id } = await params;
  const project = await db.designProject.findUnique({ where: { id } });
  if (!project) return apiErrors.notFound('Project');
  if (auth.user.role !== 'ADMIN' && project.ownerId !== auth.user.id) return apiErrors.forbidden();
  const pre = checkIfMatch(req.headers.get('if-match'), etagOf(project.updatedAt));
  if (!pre.ok) { const r = errorResponse(pre.status, pre.code, pre.code === 'CONFLICT' ? 'The project changed since you loaded it; reload and re-apply your edit.' : 'If-Match header required'); r.headers.set('ETag', pre.current); return r; }
  const b = (await req.json().catch(() => null)) as { name?: string; description?: string } | null;
  if (!b || (b.name === undefined && b.description === undefined)) return apiErrors.badRequest('nothing to update');
  const data: { name?: string; description?: string } = {};
  if (typeof b.name === 'string' && b.name.trim()) data.name = b.name.trim().slice(0, 200);
  if (typeof b.description === 'string') data.description = b.description.slice(0, 5000);
  const upd = await db.designProject.updateMany({ where: { id, updatedAt: project.updatedAt }, data });
  if (upd.count !== 1) { const now = await db.designProject.findUnique({ where: { id } }); const r = errorResponse(409, 'CONFLICT', 'The project changed while saving; reload.'); if (now) r.headers.set('ETag', etagOf(now.updatedAt)); return r; }
  const fresh = await db.designProject.findUnique({ where: { id } });
  const res = ok({ project: fresh });
  if (fresh) res.headers.set('ETag', etagOf(fresh.updatedAt));
  return res;
}
