// =====================================================================
// ModelGenerationProvider — one contract for every generation backend.
//
// Two shapes of provider exist:
//   * synchronous ("final"): the parametric CAD engine returns a finished,
//     validated STL in one call;
//   * asynchronous ("pending"): Tripo / self-hosted models return a task id
//     that is polled, and an output file that must be downloaded and
//     converted by the engine.
// The worker handles both without knowing which backend it talks to.
// =====================================================================

import type { EngineConstraints, EngineJobResult, EngineMetadata } from './engine-client.ts';

export type ProviderId = 'PARAMETRIC' | 'AI_DESIGNER' | 'TRIPO' | 'MESHY' | 'RODIN' | 'SELF_HOSTED' | 'MOCK';

export interface GenerationInput {
  jobId: string;
  prompt: string;
  negativePrompt?: string | null;
  userFields: Record<string, number>;
  template?: string | null;
  intendedUse?: 'functional' | 'artistic' | 'prototype' | null;
  /** data:image/...;base64 reference image for image-to-3D (Tripo, Meshy, Rodin) */
  referenceImageDataUrl?: string | null;
  /** longest side in mm for free-form meshes; parametric parts use their own dimensions */
  targetLongestMm?: number | null;
  constraints?: EngineConstraints;
  /** AI designer: the customer's answers to the clarification questions */
  designQa?: { question: string; answer: string }[];
  designUnderstanding?: string | null;
}

export type StartResult =
  | { kind: 'final'; engine: EngineJobResult; model: string }
  | { kind: 'direct'; stl: Buffer; metadata: EngineMetadata; model: string }
  | { kind: 'pending'; externalTaskId: string; model: string };

export interface PollResult {
  state: 'pending' | 'succeeded' | 'failed';
  /** provider-reported progress 0–100, only when the provider reports one */
  progress?: number;
  outputUrl?: string;
  creditsConsumed?: number;
  error?: string;
}

export interface DownloadedOutput {
  data: Buffer;
  filename: string;
  /** how the provider's file should be interpreted by the engine */
  sourceUnits?: 'mm' | 'cm' | 'm' | 'in';
  upAxis?: 'y' | 'z';
}

export interface ModelGenerationProvider {
  readonly id: ProviderId;
  /** true when a request costs money — used by the duplicate-task policy */
  readonly paid: boolean;
  configured(): { ok: true } | { ok: false; reason: string };
  start(input: GenerationInput): Promise<StartResult>;
  poll?(externalTaskId: string): Promise<PollResult>;
  download?(poll: PollResult, externalTaskId: string): Promise<DownloadedOutput>;
  /** recommended delay between polls */
  readonly pollIntervalMs?: number;
}

export type ProviderRegistry = Partial<Record<ProviderId, ModelGenerationProvider>>;
