// =====================================================================
// GET /api/generations/[id]/export?format=step|stl|3mf[&quality=fine]
// Rebuilds the revision's FormaCAD design as an exact B-Rep in the OpenCascade service and returns
// the file. Only AI-designer / FormaCAD revisions carry a design source; mesh-only revisions (Tripo)
// have no B-Rep and get 409 instead of a fake STEP.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { apiErrors } from '@/lib/api';
import { canViewProject } from '@/lib/access';
import { CadClient, CadServiceError, type CadFormat } from '@/lib/cad/cad-client';

const TYPES: Record<CadFormat, string> = { step: 'model/step', stl: 'model/stl', '3mf': 'model/3mf' };

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const { id } = await params;
  const format = (new URL(req.url).searchParams.get('format') || 'step') as CadFormat;
  if (!(format in TYPES)) return err(400, 'BAD_FORMAT', 'format must be step, stl or 3mf');
  const fine = new URL(req.url).searchParams.get('quality') === 'fine';

  const job = await db.aIGenerationJob.findUnique({ where: { id }, include: { project: { select: { id: true, name: true, ownerId: true } }, revision: true } });
  if (!job || !canViewProject(auth.user, job.project)) return apiErrors.notFound('Generation job');
  let spec: { design?: unknown; values?: Record<string, number> } | null = null;
  try { spec = job.revision?.specJson ? JSON.parse(job.revision.specJson) : null; } catch { spec = null; }
  if (!spec?.design) return err(409, 'NO_CAD_SOURCE', 'this revision is a mesh without a CAD source; STEP needs a FormaCAD design');

  const cad = CadClient.fromEnv();
  if (!cad) return err(503, 'CAD_NOT_CONFIGURED', 'CAD_ENGINE_URL is not set on this server');
  try {
    const out = await cad.build(spec.design, spec.values ?? {}, [format], fine ? { linear_mm: 0.005, angular_deg: 3 } : { linear_mm: 0.01, angular_deg: 5 });
    const file = out.exports[format]!;
    const name = `${job.project.name.replace(/[^\w؀-ۿ-]+/g, '_').slice(0, 40) || 'part'}-r${job.revision?.version ?? 1}.${format}`;
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: { 'Content-Type': TYPES[format], 'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Cad-Check': JSON.stringify(file.check).slice(0, 500) },
    });
  } catch (e) {
    if (e instanceof CadServiceError) return err(e.status === 422 ? 422 : e.status >= 500 ? 502 : e.status, e.code, e.message);
    throw e;
  }
}
