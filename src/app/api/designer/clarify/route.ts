// =====================================================================
// POST /api/designer/clarify — the AI designer reads a free-form idea and
// returns either the precise questions it needs answered or "ready".
// Body: {idea, qa: [{question, answer}], round}
// =====================================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors, errorResponse } from '@/lib/api';
import Agents from '../../../../../services/ai_3d_engine/browser/agents.js';
import { anthropicConfigured, askJson } from '@/lib/generation/anthropic.ts';
import { ProviderError } from '@/lib/generation/errors.ts';

const MAX_ROUNDS = 2;
const Body = z.object({
  idea: z.string().min(4).max(2000),
  qa: z.array(z.object({ question: z.string().max(500), answer: z.string().max(500) })).max(20).default([]),
  round: z.number().int().min(1).max(MAX_ROUNDS).default(1),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  if (!anthropicConfigured()) return errorResponse(503, 'AI_NOT_CONFIGURED', 'The AI designer needs ANTHROPIC_API_KEY on the server.');
  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  const p = Body.safeParse(json);
  if (!p.success) return apiErrors.badRequest('Invalid request', p.error.issues);
  try {
    const r = (await askJson(Agents.clarifyPrompt(p.data.idea, p.data.qa, p.data.round, MAX_ROUNDS), { modelTier: 'default', label: 'clarify' })) as Record<string, unknown>;
    const questions = Array.isArray(r.questions) ? r.questions.slice(0, 6) : [];
    return ok({
      understanding: String(r.understanding_ar ?? ''),
      assumptions: Array.isArray(r.assumptions_ar) ? r.assumptions_ar.map(String) : [],
      ready: !!r.ready || questions.length === 0 || p.data.round >= MAX_ROUNDS,
      questions,
      round: p.data.round,
      maxRounds: MAX_ROUNDS,
    });
  } catch (e) {
    const pe = e instanceof ProviderError ? e : null;
    return errorResponse(pe?.retryable ? 503 : 502, 'AI_ERROR', (e as Error).message);
  }
}
