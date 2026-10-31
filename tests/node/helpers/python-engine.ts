// Runs the REAL ai_3d_engine pipelines (Python) behind the EngineClient method
// shape, so worker tests produce genuine STL geometry. Only the HTTP hop is
// skipped; that layer is covered by services/ai_3d_engine/tests/test_http_api.py.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProviderError } from '../../../src/lib/generation/errors.ts';
import type { EngineJobResult, EngineMetadata } from '../../../src/lib/generation/engine-client.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const ENGINE_DIR = join(ROOT, 'services/ai_3d_engine');
const BRIDGE = join(import.meta.dirname, 'engine_bridge.py');

export class PythonEngine {
  private artifacts = new Map<string, Buffer>();
  private dir = mkdtempSync(join(tmpdir(), 'engine-test-'));
  calls: string[] = [];
  /** test hook: corrupt the next artifact to exercise the checksum guard */
  corruptNext = false;

  private run(task: string, kwargs: Record<string, unknown>, data?: Buffer): EngineJobResult {
    const id = randomBytes(16).toString('hex');
    const out = join(this.dir, `${id}.stl`);
    let dataPath: string | undefined;
    if (data) {
      dataPath = join(this.dir, `${id}.in`);
      writeFileSync(dataPath, data);
    }
    const stdout = execFileSync('python3', [BRIDGE], {
      input: JSON.stringify({ task, kwargs, data_path: dataPath, out_path: out }),
      env: { ...process.env, PYTHONPATH: ENGINE_DIR },
      timeout: 120_000,
    }).toString();
    const parsed = JSON.parse(stdout) as { metadata?: EngineMetadata; error?: { code: string; message: string } };
    if (parsed.error) {
      throw new ProviderError('GEOMETRY_INVALID', `engine: ${parsed.error.code} ${parsed.error.message}`, false, false, parsed.error);
    }
    this.artifacts.set(id, readFileSync(out));
    return { artifactId: id, metadata: parsed.metadata! };
  }

  async generateParametric(input: { prompt: string; userFields?: Record<string, number>; template?: string | null; intendedUse?: string | null }) {
    this.calls.push('generateParametric');
    return this.run('parametric', {
      prompt: input.prompt, user_fields: input.userFields ?? {}, template: input.template ?? null,
      intended_use: input.intendedUse ?? null, use_llm: false,
    });
  }

  async processMesh(file: Buffer, filename: string, opts: { sourceUnits?: string; upAxis?: string; targetLongestMm?: number | null } = {}) {
    this.calls.push('processMesh');
    return this.run('mesh', {
      filename, source_units: opts.sourceUnits ?? null, up_axis: opts.upAxis ?? null,
      target_longest_mm: opts.targetLongestMm ?? null,
    }, file);
  }

  async fetchArtifact(id: string): Promise<Buffer> {
    const buf = this.artifacts.get(id);
    if (!buf) throw new ProviderError('ENGINE_ERROR', 'artifact not found');
    if (this.corruptNext) {
      this.corruptNext = false;
      const copy = Buffer.from(buf);
      copy[copy.length - 1] ^= 0xff;
      return copy;
    }
    return buf;
  }
}
