// =====================================================================
// POST /api/generations/spec — preview how the engine reads a prompt:
// chosen template, every parameter with its source (prompt / form / default),
// clarification questions and out-of-range errors. Builds no geometry.
// =====================================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors, errorResponse } from '@/lib/api';
import { EngineClient } from '@/lib/generation/engine-client.ts';

const Body = z.object({
  prompt: z.string().min(3).max(2000),
  userFields: z.record(z.string().max(40), z.number().finite()).optional().default({}),
  template: z.string().max(40).optional(),
  intendedUse: z.enum(['functional', 'artistic', 'prototype']).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return apiErrors.badRequest('Invalid request', parsed.error.issues);

  const engine = EngineClient.fromEnv();
  if (!engine) {
    return errorResponse(503, 'ENGINE_NOT_CONFIGURED', 'Geometry engine is not configured (ENGINE_URL / ENGINE_SERVICE_TOKEN).');
  }
  try {
    const spec = await engine.parseSpec(parsed.data);
    return ok({ spec });
  } catch (e) {
    return errorResponse(503, 'ENGINE_UNAVAILABLE', (e as Error).message);
  }
}
