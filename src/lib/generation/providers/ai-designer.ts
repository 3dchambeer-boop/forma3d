// =====================================================================
// AiDesignerProvider — generative design for ANY idea, not a template list.
//
// Claude writes a parametric FormaCAD model from the customer's idea and the
// answers to its clarification questions; the deterministic CAD kernel builds
// it, the mesh validator checks it, and failures go back to Claude for repair
// (services/ai_3d_engine/browser/{engine,cad,agents}.js — the same code the
// published studio runs in the browser).
// =====================================================================

import { createHash } from 'node:crypto';
import CAD from '../../../../services/ai_3d_engine/browser/cad.js';
import Agents from '../../../../services/ai_3d_engine/browser/agents.js';
import { anthropicConfigured, askJson, type AskOptions } from '../anthropic.ts';
import type { EngineMetadata } from '../engine-client.ts';
import { ProviderError } from '../errors.ts';
import type { GenerationInput, ModelGenerationProvider, StartResult } from '../provider.ts';

type Ask = (prompt: string, opts: AskOptions) => Promise<unknown>;

export class AiDesignerProvider implements ModelGenerationProvider {
  readonly id = 'AI_DESIGNER' as const;
  readonly paid = false; // no external task is created; a retry only re-runs the model call

  constructor(private readonly ask: Ask = askJson) {}

  configured() {
    return this.ask !== askJson || anthropicConfigured()
      ? ({ ok: true } as const)
      : ({ ok: false, reason: 'ANTHROPIC_API_KEY is not set' } as const);
  }

  async start(input: GenerationInput): Promise<StartResult> {
    const qa = input.designQa ?? [];
    const brief = Agents.briefOf(input.prompt, input.designUnderstanding ?? '', qa);
    const out = await Agents.designLoop({
      ask: (p: string, o: AskOptions) => this.ask(p, o),
      build: (d: unknown) => CAD.generateDesign(d, {}, input.constraints),
      render: null, // the server has no GPU renderer; the browser studio adds visual inspection
      onStep: () => undefined,
    }, brief, { maxRepairs: 2, inspect: false });
    if (!out.result) {
      throw new ProviderError('GEOMETRY_INVALID', `AI design could not be built after repairs: ${(out.error as { message?: string } | undefined)?.message ?? 'unknown'}`, false, false, out.error);
    }
    const r = out.result;
    const stl = Buffer.from(r.stl);
    const metadata: EngineMetadata = {
      status: r.status,
      stl_sha256: createHash('sha256').update(stl).digest('hex'),
      stl_bytes: stl.length,
      size_mm: r.size_mm,
      triangles: r.triangles,
      validation: r.validation,
      post_export_validation: r.post_export_validation,
      transforms: r.transforms,
      spec: {
        template: null, design: out.design, values: r.params, brief,
        // measured requirement checks, manufacturability and print estimate (face flags dropped: viewer-only)
        analysis: r.analysis ? { checks: r.analysis.checks, dfm: { issues: r.analysis.dfm.issues, stats: r.analysis.dfm.stats }, estimate: r.analysis.estimate } : null,
      },
      source_format: 'formacad',
      duration_ms: r.duration_ms,
    };
    return { kind: 'direct', stl, metadata, model: `ai-designer:${out.design.name_ar ?? 'design'}` };
  }
}
