// =====================================================================
// POST /api/print-jobs/[id]/slice   (FARM_MANAGER, ADMIN)
//
// Server-enforced gates, in order:
//   1. revision APPROVED by a designer
//   2. revision has a printable STL whose geometry did not fail validation
//   3. printer (if given) online, material + nozzle match, part fits
//   4. OrcaSlicer configured and preset files present
// Then: slice → sanity-check G-code → store privately → SLICED.
// No step reports success that did not happen.
// =====================================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAuth, logAuditSafe } from '@/lib/session';
import { ok, apiErrors, errorResponse } from '@/lib/api';
import { runOrcaSlicer, isOrcaSlicerConfigured, OrcaSlicerError } from '@/lib/orcaslicer';
import { checkGcode } from '@/lib/printing/octoprint.ts';
import { keyFromUrl, pathFor, saveFile } from '@/lib/storage';

const BodySchema = z.object({
  slicingProfileId: z.string().min(1),
  printerId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['FARM_MANAGER', 'ADMIN']);
  if (auth.error) return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  const actor = auth.user;
  const { id: jobId } = await params;
  const ip = req.headers.get('x-forwarded-for') || undefined;

  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return apiErrors.badRequest('Invalid body', parsed.error.issues);

  const job = await db.printJob.findUnique({ where: { id: jobId }, include: { revision: true } });
  if (!job) return apiErrors.notFound('Print job');
  if (!['APPROVED', 'PENDING_APPROVAL', 'FAILED', 'SLICED'].includes(job.status)) {
    return apiErrors.conflict(`Cannot slice a job in status ${job.status}`);
  }

  // 1. approval gate
  if (job.revision.status !== 'APPROVED') {
    await logAuditSafe({ actorId: actor.id, action: 'SLICE_REJECTED_NOT_APPROVED', resourceType: 'PrintJob', resourceId: jobId, metadata: { revisionStatus: job.revision.status }, ipAddress: ip });
    return apiErrors.forbidden(`Cannot slice: revision is ${job.revision.status}. Only designer-approved revisions can be sliced.`);
  }
  // 2. printable geometry gate
  const key = keyFromUrl(job.revision.stlUrl ?? (job.revision.format === 'STL' ? job.revision.modelUrl : null));
  const modelPath = key ? pathFor('models', key) : null;
  if (!key || !modelPath || !key.toLowerCase().endsWith('.stl')) {
    return apiErrors.conflict('Revision has no printable STL in storage. Generate or upload an STL first.');
  }
  if (job.revision.validationStatus === 'REPAIR_REQUIRED') {
    return apiErrors.conflict('Geometry check reported an open or non-manifold mesh; a designer must upload a repaired STL before slicing.');
  }

  const profile = await db.slicingProfile.findUnique({ where: { id: parsed.data.slicingProfileId } });
  if (!profile) return apiErrors.notFound('Slicing profile');

  // 3. printer compatibility
  let printer = null as Awaited<ReturnType<typeof db.printer.findUnique>>;
  if (parsed.data.printerId) {
    printer = await db.printer.findUnique({ where: { id: parsed.data.printerId } });
    if (!printer) return apiErrors.notFound('Printer');
    if (printer.status === 'OFFLINE' || printer.status === 'ERROR') return apiErrors.conflict(`Printer ${printer.name} is ${printer.status.toLowerCase()}`);
    if (!printer.materials.split(',').map((m) => m.trim()).includes(profile.material)) {
      return apiErrors.conflict(`Printer ${printer.name} does not support ${profile.material} (supports ${printer.materials})`);
    }
    if (Math.abs(printer.nozzleDiameter - profile.nozzleDiameter) > 0.01) {
      return apiErrors.conflict(`Nozzle mismatch: printer ${printer.nozzleDiameter} mm, profile ${profile.nozzleDiameter} mm`);
    }
    const r = job.revision;
    if (r.boundingBoxX == null || r.boundingBoxY == null || r.boundingBoxZ == null) {
      return apiErrors.conflict('Model size unknown; cannot verify it fits the printer.');
    }
    if (r.boundingBoxX > printer.buildVolumeX || r.boundingBoxY > printer.buildVolumeY || r.boundingBoxZ > printer.buildVolumeZ) {
      return apiErrors.conflict(`Model ${r.boundingBoxX}×${r.boundingBoxY}×${r.boundingBoxZ} mm exceeds build volume ${printer.buildVolumeX}×${printer.buildVolumeY}×${printer.buildVolumeZ} mm`);
    }
  }

  // 4. slicer availability
  const orca = await isOrcaSlicerConfigured();
  if (!orca.configured) {
    return errorResponse(503, 'SLICER_NOT_CONFIGURED', `OrcaSlicer is not configured: ${orca.reason}. See docs/PRINTING.md.`);
  }

  // compare-and-set so two managers cannot slice the same job at once
  const claimed = await db.printJob.updateMany({ where: { id: jobId, status: job.status }, data: { status: 'SLICING', slicingProfileId: profile.id, errorMessage: null } });
  if (claimed.count !== 1) return apiErrors.conflict('Job changed state; reload and retry');

  try {
    const result = await runOrcaSlicer({ modelPath, profileConfigJson: profile.config });
    const problems = checkGcode(result.gcode);
    if (problems.length) throw new OrcaSlicerError(`G-code failed sanity check: ${problems.join('; ')}`, 'INVALID_OUTPUT');
    const stored = await saveFile('gcode', result.gcode, 'gcode', jobId);
    const materialGrams = result.filamentLengthMm
      ? Number((Math.PI * 0.875 ** 2 * result.filamentLengthMm * 0.00124).toFixed(1)) // 1.75 mm PLA, 1.24 g/cm³
      : null;
    await db.printJob.update({
      where: { id: jobId },
      data: {
        status: 'SLICED',
        gcodeUrl: stored.url,
        gcodeSizeBytes: stored.sizeBytes,
        gcodeChecksum: `sha256:${stored.sha256}`,
        estimatedTimeMin: result.printTimeSec ? Math.ceil(result.printTimeSec / 60) : null,
        materialGrams,
        printerId: printer?.id ?? job.printerId,
        printerName: printer?.name ?? job.printerName,
      },
    });
    await logAuditSafe({
      actorId: actor.id, action: 'PRINT_SLICE', resourceType: 'PrintJob', resourceId: jobId, ipAddress: ip,
      metadata: { profileId: profile.id, presetSha256: result.presetSha256, args: result.args, gcodeSha256: stored.sha256, durationMs: result.durationMs, layerCount: result.layerCount },
    });
    return ok({ jobId, status: 'SLICED', gcodeUrl: stored.url, gcodeSize: stored.sizeBytes, estimatedTimeMin: result.printTimeSec ? Math.ceil(result.printTimeSec / 60) : null, materialGrams, layerCount: result.layerCount ?? null });
  } catch (e) {
    const msg = e instanceof OrcaSlicerError ? `[${e.code}] ${e.message}` : (e as Error).message;
    await db.printJob.update({ where: { id: jobId }, data: { status: 'FAILED', errorMessage: msg.slice(0, 2000) } });
    await logAuditSafe({ actorId: actor.id, action: 'PRINT_SLICE_FAILED', resourceType: 'PrintJob', resourceId: jobId, metadata: { error: msg }, ipAddress: ip });
    return errorResponse(e instanceof OrcaSlicerError && e.code === 'PRESET_MISSING' ? 422 : 500, 'SLICE_FAILED', msg);
  }
}
