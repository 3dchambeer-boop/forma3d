// POST — an authorised user gets a signed, 15-minute link to a model file (for the slicer worker or a printer host).
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/session';
import { apiErrors, ok, logAudit } from '@/lib/api';
import { canReadModelFile } from '@/lib/access';
import { signDownload, signingSecret } from '@/lib/security/signed-url';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const { filename } = await params;
  if (!(await canReadModelFile(auth.user, filename))) return apiErrors.notFound('Model');
  let token: string;
  try { token = signDownload({ kind: 'models', key: filename, sub: auth.user.id, ttlMs: 15 * 60_000 }, signingSecret()); }
  catch { return apiErrors.internal('signed links are not configured (DOWNLOAD_SIGNING_SECRET)'); }
  await logAudit({ actorId: auth.user.id, action: 'download_link_issued', resourceType: 'model', resourceId: filename });
  return ok({ url: `/api/models/${encodeURIComponent(filename)}?sig=${encodeURIComponent(token)}`, expiresInSec: 900 });
}
