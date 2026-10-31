// =====================================================================
// Client for the internal ai_3d_engine service (services/ai_3d_engine).
// Server-side only: the engine token never reaches a browser.
// =====================================================================

import { ProviderError, isTransientHttpStatus } from './errors.ts';

export interface EngineConstraints {
  build_volume_mm?: [number, number, number];
  min_wall_thickness_mm?: number;
  nozzle_diameter_mm?: number;
}

/** Subset of the engine's PipelineResult.metadata() that the app relies on. */
export interface EngineMetadata {
  status: 'VALIDATED' | 'VALID_WITH_WARNINGS' | 'REPAIR_REQUIRED' | 'INVALID' | 'VALIDATION_FAILED';
  stl_sha256: string;
  stl_bytes: number;
  size_mm: { x: number; y: number; z: number } | null;
  triangles: number;
  validation: unknown;
  post_export_validation: { status: string; issues: { code: string; severity: string; message: string; count: number | null }[] } & Record<string, unknown>;
  transforms: string[];
  spec: Record<string, unknown> | null;
  source_format: string | null;
  duration_ms: number;
}

export interface EngineJobResult {
  artifactId: string;
  metadata: EngineMetadata;
}

export class EngineClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 240_000,
  ) {}

  static fromEnv(): EngineClient | null {
    const url = process.env.ENGINE_URL;
    const token = process.env.ENGINE_SERVICE_TOKEN;
    if (!url || !token) return null;
    return new EngineClient(url.replace(/\/$/, ''), token);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers || {}), 'X-Engine-Token': this.token },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new ProviderError('TRANSIENT', `geometry engine unreachable: ${(e as Error).message}`, true);
    }
    if (!res.ok) {
      let detail: { code?: string; message?: string; details?: unknown } = {};
      try {
        const body = (await res.json()) as { detail?: typeof detail };
        detail = body.detail ?? {};
      } catch {
        /* non-JSON error body */
      }
      const code = detail.code === 'GEOMETRY_INVALID' || detail.code === 'UNREADABLE_MESH' || detail.code === 'INVALID_PARAMETERS' || detail.code === 'NO_TEMPLATE'
        ? 'GEOMETRY_INVALID'
        : 'ENGINE_ERROR';
      throw new ProviderError(
        isTransientHttpStatus(res.status) && code === 'ENGINE_ERROR' ? 'TRANSIENT' : code,
        `engine ${path} → HTTP ${res.status}: ${detail.code ?? ''} ${detail.message ?? ''}`.trim(),
        isTransientHttpStatus(res.status) && code === 'ENGINE_ERROR',
        false,
        detail,
      );
    }
    return res;
  }

  async generateParametric(input: {
    prompt: string;
    userFields?: Record<string, number>;
    template?: string | null;
    intendedUse?: string | null;
    constraints?: EngineConstraints;
  }): Promise<EngineJobResult> {
    const res = await this.request('/v1/generate/parametric', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: input.prompt,
        user_fields: input.userFields ?? {},
        template: input.template ?? null,
        intended_use: input.intendedUse ?? null,
        constraints: input.constraints ?? {},
      }),
    });
    const body = (await res.json()) as { artifact_id: string; metadata: EngineMetadata };
    return { artifactId: body.artifact_id, metadata: body.metadata };
  }

  async processMesh(file: Buffer, filename: string, opts: {
    sourceUnits?: 'mm' | 'cm' | 'm' | 'in';
    upAxis?: 'y' | 'z';
    targetLongestMm?: number | null;
    constraints?: EngineConstraints;
  } = {}): Promise<EngineJobResult> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)]), filename);
    if (opts.sourceUnits) form.append('source_units', opts.sourceUnits);
    if (opts.upAxis) form.append('up_axis', opts.upAxis);
    if (opts.targetLongestMm) form.append('target_longest_mm', String(opts.targetLongestMm));
    if (opts.constraints) form.append('constraints', JSON.stringify(opts.constraints));
    const res = await this.request('/v1/mesh/process', { method: 'POST', body: form });
    const body = (await res.json()) as { artifact_id: string; metadata: EngineMetadata };
    return { artifactId: body.artifact_id, metadata: body.metadata };
  }

  async fetchArtifact(artifactId: string): Promise<Buffer> {
    if (!/^[0-9a-f]{32}$/.test(artifactId)) throw new ProviderError('ENGINE_ERROR', 'malformed artifact id');
    const res = await this.request(`/v1/artifacts/${artifactId}`, { method: 'GET' });
    const buf = Buffer.from(await res.arrayBuffer());
    // best-effort cleanup; the engine's TTL sweep removes it anyway
    this.request(`/v1/artifacts/${artifactId}`, { method: 'DELETE' }).catch(() => undefined);
    return buf;
  }

  /** Text → structured DesignSpec (template, parameters with sources, clarifications). No geometry is built. */
  async parseSpec(input: { prompt: string; userFields?: Record<string, number>; template?: string | null; intendedUse?: string | null }): Promise<Record<string, unknown>> {
    const res = await this.request('/v1/spec/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: input.prompt,
        user_fields: input.userFields ?? {},
        template: input.template ?? null,
        intended_use: input.intendedUse ?? null,
      }),
    });
    return (await res.json()) as Record<string, unknown>;
  }

  async capabilities(): Promise<Record<string, unknown>> {
    const res = await this.request('/v1/capabilities', { method: 'GET' });
    return (await res.json()) as Record<string, unknown>;
  }
}
