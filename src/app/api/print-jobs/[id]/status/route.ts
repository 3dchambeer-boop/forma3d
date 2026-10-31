// =====================================================================
// GET /api/print-jobs/[id]/status — live status read from OctoPrint.
// Farm managers/admins see any job; end users only jobs of their projects.
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';
import { syncStatus } from '@/lib/printing/service.ts';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const { id } = await params;
  const job = await db.printJob.findUnique({ where: { id }, select: { project: { select: { ownerId: true } } } });
  if (!job) return apiErrors.notFound('Print job');
  const staff = auth.user.role === 'FARM_MANAGER' || auth.user.role === 'ADMIN';
  if (!staff && job.project.ownerId !== auth.user.id) return apiErrors.notFound('Print job');
  return ok(await syncStatus(id));
}
