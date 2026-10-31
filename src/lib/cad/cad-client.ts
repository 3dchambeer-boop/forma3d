// =====================================================================
// Client for the OpenCascade CAD service (services/cad_engine).
//   CAD_ENGINE_URL      e.g. http://127.0.0.1:8200
//   CAD_SERVICE_TOKEN   shared secret (X-CAD-Token)
// The service builds the FormaCAD design as an exact B-Rep and returns STEP / STL / 3MF,
// each with its own re-read check. Nothing here fakes a result: no service, no export.
// =====================================================================

export type CadFormat = 'step' | 'stl' | '3mf';
export interface CadQuality { linear_mm: number; angular_deg: number }
export interface CadExport { bytes: Buffer; check: Record<string, unknown> }
export interface CadBuildResult { report: Record<string, unknown>; exports: Partial<Record<CadFormat, CadExport>> }

export class CadServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly path?: string) { super(message); }
}

export class CadClient {
  constructor(private readonly base: string, private readonly token: string, private readonly fetchImpl: typeof fetch = fetch) {}

  static fromEnv(): CadClient | null {
    const url = process.env.CAD_ENGINE_URL;
    return url ? new CadClient(url.replace(/\/+$/, ''), process.env.CAD_SERVICE_TOKEN || '') : null;
  }

  async health(): Promise<{ ok: boolean; kernel: string | null }> {
    const res = await this.fetchImpl(`${this.base}/v1/cad/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new CadServiceError(res.status, 'UNAVAILABLE', `CAD service HTTP ${res.status}`);
    return (await res.json()) as { ok: boolean; kernel: string | null };
  }

  async build(design: unknown, overrides: Record<string, number>, formats: CadFormat[], quality: CadQuality = { linear_mm: 0.01, angular_deg: 5 }): Promise<CadBuildResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/v1/cad/build`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.token ? { 'x-cad-token': this.token } : {}) },
        body: JSON.stringify({ design, overrides, formats, quality }),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new CadServiceError(503, 'UNAVAILABLE', `CAD service unreachable: ${(e as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { detail?: { code?: string; message?: string; path?: string } } & { report?: Record<string, unknown>; exports?: Record<string, { base64: string; check: Record<string, unknown> }> };
    if (!res.ok) {
      const d = body.detail ?? {};
      throw new CadServiceError(res.status, d.code ?? 'CAD_ERROR', d.message ?? `CAD service HTTP ${res.status}`, d.path);
    }
    const exports: CadBuildResult['exports'] = {};
    for (const f of formats) {
      const e = body.exports?.[f];
      if (!e) throw new CadServiceError(502, 'MISSING_EXPORT', `the CAD service returned no ${f} file`);
      if (f === 'step' && e.check?.ok !== true) throw new CadServiceError(502, 'STEP_CHECK_FAILED', 'the STEP file did not re-open with the same volume and bounds');
      exports[f] = { bytes: Buffer.from(e.base64, 'base64'), check: e.check };
    }
    return { report: body.report ?? {}, exports };
  }

  /** Import a STEP file (exact B-Rep, converted to mm, healed) and get printable meshes back. */
  async importStep(step: Uint8Array, formats: Exclude<CadFormat, 'step'>[] = ['stl'], quality: CadQuality = { linear_mm: 0.05, angular_deg: 10 }): Promise<CadBuildResult & { import: Record<string, unknown> }> {
    if (!/^\s*ISO-10303-21/.test(Buffer.from(step.subarray(0, 64)).toString('latin1'))) throw new CadServiceError(400, 'NOT_STEP', 'not a STEP file (ISO-10303-21 header missing)');
    const qs = new URLSearchParams({ formats: formats.join(','), linear_mm: String(quality.linear_mm), angular_deg: String(quality.angular_deg) });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/v1/cad/import?${qs}`, {
        method: 'POST',
        headers: { 'content-type': 'application/step', ...(this.token ? { 'x-cad-token': this.token } : {}) },
        body: new Uint8Array(step), // a plain ArrayBuffer-backed copy (BodyInit)
        signal: AbortSignal.timeout(180_000),
      });
    } catch (e) {
      throw new CadServiceError(503, 'UNAVAILABLE', `CAD service unreachable: ${(e as Error).message}`);
    }
    const body = (await res.json().catch(() => ({}))) as { detail?: { code?: string; message?: string; path?: string }; report?: Record<string, unknown>; import?: Record<string, unknown>; exports?: Record<string, { base64: string; check: Record<string, unknown> }> };
    if (!res.ok) {
      const d = body.detail ?? {};
      throw new CadServiceError(res.status, d.code ?? 'CAD_ERROR', d.message ?? `CAD service HTTP ${res.status}`, d.path);
    }
    const exports: CadBuildResult['exports'] = {};
    for (const f of formats) {
      const e = body.exports?.[f];
      if (!e) throw new CadServiceError(502, 'MISSING_EXPORT', `the CAD service returned no ${f} file`);
      exports[f] = { bytes: Buffer.from(e.base64, 'base64'), check: e.check };
    }
    return { report: body.report ?? {}, import: body.import ?? {}, exports };
  }
}
