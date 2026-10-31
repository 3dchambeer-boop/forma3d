// =====================================================================
// POST /api/print-jobs/[id]/start  (FARM_MANAGER, ADMIN)
// Body must be {"confirm": true}: starting moves a real machine, so the
// API refuses an implicit start. Printer readiness is re-checked live.
// =====================================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors, errorResponse } from '@/lib/api';
import { startPrint, PrintFlowError } from '@/lib/printing/service.ts';

const Body = z.object({ confirm: z.literal(true) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['FARM_MANAGER', 'ADMIN']);
  if (auth.error) return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  const { id } = await params;
  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  if (!Body.safeParse(json).success) return apiErrors.badRequest('Explicit confirmation required: {"confirm": true}');
  try {
    return ok(await startPrint(id, auth.user, req.headers.get('x-forwarded-for') || undefined));
  } catch (e) {
    if (e instanceof PrintFlowError) return errorResponse(e.status, e.code, e.message);
    throw e;
  }
}
