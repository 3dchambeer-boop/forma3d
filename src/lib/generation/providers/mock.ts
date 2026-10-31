// =====================================================================
// MockProvider — DEVELOPMENT AND TESTS ONLY.
//
// Exercises the asynchronous provider path (task id → poll → download →
// engine conversion) without a paid API. It always returns a 20 mm cube and
// is stored with provider = MOCK, so its output can never be mistaken for an
// AI result. It refuses to run when NODE_ENV=production.
// =====================================================================

import { ProviderError } from '../errors.ts';
import type { DownloadedOutput, GenerationInput, ModelGenerationProvider, PollResult, StartResult } from '../provider.ts';

const CUBE_OBJ = [
  'v 0 0 0', 'v 20 0 0', 'v 20 20 0', 'v 0 20 0', 'v 0 0 20', 'v 20 0 20', 'v 20 20 20', 'v 0 20 20',
  'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5', 'f 3 4 8 7', 'f 2 3 7 6', 'f 4 1 5 8',
].join('\n');

export class MockProvider implements ModelGenerationProvider {
  readonly id = 'MOCK' as const;
  readonly paid = false;
  readonly pollIntervalMs = 10;
  private polls = new Map<string, number>();

  configured() {
    if (process.env.NODE_ENV === 'production') return { ok: false, reason: 'MOCK provider is disabled in production' } as const;
    if (process.env.ENABLE_MOCK_PROVIDER !== '1') return { ok: false, reason: 'set ENABLE_MOCK_PROVIDER=1 to use the mock provider' } as const;
    return { ok: true } as const;
  }

  async start(input: GenerationInput): Promise<StartResult> {
    const c = this.configured();
    if (!c.ok) throw new ProviderError('NOT_CONFIGURED', c.reason);
    return { kind: 'pending', externalTaskId: `mock-${input.jobId}`, model: 'mock-cube-20mm' };
  }

  async poll(taskId: string): Promise<PollResult> {
    const n = (this.polls.get(taskId) ?? 0) + 1;
    this.polls.set(taskId, n);
    return n < 2 ? { state: 'pending', progress: 50 } : { state: 'succeeded', progress: 100, outputUrl: 'mock://cube.obj' };
  }

  async download(): Promise<DownloadedOutput> {
    return { data: Buffer.from(CUBE_OBJ), filename: 'mock-cube.obj', sourceUnits: 'mm', upAxis: 'z' };
  }
}
