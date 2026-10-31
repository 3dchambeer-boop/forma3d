// =====================================================================
// Provider registry built from server configuration.
//
//   ENGINE_URL, ENGINE_SERVICE_TOKEN   → PARAMETRIC (+ STL conversion for all)
//   TRIPO_API_KEY                      → TRIPO
//   SELF_HOSTED_INFERENCE_URL/_TOKEN   → SELF_HOSTED
//   ENABLE_MOCK_PROVIDER=1 (non-prod)  → MOCK
//   GENERATION_FALLBACKS="TRIPO:SELF_HOSTED"  fallback when no task can exist
//   GENERATION_FREEFORM_PROVIDER=AI_DESIGNER  provider for prompts with no template (AI_DESIGNER needs ANTHROPIC_API_KEY)
// =====================================================================

import { EngineClient } from './engine-client.ts';
import type { ProviderId, ProviderRegistry } from './provider.ts';
import { AiDesignerProvider } from './providers/ai-designer.ts';
import { MockProvider } from './providers/mock.ts';
import { ParametricProvider } from './providers/parametric.ts';
import { SelfHostedProvider } from './providers/self-hosted.ts';
import { TripoProvider } from './providers/tripo.ts';
import { MeshyProvider } from './providers/meshy.ts';
import { RodinProvider } from './providers/rodin.ts';

const IDS: ProviderId[] = ['PARAMETRIC', 'AI_DESIGNER', 'TRIPO', 'MESHY', 'RODIN', 'SELF_HOSTED', 'MOCK'];

export function buildRegistry(engine: EngineClient | null = EngineClient.fromEnv()): ProviderRegistry {
  return {
    PARAMETRIC: new ParametricProvider(engine),
    AI_DESIGNER: new AiDesignerProvider(),
    TRIPO: new TripoProvider(),
    MESHY: new MeshyProvider(),
    RODIN: new RodinProvider(),
    SELF_HOSTED: new SelfHostedProvider(),
    MOCK: new MockProvider(),
  };
}

export function parseFallbacks(raw = process.env.GENERATION_FALLBACKS || ''): Partial<Record<ProviderId, ProviderId>> {
  const out: Partial<Record<ProviderId, ProviderId>> = {};
  for (const pair of raw.split(',')) {
    const [from, to] = pair.split(':').map((s) => s.trim().toUpperCase()) as [ProviderId, ProviderId];
    if (IDS.includes(from) && IDS.includes(to) && from !== to) out[from] = to;
  }
  return out;
}

export function freeformProvider(): ProviderId {
  const p = (process.env.GENERATION_FREEFORM_PROVIDER || 'AI_DESIGNER').toUpperCase() as ProviderId;
  return IDS.includes(p) && p !== 'PARAMETRIC' ? p : 'AI_DESIGNER';
}

/** Public status of each provider (no secrets), for settings and health pages. */
export function providerStatus(reg: ProviderRegistry = buildRegistry()) {
  return IDS.map((id) => {
    const c = reg[id]?.configured() ?? { ok: false as const, reason: 'not registered' };
    return { id, configured: c.ok, reason: c.ok ? null : c.reason, paid: reg[id]?.paid ?? false };
  });
}
