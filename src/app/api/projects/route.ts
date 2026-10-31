// =====================================================================
// GET  /api/projects — list projects for current user
// POST /api/projects — create a project and ENQUEUE its first generation
//
// POST no longer runs the provider inside the HTTP request. It records a
// QUEUED job (idempotent per Idempotency-Key header) and returns 202; the
// generation worker (scripts/generation-worker.ts) does the work and the
// client follows progress via GET /api/generations/{jobId}.
//
// Provider routing:
//   IMAGE_TO_3D            → TRIPO
//   mode PARAMETRIC        → PARAMETRIC (exact CAD in ai_3d_engine)
//   mode AI_DESIGN         → AI_DESIGNER (Claude writes FormaCAD; the kernel builds and validates)
//   mode FREEFORM          → requested provider or GENERATION_FREEFORM_PROVIDER
//   mode AUTO (default)    → PARAMETRIC when the engine finds a template for the
//                            prompt, otherwise the free-form provider
// A provider that is not configured is reported (503), never simulated.
// =====================================================================

import { NextRequest } from 'next/server';
import { validateImageDataUrl } from '@/lib/security/file-validation';
import { db } from '@/lib/db';
import { requireAuth, logAuditSafe } from '@/lib/session';
import { ok, apiErrors, errorResponse } from '@/lib/api';
import { z } from 'zod';
import { EngineClient } from '@/lib/generation/engine-client.ts';
import { buildRegistry, freeformProvider } from '@/lib/generation/registry.ts';
import type { GenerationInput, ProviderId } from '@/lib/generation/provider.ts';

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || undefined;
  const search = url.searchParams.get('search') || undefined;

  const user = auth.user;
  // Admins see all; others see own projects
  const where = user.role === 'ADMIN'
    ? {
        status: status ? (status as 'ACTIVE' | 'ARCHIVED') : undefined,
        ...(search ? { name: { contains: search } } : {}),
      }
    : {
        ownerId: user.id,
        status: status ? (status as 'ACTIVE' | 'ARCHIVED') : undefined,
        ...(search ? { name: { contains: search } } : {}),
      };

  const projects = await db.designProject.findMany({
    where,
    include: {
      revisions: {
        orderBy: { version: 'asc' },
      },
      owner: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  return ok({ projects });
}

const CreateSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(2000).optional().default(''),
  prompt: z.string().min(3).max(2000),
  negativePrompt: z.string().max(255).optional(),
  mode: z.enum(['AUTO', 'PARAMETRIC', 'AI_DESIGN', 'FREEFORM']).default('AUTO'),
  designQa: z.array(z.object({ question: z.string().max(500), answer: z.string().max(500) })).max(20).optional(),
  designUnderstanding: z.string().max(2000).optional(),
  provider: z.enum(['AI_DESIGNER', 'TRIPO', 'MESHY', 'RODIN', 'SELF_HOSTED', 'MOCK']).optional(),
  inputType: z.enum(['TEXT_TO_3D', 'IMAGE_TO_3D']).default('TEXT_TO_3D'),
  referenceImageBase64: z.string().max(28 * 1024 * 1024).optional(),
  template: z.string().max(40).optional(),
  userFields: z.record(z.string().max(40), z.number().finite()).optional().default({}),
  intendedUse: z.enum(['functional', 'artistic', 'prototype']).optional(),
  targetLongestMm: z.number().positive().max(2000).optional(),
});

const RATE_PER_HOUR = Number(process.env.GENERATION_RATE_LIMIT_PER_HOUR || 20);
const MAX_ACTIVE = Number(process.env.GENERATION_MAX_ACTIVE_PER_USER || 3);
const ACTIVE = ['QUEUED', 'GENERATING', 'DOWNLOADING', 'CONVERTING', 'VALIDATING'] as const;

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const user = auth.user;

  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) return apiErrors.badRequest('Invalid request', parsed.error.issues);
  const body = parsed.data;

  // --- idempotency: a retried submit returns the job it already created
  const idemKey = req.headers.get('idempotency-key');
  if (idemKey !== null && !/^[A-Za-z0-9-]{8,64}$/.test(idemKey)) return apiErrors.badRequest('Invalid Idempotency-Key');
  if (idemKey) {
    const existing = await db.aIGenerationJob.findUnique({
      where: { initiatedById_idempotencyKey: { initiatedById: user.id, idempotencyKey: idemKey } },
      include: { project: true, revision: true },
    });
    if (existing) return ok({ project: existing.project, revision: existing.revision, generationJob: { ...existing, requestJson: undefined }, replayed: true }, 200);
  }

  // --- rate limits (database-backed so they hold across app instances)
  const [lastHour, active] = await Promise.all([
    db.aIGenerationJob.count({ where: { initiatedById: user.id, createdAt: { gte: new Date(Date.now() - 3600_000) } } }),
    db.aIGenerationJob.count({ where: { initiatedById: user.id, status: { in: [...ACTIVE] } } }),
  ]);
  if (lastHour >= RATE_PER_HOUR) return apiErrors.tooMany(`Limit of ${RATE_PER_HOUR} generations per hour reached`);
  if (active >= MAX_ACTIVE) return apiErrors.tooMany(`You already have ${active} generations running`);

  const membership = await db.organizationMembership.findFirst({ where: { userId: user.id } });
  if (!membership) return apiErrors.badRequest('User has no organization');

  // --- choose the provider
  const registry = buildRegistry();
  let provider: ProviderId;
  let spec: Record<string, unknown> | null = null;
  if (body.inputType === 'IMAGE_TO_3D') {
    if (!body.referenceImageBase64) return apiErrors.badRequest('IMAGE_TO_3D requires referenceImageBase64');
    // judged by its bytes: declared type must match, dimensions limited before any decoder sees it
    const img = validateImageDataUrl(body.referenceImageBase64, { maxBytes: 20 * 1024 * 1024, maxPixels: 40e6 });
    if (!img.ok) return apiErrors.unprocessable(`reference image refused: ${img.message}`, { code: img.code });
    provider = body.provider === 'MESHY' || body.provider === 'RODIN' ? body.provider : 'TRIPO';
  } else if (body.mode === 'PARAMETRIC') {
    provider = 'PARAMETRIC';
  } else if (body.mode === 'AI_DESIGN') {
    provider = 'AI_DESIGNER';
  } else if (body.mode === 'FREEFORM') {
    provider = body.provider ?? freeformProvider();
  } else {
    const engine = EngineClient.fromEnv();
    if (engine) {
      try {
        spec = await engine.parseSpec({ prompt: body.prompt, userFields: body.userFields, template: body.template, intendedUse: body.intendedUse });
      } catch (e) {
        return errorResponse(503, 'ENGINE_UNAVAILABLE', `Geometry engine unavailable: ${(e as Error).message}`);
      }
    }
    provider = spec?.template ? 'PARAMETRIC' : (body.provider ?? freeformProvider());
  }
  const cfg = registry[provider]?.configured() ?? { ok: false as const, reason: 'unknown provider' };
  if (!cfg.ok) {
    return errorResponse(503, 'PROVIDER_NOT_CONFIGURED', `${provider} is not configured: ${cfg.reason}`, {
      provider,
      hint: provider === 'PARAMETRIC'
        ? 'Start services/ai_3d_engine and set ENGINE_URL and ENGINE_SERVICE_TOKEN.'
        : provider === 'TRIPO' ? 'Set TRIPO_API_KEY on the server.'
        : provider === 'MESHY' ? 'Set MESHY_API_KEY on the server.'
        : provider === 'RODIN' ? 'Set RODIN_API_KEY on the server.'
        : provider === 'AI_DESIGNER' ? 'Set ANTHROPIC_API_KEY on the server.' : undefined,
    });
  }
  if (!['PARAMETRIC', 'AI_DESIGNER', 'MOCK'].includes(provider) && !body.targetLongestMm) {
    return apiErrors.unprocessable('Free-form AI models have no reliable physical size: targetLongestMm (longest side in mm) is required.');
  }

  const input: Omit<GenerationInput, 'jobId'> = {
    prompt: body.prompt,
    negativePrompt: body.negativePrompt ?? null,
    userFields: body.userFields,
    template: body.template ?? null,
    intendedUse: body.intendedUse ?? null,
    referenceImageDataUrl: body.referenceImageBase64 ?? null,
    targetLongestMm: body.targetLongestMm ?? null,
    designQa: body.designQa ?? [],
    designUnderstanding: body.designUnderstanding ?? null,
  };

  let created;
  try {
    created = await db.$transaction(async (tx) => {
      const project = await tx.designProject.create({
        data: { name: body.name, description: body.description || body.prompt, ownerId: user.id, organizationId: membership.organizationId, status: 'ACTIVE' },
      });
      const revision = await tx.designRevision.create({
        data: { projectId: project.id, version: 1, status: 'PROCESSING', prompt: body.prompt, negativePrompt: body.negativePrompt || null },
      });
      const generationJob = await tx.aIGenerationJob.create({
        data: {
          projectId: project.id,
          revisionId: revision.id,
          initiatedById: user.id,
          provider,
          status: 'QUEUED',
          stage: 'QUEUED',
          progress: 0,
          inputType: body.inputType,
          textPrompt: body.prompt,
          requestJson: JSON.stringify(input),
          idempotencyKey: idemKey,
        },
      });
      return { project, revision, generationJob };
    });
  } catch (e) {
    // two concurrent submits with the same Idempotency-Key: the unique index lets one win
    if (idemKey && (e as { code?: string }).code === 'P2002') {
      const existing = await db.aIGenerationJob.findUnique({
        where: { initiatedById_idempotencyKey: { initiatedById: user.id, idempotencyKey: idemKey } },
        include: { project: true, revision: true },
      });
      if (existing) return ok({ project: existing.project, revision: existing.revision, generationJob: { ...existing, requestJson: undefined }, replayed: true }, 200);
    }
    throw e;
  }

  await logAuditSafe({
    actorId: user.id,
    action: 'GENERATION_ENQUEUED',
    resourceType: 'AIGenerationJob',
    resourceId: created.generationJob.id,
    metadata: { provider, mode: body.mode, template: spec?.template ?? null, projectId: created.project.id },
    ipAddress: req.headers.get('x-forwarded-for') || undefined,
  });

  const { requestJson: _omit, ...publicJob } = created.generationJob;
  return ok({ project: created.project, revision: created.revision, generationJob: publicJob, spec }, 202);
}
