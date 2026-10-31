// =====================================================================
// ParametricProvider — text → spec → exact CAD in ai_3d_engine.
// Synchronous and free: the engine returns a finished, validated STL.
// Used for functional parts where millimetre accuracy matters.
// =====================================================================

import type { EngineClient } from '../engine-client.ts';
import { ProviderError } from '../errors.ts';
import type { GenerationInput, ModelGenerationProvider, StartResult } from '../provider.ts';

export class ParametricProvider implements ModelGenerationProvider {
  readonly id = 'PARAMETRIC' as const;
  readonly paid = false;

  constructor(private readonly engine: EngineClient | null) {}

  configured() {
    return this.engine
      ? ({ ok: true } as const)
      : ({ ok: false, reason: 'ENGINE_URL / ENGINE_SERVICE_TOKEN are not set' } as const);
  }

  async start(input: GenerationInput): Promise<StartResult> {
    if (!this.engine) throw new ProviderError('NOT_CONFIGURED', 'geometry engine is not configured');
    const engine = await this.engine.generateParametric({
      prompt: input.prompt,
      userFields: input.userFields,
      template: input.template,
      intendedUse: input.intendedUse,
      constraints: input.constraints,
    });
    return { kind: 'final', engine, model: `parametric:${String(engine.metadata.spec?.template ?? 'unknown')}` };
  }
}
