// =====================================================================
// POST /api/print-jobs/[id]/control  (FARM_MANAGER, ADMIN)
// {"action": "cancel" | "pause" | "resume"} — sent to OctoPrint, logged as
// a printer event and in the audit log, then the live state is re-read.
// =====================================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors, errorResponse } from '@/lib/api';
import { control, PrintFlowError } from '@/lib/printing/service.ts';

const Body = z.object({ action: z.enum(['cancel', 'pause', 'resume']) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['FARM_MANAGER', 'ADMIN']);
  if (auth.error) return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  const { id } = await params;
  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return apiErrors.badRequest('Invalid body', parsed.error.issues);
  try {
    return ok(await control(id, parsed.data.action, auth.user, req.headers.get('x-forwarded-for') || undefined));
  } catch (e) {
    if (e instanceof PrintFlowError) return errorResponse(e.status, e.code, e.message);
    throw e;
  }
}
