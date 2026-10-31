// =====================================================================
// POST /api/print-jobs/[id]/dispatch  (FARM_MANAGER, ADMIN)
// Uploads the verified G-code to the printer's OctoPrint and selects it.
// It does NOT start printing: the job waits in AWAITING_PRINT_CONFIRMATION
// until someone calls /start with an explicit confirmation.
// (The previous version marked jobs PRINTING without contacting OctoPrint.)
// =====================================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors, errorResponse } from '@/lib/api';
import { dispatch, PrintFlowError } from '@/lib/printing/service.ts';

const Body = z.object({ printerId: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['FARM_MANAGER', 'ADMIN']);
  if (auth.error) return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  const { id } = await params;
  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return apiErrors.badRequest('Invalid body', parsed.error.issues);
  try {
    return ok(await dispatch(id, parsed.data.printerId, auth.user, req.headers.get('x-forwarded-for') || undefined));
  } catch (e) {
    if (e instanceof PrintFlowError) return errorResponse(e.status, e.code, e.message);
    throw e;
  }
}
