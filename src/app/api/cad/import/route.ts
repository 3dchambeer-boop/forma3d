// POST /api/cad/import  (body: a STEP file, Content-Type application/step)
// Signed-in users import a STEP model: it is checked by content, read by OpenCascade (exact B-Rep, converted to mm,
// healed), and the printable STL is stored privately. Returns the measured report and the stored file's key + hash.
import { NextRequest } from 'next/server';
import { requireAuth, logAuditSafe } from '@/lib/session';
import { apiErrors, ok } from '@/lib/api';
import { CadClient, CadServiceError } from '@/lib/cad/cad-client';
import { validateUpload } from '@/lib/security/file-validation';
import { rateLimited } from '@/lib/security/rate-limit';
import { saveFile } from '@/lib/storage';

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const limited = rateLimited(auth.user.id, 'export');
  if (limited) return limited;
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return apiErrors.badRequest(`STEP files are limited to ${MAX_BYTES / 1048576} MB`);
  const data = new Uint8Array(await req.arrayBuffer());
  const v = validateUpload(data, { allow: ['step'], maxBytes: MAX_BYTES });
  if (!v.ok) return apiErrors.unprocessable(v.message, { code: v.code });
  const cad = CadClient.fromEnv();
  if (!cad) return apiErrors.unprocessable('STEP import needs the OpenCascade CAD service (CAD_ENGINE_URL is not set)', { code: 'NOT_CONFIGURED' });
  try {
    const out = await cad.importStep(data, ['stl']);
    const stl = out.exports.stl!.bytes;
    const stored = await saveFile('models', stl, 'stl', 'step-import');
    await logAuditSafe({ actorId: auth.user.id, action: 'CAD_STEP_IMPORT', resourceType: 'model', resourceId: stored.key, metadata: { bytes: data.length, faces: out.report.faces, volume_mm3: out.report.volume_mm3 } });
    return ok({ report: out.report, import: out.import, stl: { key: stored.key, sha256: stored.sha256, bytes: stored.sizeBytes } });
  } catch (e) {
    if (e instanceof CadServiceError) return e.status === 422 ? apiErrors.unprocessable(e.message, { code: e.code }) : apiErrors.unprocessable(`CAD service: ${e.message}`, { code: e.code });
    throw e;
  }
}
