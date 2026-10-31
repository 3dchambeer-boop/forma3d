// =====================================================================
// OrcaSlicer CLI adapter.
//
// Flags follow the OrcaSlicer CLI documentation (orcaslicer.com/wiki/cli):
//   orca-slicer --slice 0
//               --load-settings "machine.json;process.json"
//               --load-filaments "filament.json"
//               --outputdir <dir> --export-3mf result.gcode.3mf
//               model.stl
// Presets are JSON files exported from OrcaSlicer; their paths are resolved
// inside ORCASLICER_PROFILE_DIR only. The previous adapter used
// --load-printer/--load-process/--load-filament, which the CLI does not
// document, so it could not have worked.
//
// G-code is taken from a loose *.gcode in the output dir if the build writes
// one, otherwise extracted from Metadata/plate_1.gcode inside the 3MF.
//
// Status: implemented against the documentation; NOT run against a real
// OrcaSlicer binary in this environment (see docs/PRINTING.md for the
// acceptance command).
// =====================================================================

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { access, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';

const execFileAsync = promisify(execFile);
const SLICE_TIMEOUT_MS = Number(process.env.ORCASLICER_TIMEOUT_MS || 10 * 60 * 1000);

export interface PresetFiles {
  machine: string;
  process: string;
  filament: string;
}

export interface OrcaSlicerResult {
  gcode: Buffer;
  sha256: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  args: string[];
  presetSha256: Record<keyof PresetFiles, string>;
  layerCount?: number;
  filamentLengthMm?: number;
  printTimeSec?: number;
}

export class OrcaSlicerError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_CONFIGURED' | 'PRESET_MISSING' | 'TIMEOUT' | 'EXECUTION_FAILED' | 'NO_OUTPUT' | 'INVALID_OUTPUT',
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'OrcaSlicerError';
  }
}

export async function isOrcaSlicerConfigured(): Promise<{ configured: boolean; binaryPath: string; reason?: string }> {
  const bin = process.env.ORCASLICER_BIN || '';
  if (!bin) return { configured: false, binaryPath: '', reason: 'ORCASLICER_BIN not set' };
  if (!process.env.ORCASLICER_PROFILE_DIR) return { configured: false, binaryPath: bin, reason: 'ORCASLICER_PROFILE_DIR not set' };
  try {
    await access(bin);
    return { configured: true, binaryPath: bin };
  } catch {
    return { configured: false, binaryPath: bin, reason: `binary not found at ${bin}` };
  }
}

/** Resolve preset paths from a SlicingProfile.config JSON; refuses anything outside the profile dir. */
export function resolvePresets(configJson: string): PresetFiles {
  const root = resolve(process.env.ORCASLICER_PROFILE_DIR || '');
  let cfg: Partial<PresetFiles>;
  try {
    cfg = JSON.parse(configJson) as Partial<PresetFiles>;
  } catch {
    throw new OrcaSlicerError('slicing profile config is not JSON', 'PRESET_MISSING');
  }
  const out = {} as PresetFiles;
  for (const k of ['machine', 'process', 'filament'] as const) {
    const rel = cfg[k];
    if (!rel || typeof rel !== 'string' || !rel.endsWith('.json')) {
      throw new OrcaSlicerError(`slicing profile has no ${k} preset (.json)`, 'PRESET_MISSING');
    }
    const full = resolve(root, rel);
    if (!full.startsWith(root + sep)) throw new OrcaSlicerError(`${k} preset path escapes ORCASLICER_PROFILE_DIR`, 'PRESET_MISSING');
    if (!existsSync(full)) throw new OrcaSlicerError(`${k} preset not found: ${rel}`, 'PRESET_MISSING');
    out[k] = full;
  }
  return out;
}

export function buildArgs(modelPath: string, presets: PresetFiles, outDir: string): string[] {
  return [
    '--slice', '0',
    '--load-settings', `${presets.machine};${presets.process}`,
    '--load-filaments', presets.filament,
    '--outputdir', outDir,
    '--export-3mf', 'result.gcode.3mf',
    modelPath,
  ];
}

/** Extract one entry from a ZIP archive (3MF is a ZIP). Supports stored and deflate entries. */
export function extractZipEntry(zip: Buffer, wanted: (name: string) => boolean): { name: string; data: Buffer } | null {
  // find End Of Central Directory record
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOff = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (wanted(name)) {
      const lNameLen = zip.readUInt16LE(localOff + 26);
      const lExtraLen = zip.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = zip.subarray(start, start + compSize);
      if (method === 0) return { name, data: Buffer.from(raw) };
      if (method === 8) return { name, data: inflateRawSync(raw, { maxOutputLength: 512 * 1024 * 1024 }) };
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

export function parseGcodeStats(gcode: Buffer): Pick<OrcaSlicerResult, 'layerCount' | 'filamentLengthMm' | 'printTimeSec'> {
  const head = gcode.subarray(0, 256 * 1024).toString('utf8');
  const tail = gcode.subarray(Math.max(0, gcode.length - 256 * 1024)).toString('utf8');
  const text = head + '\n' + tail;
  const num = (re: RegExp) => { const m = text.match(re); return m ? Number(m[1]) : undefined; };
  const time = text.match(/;\s*(?:model printing time|estimated printing time \(normal mode\))\s*[:=]\s*([^;\n]+)/i);
  let printTimeSec: number | undefined;
  if (time) {
    const t = time[1];
    const part = (u: string) => Number(t.match(new RegExp(`(\\d+)${u}`))?.[1] ?? 0);
    printTimeSec = part('d') * 86400 + part('h') * 3600 + part('m') * 60 + part('s') || undefined;
  }
  return {
    layerCount: num(/;\s*total layers? count\s*=\s*(\d+)/i) ?? num(/;\s*total layers\s*=\s*(\d+)/i),
    filamentLengthMm: num(/;\s*total filament length \[mm\]\s*:\s*([\d.]+)/i) ?? num(/;\s*filament used \[mm\]\s*=\s*([\d.]+)/i),
    printTimeSec,
  };
}

export async function runOrcaSlicer(params: { modelPath: string; profileConfigJson: string }): Promise<OrcaSlicerResult> {
  const t0 = Date.now();
  const cfg = await isOrcaSlicerConfigured();
  if (!cfg.configured) throw new OrcaSlicerError(cfg.reason || 'OrcaSlicer not configured', 'NOT_CONFIGURED');
  if (!existsSync(params.modelPath)) throw new OrcaSlicerError(`model file not found`, 'EXECUTION_FAILED');
  const presets = resolvePresets(params.profileConfigJson);
  const presetSha256 = {} as Record<keyof PresetFiles, string>;
  for (const k of ['machine', 'process', 'filament'] as const) {
    presetSha256[k] = createHash('sha256').update(await readFile(presets[k])).digest('hex');
  }

  const workDir = join(tmpdir(), `forma3d-slice-${randomBytes(8).toString('hex')}`);
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  const args = buildArgs(params.modelPath, presets, workDir);
  let stdout = '';
  let stderr = '';
  try {
    try {
      const r = await execFileAsync(cfg.binaryPath, args, {
        cwd: workDir,
        timeout: SLICE_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: 10 * 1024 * 1024,
        env: { PATH: process.env.PATH ?? '', HOME: workDir, LANG: 'C.UTF-8' } as unknown as NodeJS.ProcessEnv, // no app secrets leak into the slicer
      });
      stdout = r.stdout;
      stderr = r.stderr;
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; killed?: boolean; signal?: string; code?: number | string };
      if (err.killed || err.signal === 'SIGKILL') throw new OrcaSlicerError(`OrcaSlicer exceeded ${SLICE_TIMEOUT_MS / 1000}s`, 'TIMEOUT', err.stderr);
      throw new OrcaSlicerError(`OrcaSlicer failed (exit ${err.code}): ${(err.stderr || err.stdout || '').slice(-800)}`, 'EXECUTION_FAILED', err.stderr);
    }
    let gcode: Buffer | null = null;
    const files = await readdir(workDir);
    const loose = files.find((f) => f.toLowerCase().endsWith('.gcode'));
    if (loose) gcode = await readFile(join(workDir, loose));
    else if (files.includes('result.gcode.3mf')) {
      const entry = extractZipEntry(await readFile(join(workDir, 'result.gcode.3mf')), (n) => /^Metadata\/plate_\d+\.gcode$/.test(n));
      gcode = entry?.data ?? null;
    }
    if (!gcode) throw new OrcaSlicerError(`OrcaSlicer finished but produced no G-code (files: ${files.join(', ') || 'none'})`, 'NO_OUTPUT', stderr);
    return {
      gcode,
      sha256: createHash('sha256').update(gcode).digest('hex'),
      stdout,
      stderr,
      durationMs: Date.now() - t0,
      args,
      presetSha256,
      ...parseGcodeStats(gcode),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
