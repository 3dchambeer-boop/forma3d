// =====================================================================
// OctoPrint REST client + print-state interpretation.
//
// API reference: https://docs.octoprint.org/en/main/api/ (files, job, printer)
//   POST /api/files/local         multipart "file", "select", "print" → 201
//   GET  /api/files/local/{path}  file info (used to verify the upload)
//   POST /api/files/local/{path}  {"command":"select","print":false} → 204
//   POST /api/job                 {"command":"start"|"cancel"} / pause → 204, 409 if not possible
//   GET  /api/job                 {job:{file:{name,path}}, progress:{completion,...}, state}
//   GET  /api/printer             {state:{text, flags:{operational,printing,paused,ready,error,...}}, temperature}
// Authentication: X-Api-Key header. The key is read from an environment
// variable named by printer.octoprintApiKeyRef, never stored in the database.
// =====================================================================

export type OctoErrorCode = 'NOT_CONFIGURED' | 'UNREACHABLE' | 'AUTH' | 'CONFLICT' | 'NOT_OPERATIONAL' | 'BAD_RESPONSE' | 'UPLOAD_MISMATCH';

export class OctoPrintError extends Error {
  constructor(public readonly code: OctoErrorCode, message: string, public readonly status?: number) {
    super(message);
    this.name = 'OctoPrintError';
  }
}

export interface PrinterFlags {
  operational: boolean;
  printing: boolean;
  paused: boolean;
  pausing?: boolean;
  cancelling?: boolean;
  ready: boolean;
  error: boolean;
  closedOrError?: boolean;
}

export interface PrinterStatus {
  connected: boolean;
  text: string;
  flags: PrinterFlags | null;
  temperatures: { tool0?: { actual: number; target: number | null }; bed?: { actual: number; target: number | null } };
}

export interface JobStatus {
  state: string;
  fileName: string | null;
  filePath: string | null;
  completion: number | null; // percent, as OctoPrint reports it
  printTime: number | null;
  printTimeLeft: number | null;
  error: string | null;
}

export class OctoPrintClient {
  private readonly base: string;

  constructor(baseUrl: string, private readonly apiKey: string, private readonly timeoutMs = 20_000) {
    const u = new URL(baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new OctoPrintError('NOT_CONFIGURED', 'OctoPrint URL must be http(s)');
    this.base = u.toString().replace(/\/$/, '');
  }

  /** Build a client from a printer row. The API key comes from the env var the row names. */
  static forPrinter(p: { octoprintUrl: string | null; octoprintApiKeyRef: string | null }): OctoPrintClient {
    if (!p.octoprintUrl) throw new OctoPrintError('NOT_CONFIGURED', 'printer has no OctoPrint URL');
    if (!p.octoprintApiKeyRef || !/^[A-Z][A-Z0-9_]{2,63}$/.test(p.octoprintApiKeyRef)) {
      throw new OctoPrintError('NOT_CONFIGURED', 'printer has no valid OctoPrint API key reference (env var name)');
    }
    const key = process.env[p.octoprintApiKeyRef];
    if (!key) throw new OctoPrintError('NOT_CONFIGURED', `environment variable ${p.octoprintApiKeyRef} is not set`);
    return new OctoPrintClient(p.octoprintUrl, key);
  }

  private async req(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        ...init,
        headers: { ...(init.headers || {}), 'X-Api-Key': this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (e) {
      throw new OctoPrintError('UNREACHABLE', `OctoPrint unreachable: ${(e as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) throw new OctoPrintError('AUTH', `OctoPrint rejected the API key (HTTP ${res.status})`, res.status);
    return res;
  }

  async version(): Promise<{ api: string; server: string }> {
    const res = await this.req('/api/version');
    if (!res.ok) throw new OctoPrintError('BAD_RESPONSE', `GET /api/version → HTTP ${res.status}`, res.status);
    return (await res.json()) as { api: string; server: string };
  }

  async printer(): Promise<PrinterStatus> {
    const res = await this.req('/api/printer');
    if (res.status === 409) {
      // OctoPrint answers 409 when it has no serial connection to the printer
      return { connected: false, text: 'Not connected', flags: null, temperatures: {} };
    }
    if (!res.ok) throw new OctoPrintError('BAD_RESPONSE', `GET /api/printer → HTTP ${res.status}`, res.status);
    const b = (await res.json()) as { state?: { text?: string; flags?: PrinterFlags }; temperature?: PrinterStatus['temperatures'] };
    return { connected: true, text: b.state?.text ?? 'unknown', flags: b.state?.flags ?? null, temperatures: b.temperature ?? {} };
  }

  async job(): Promise<JobStatus> {
    const res = await this.req('/api/job');
    if (!res.ok) throw new OctoPrintError('BAD_RESPONSE', `GET /api/job → HTTP ${res.status}`, res.status);
    const b = (await res.json()) as {
      job?: { file?: { name?: string | null; path?: string | null } };
      progress?: { completion?: number | null; printTime?: number | null; printTimeLeft?: number | null };
      state?: string;
      error?: string;
    };
    return {
      state: b.state ?? 'unknown',
      fileName: b.job?.file?.name ?? null,
      filePath: b.job?.file?.path ?? null,
      completion: b.progress?.completion ?? null,
      printTime: b.progress?.printTime ?? null,
      printTimeLeft: b.progress?.printTimeLeft ?? null,
      error: b.error ?? null,
    };
  }

  /** Upload without selecting or printing; then verify OctoPrint stored the exact size. */
  async upload(gcode: Buffer, filename: string): Promise<{ path: string }> {
    if (!/^[A-Za-z0-9._-]{1,120}\.gcode$/.test(filename)) throw new OctoPrintError('BAD_RESPONSE', 'unsafe G-code filename');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(gcode)], { type: 'application/octet-stream' }), filename);
    form.append('select', 'false');
    form.append('print', 'false');
    const res = await this.req('/api/files/local', { method: 'POST', body: form });
    if (res.status === 409) throw new OctoPrintError('CONFLICT', 'OctoPrint refused the upload (file in use or printer busy)', 409);
    if (res.status !== 201) throw new OctoPrintError('BAD_RESPONSE', `upload → HTTP ${res.status}`, res.status);
    const b = (await res.json()) as { done?: boolean; files?: { local?: { path?: string; name?: string } } };
    const path = b.files?.local?.path ?? b.files?.local?.name;
    if (!b.done || !path) throw new OctoPrintError('BAD_RESPONSE', 'upload response missing done/path');
    const info = await this.req(`/api/files/local/${encodeURIComponent(path)}`);
    if (!info.ok) throw new OctoPrintError('UPLOAD_MISMATCH', `uploaded file not found on OctoPrint (HTTP ${info.status})`);
    const meta = (await info.json()) as { size?: number };
    if (meta.size !== gcode.length) {
      throw new OctoPrintError('UPLOAD_MISMATCH', `OctoPrint stored ${meta.size} bytes, expected ${gcode.length}`);
    }
    return { path };
  }

  async select(path: string): Promise<void> {
    const res = await this.req(`/api/files/local/${encodeURIComponent(path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'select', print: false }),
    });
    if (res.status === 409) throw new OctoPrintError('CONFLICT', 'cannot select file now (printer busy?)', 409);
    if (res.status !== 204) throw new OctoPrintError('BAD_RESPONSE', `select → HTTP ${res.status}`, res.status);
  }

  private async jobCommand(body: Record<string, string>): Promise<void> {
    const res = await this.req('/api/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) throw new OctoPrintError('CONFLICT', `job command ${body.command} not possible in current printer state`, 409);
    if (res.status !== 204) throw new OctoPrintError('BAD_RESPONSE', `job ${body.command} → HTTP ${res.status}`, res.status);
  }

  start(): Promise<void> { return this.jobCommand({ command: 'start' }); }
  cancel(): Promise<void> { return this.jobCommand({ command: 'cancel' }); }
  pause(): Promise<void> { return this.jobCommand({ command: 'pause', action: 'pause' }); }
  resume(): Promise<void> { return this.jobCommand({ command: 'pause', action: 'resume' }); }
}

// ------------------------------------------------------------------ pure helpers

/** Reasons the printer cannot start a job right now; empty means ready. */
export function notReadyReasons(s: PrinterStatus): string[] {
  if (!s.connected || !s.flags) return ['printer is not connected to OctoPrint'];
  const f = s.flags;
  const r: string[] = [];
  if (!f.operational) r.push('printer is not operational');
  if (f.error || f.closedOrError) r.push(`printer reports an error (${s.text})`);
  if (f.printing || f.paused || f.pausing || f.cancelling) r.push(`printer is busy (${s.text})`);
  if (!f.ready) r.push('printer is not ready');
  return r;
}

export type TrackedStatus = 'PRINTING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'UNKNOWN';

/**
 * Interpret OctoPrint's job report for OUR file.
 * COMPLETED is only returned when OctoPrint itself shows our file finished at
 * 100 % and the printer is back to an idle operational state.
 */
export function interpretJob(job: JobStatus, ourPath: string, cancelRequested: boolean): { status: TrackedStatus; progress: number | null; note: string } {
  const isOurs = job.filePath === ourPath || job.fileName === ourPath;
  const pct = job.completion === null ? null : Math.max(0, Math.min(100, job.completion));
  const state = job.state.toLowerCase();
  if (!isOurs) return { status: 'UNKNOWN', progress: null, note: `printer is on a different file (${job.fileName ?? 'none'})` };
  if (state.startsWith('printing')) return { status: 'PRINTING', progress: pct, note: job.state };
  if (state.startsWith('paus')) return { status: 'PAUSED', progress: pct, note: job.state };
  if (state.startsWith('cancelling')) return { status: 'PRINTING', progress: pct, note: job.state };
  if (state.includes('error') || state.startsWith('offline')) {
    return { status: 'FAILED', progress: pct, note: job.error ?? job.state };
  }
  if (state.startsWith('operational')) {
    if (pct !== null && pct >= 100) return { status: 'COMPLETED', progress: 100, note: 'OctoPrint reports the file finished' };
    return cancelRequested
      ? { status: 'CANCELLED', progress: pct, note: 'cancelled by operator' }
      : { status: 'UNKNOWN', progress: pct, note: 'printer idle but the job did not reach 100 %; needs operator check' };
  }
  return { status: 'UNKNOWN', progress: pct, note: job.state };
}

/** Minimal G-code sanity check before anything is sent to a machine. */
export function checkGcode(gcode: Buffer): string[] {
  const problems: string[] = [];
  if (gcode.length === 0) return ['G-code file is empty'];
  const text = gcode.subarray(0, Math.min(gcode.length, 4 * 1024 * 1024)).toString('utf8');
  if (!/^\s*G[01]\s/m.test(text)) problems.push('no G0/G1 motion commands');
  if (!/^\s*M1(04|09|40|90)\s/m.test(text)) problems.push('no heater commands (M104/M109/M140/M190)');
  if (text.includes('\u0000')) problems.push('binary data inside G-code');
  return problems;
}
