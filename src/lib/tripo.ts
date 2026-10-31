// =====================================================================
// FORMA·3D Tripo3D Adapter — Real V3 API integration
//
// Implements:
//   - text-to-3D generation via POST /v3/generation/text-to-model
//   - task polling via GET /v3/tasks/{task_id}
//   - GLB download from output.model_url
//   - error normalization with clear messages
//   - credit check via GET /v3/account/balance
//
// Docs: https://developers.tripo3d.ai/en/docs/introduction
// =====================================================================

import { writeFileSync } from 'fs';
import { join } from 'path';

// Read per call (not at import) so integration tests can point the adapter at a local simulator.
function apiBase(): string {
  return (process.env.TRIPO_API_BASE || 'https://openapi.tripo3d.ai/v3').replace(/\/$/, '');
}

function getApiKey(): string | null {
  const key = process.env.TRIPO_API_KEY;
  if (!key || key.trim() === '') return null;
  return key.trim();
}

export interface TripoTaskCreated {
  taskId: string;
  raw: unknown;
}

export interface TripoTaskStatus {
  status: 'queued' | 'running' | 'success' | 'failed' | 'cancelled' | 'unknown';
  progress: number;
  modelUrl?: string;
  renderedImageUrl?: string;
  creditsConsumed?: number;
  errorMessage?: string;
  raw: unknown;
}

export interface TripoBalance {
  balance: number;
  frozen: number;
}

export class TripoError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_API_KEY' | 'INSUFFICIENT_CREDIT' | 'API_ERROR' | 'TASK_FAILED' | 'DOWNLOAD_FAILED' | 'TIMEOUT',
    public readonly statusCode?: number,
    public readonly raw?: unknown
  ) {
    super(message);
    this.name = 'TripoError';
  }
}

function authHeaders(): HeadersInit {
  const key = getApiKey();
  if (!key) throw new TripoError('TRIPO_API_KEY is not configured', 'NO_API_KEY');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
}

/** Check if Tripo is configured (without exposing the key) */
export function isTripoConfigured(): boolean {
  return getApiKey() !== null;
}

/** Get account balance (used to verify the key works and check credits before generation) */
export async function getBalance(): Promise<TripoBalance> {
  const res = await fetch(`${apiBase()}/account/balance`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new TripoError(
      `Balance check failed: HTTP ${res.status}`,
      'API_ERROR',
      res.status
    );
  }
  const json = await res.json() as { code: number; data?: TripoBalance; message?: string };
  if (json.code !== 0 || !json.data) {
    throw new TripoError(
      `Balance check failed: ${json.message || 'unknown error'}`,
      'API_ERROR',
      undefined,
      json
    );
  }
  return json.data;
}

export interface CreateTextToModelParams {
  prompt: string;
  negativePrompt?: string;
  /** AI model version. Default: 'v2.5-20250123' (balanced, cheapest). */
  model?: 'v3.1-20260211' | 'v3.0-20250812' | 'v2.5-20250123';
  /** Max polygon count. Default: 10000 (good for 3D printing). */
  faceLimit?: number;
  /** Generate texture maps. Default: false (geometry-only for 3D printing). */
  texture?: boolean;
  /** Enable PBR material maps. Default: false. */
  pbr?: boolean;
  /** Scale to real-world dimensions. Default: false. */
  autoSize?: boolean;
}

/** Submit a text-to-3D generation task. Returns the task_id immediately. */
export async function createTextToModelTask(params: CreateTextToModelParams): Promise<TripoTaskCreated> {
  // Pre-flight: check balance to give a clear error before consuming credits
  let balance: TripoBalance;
  try {
    balance = await getBalance();
  } catch (e) {
    // Balance check is best-effort — continue if it fails
    balance = { balance: -1, frozen: -1 };
  }
  if (balance.balance === 0) {
    throw new TripoError(
      'Your Tripo account has 0 credits. Please recharge at https://platform.tripo3d.ai before generating models.',
      'INSUFFICIENT_CREDIT'
    );
  }

  const body: Record<string, unknown> = {
    prompt: params.prompt,
    model: params.model || 'v2.5-20250123',
    texture: params.texture ?? false,
    pbr: params.pbr ?? false,
    face_limit: params.faceLimit ?? 10000,
    auto_size: params.autoSize ?? false,
  };
  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;

  const res = await fetch(`${apiBase()}/generation/text-to-model`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  const json = await res.json() as {
    code: number;
    data?: { task_id: string };
    message?: string;
    suggestion?: string;
  };

  if (json.code !== 0 || !json.data?.task_id) {
    if (json.code === 2010 || (json.message && json.message.toLowerCase().includes('credit'))) {
      throw new TripoError(
        `Insufficient Tripo credits: ${json.message}. ${json.suggestion || ''}`.trim(),
        'INSUFFICIENT_CREDIT',
        res.status,
        json
      );
    }
    throw new TripoError(
      `Tripo task creation failed: ${json.message || `HTTP ${res.status}`}`,
      'API_ERROR',
      res.status,
      json
    );
  }

  return {
    taskId: json.data.task_id,
    raw: json,
  };
}

/** Query task status. Poll this every 3-5 seconds. */
export async function getTaskStatus(taskId: string): Promise<TripoTaskStatus> {
  const res = await fetch(`${apiBase()}/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new TripoError(
      `Task query failed: HTTP ${res.status}`,
      'API_ERROR',
      res.status
    );
  }

  const json = await res.json() as {
    code: number;
    data?: {
      task_id: string;
      status: string;
      progress: number;
      output?: { model_url?: string; rendered_image_url?: string };
      credits_consumed?: number;
    };
    message?: string;
  };

  if (json.code !== 0 || !json.data) {
    return {
      status: 'unknown',
      progress: 0,
      errorMessage: json.message || 'Unknown error',
      raw: json,
    };
  }

  const status = json.data.status as TripoTaskStatus['status'];
  return {
    status,
    progress: json.data.progress ?? 0,
    modelUrl: json.data.output?.model_url,
    renderedImageUrl: json.data.output?.rendered_image_url,
    creditsConsumed: json.data.credits_consumed,
    errorMessage: status === 'failed' ? 'Tripo generation failed' : undefined,
    raw: json,
  };
}

/**
 * Poll a task until it succeeds or fails (with timeout).
 * @param taskId The Tripo task ID
 * @param onProgress Optional callback fired on each poll with the latest status
 * @param timeoutMs Default 5 minutes
 * @param pollIntervalMs Default 5 seconds (Tripo recommends ≥2s)
 */
export async function pollTaskUntilComplete(
  taskId: string,
  onProgress?: (status: TripoTaskStatus) => void,
  timeoutMs = 5 * 60 * 1000,
  pollIntervalMs = 5000
): Promise<TripoTaskStatus> {
  const startTime = Date.now();
  let lastStatus: TripoTaskStatus | null = null;

  while (Date.now() - startTime < timeoutMs) {
    const status = await getTaskStatus(taskId);
    lastStatus = status;
    onProgress?.(status);

    if (status.status === 'success') {
      return status;
    }
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new TripoError(
        status.errorMessage || `Task ${status.status}`,
        'TASK_FAILED',
        undefined,
        status.raw
      );
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new TripoError(
    `Task timed out after ${Math.round(timeoutMs / 1000)}s. Last status: ${lastStatus?.status || 'unknown'} (${lastStatus?.progress || 0}%)`,
    'TIMEOUT',
    undefined,
    lastStatus?.raw
  );
}

/**
 * Download the generated GLB model file and save it to public/models/.
 * Returns the local URL path that can be stored in the database and served by Next.js.
 *
 * Note: model_url from Tripo expires after 5 minutes — call this immediately after success.
 */
export async function downloadModelToLocal(
  modelUrl: string,
  localFilename: string
): Promise<{ localUrl: string; sizeBytes: number; checksum: string }> {
  const res = await fetch(modelUrl, {
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    throw new TripoError(
      `Model download failed: HTTP ${res.status}`,
      'DOWNLOAD_FAILED',
      res.status
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) {
    throw new TripoError('Downloaded model is empty', 'DOWNLOAD_FAILED');
  }

  // Save to public/models/
  const outPath = join(process.cwd(), 'public', 'models', localFilename);
  writeFileSync(outPath, buf);

  // Compute checksum
  const crypto = await import('crypto');
  const checksum = `sha256:${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}`;

  return {
    localUrl: `/models/${localFilename}`,
    sizeBytes: buf.length,
    checksum,
  };
}

/**
 * Upload an image file to Tripo and get a file_token.
 * Used before image-to-3D generation.
 *
 * @param imageBuffer Raw image bytes (PNG/JPEG/WebP, max 20MB)
 * @param filename Filename with extension (e.g. "reference.png")
 */
export async function uploadImageFile(
  imageBuffer: Buffer,
  filename: string
): Promise<string> {
  const key = getApiKey();
  if (!key) throw new TripoError('TRIPO_API_KEY is not configured', 'NO_API_KEY');

  // Build multipart/form-data manually (Node 18+ has FormData global)
  const formData = new FormData();
  // Create a fresh ArrayBuffer copy (avoids SharedArrayBuffer type issues)
  const arrayBuffer = imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer]);
  formData.append('file', blob, filename);

  const res = await fetch(`${apiBase()}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
    },
    body: formData,
    signal: AbortSignal.timeout(60000),
  });

  const json = await res.json() as {
    code: number;
    data?: { file_token: string };
    message?: string;
  };

  if (json.code !== 0 || !json.data?.file_token) {
    throw new TripoError(
      `Image upload failed: ${json.message || `HTTP ${res.status}`}`,
      'API_ERROR',
      res.status,
      json
    );
  }

  return json.data.file_token;
}

export interface CreateImageToModelParams {
  /** file_token from uploadImageFile(), OR a public image URL, OR a task_id from a previous image generation */
  input: string;
  /** AI model version. Default: 'v2.5-20250123' (balanced, cheapest). */
  model?: 'v3.1-20260211' | 'v3.0-20250812' | 'v2.5-20250123';
  /** Max polygon count. Default: 10000 (good for 3D printing). */
  faceLimit?: number;
  /** Generate texture maps. Default: true for image-to-3D (the image provides texture info). */
  texture?: boolean;
  /** Enable PBR material maps. Default: false. */
  pbr?: boolean;
  /** Scale to real-world dimensions. Default: false. */
  autoSize?: boolean;
}

/** Submit an image-to-3D generation task. Returns the task_id immediately. */
export async function createImageToModelTask(params: CreateImageToModelParams): Promise<TripoTaskCreated> {
  // Pre-flight: check balance to give a clear error before consuming credits
  let balance: TripoBalance;
  try {
    balance = await getBalance();
  } catch {
    balance = { balance: -1, frozen: -1 };
  }
  if (balance.balance === 0) {
    throw new TripoError(
      'Your Tripo account has 0 credits. Please recharge at https://platform.tripo3d.ai before generating models.',
      'INSUFFICIENT_CREDIT'
    );
  }

  const body: Record<string, unknown> = {
    input: params.input,
    model: params.model || 'v2.5-20250123',
    texture: params.texture ?? true,
    pbr: params.pbr ?? false,
    face_limit: params.faceLimit ?? 10000,
    auto_size: params.autoSize ?? false,
  };

  const res = await fetch(`${apiBase()}/generation/image-to-model`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  const json = await res.json() as {
    code: number;
    data?: { task_id: string };
    message?: string;
    suggestion?: string;
  };

  if (json.code !== 0 || !json.data?.task_id) {
    if (json.code === 2010 || (json.message && json.message.toLowerCase().includes('credit'))) {
      throw new TripoError(
        `Insufficient Tripo credits: ${json.message}. ${json.suggestion || ''}`.trim(),
        'INSUFFICIENT_CREDIT',
        res.status,
        json
      );
    }
    throw new TripoError(
      `Tripo image-to-model task creation failed: ${json.message || `HTTP ${res.status}`}`,
      'API_ERROR',
      res.status,
      json
    );
  }

  return {
    taskId: json.data.task_id,
    raw: json,
  };
}

/**
 * Full text-to-3D pipeline: submit task → poll → download GLB.
 * Use this in API routes when you want to block until the model is ready.
 * For non-blocking, use createTextToModelTask + pollTaskUntilComplete separately.
 */
export async function generateModelFromText(params: CreateTextToModelParams & {
  outputFilename: string;
  onProgress?: (status: TripoTaskStatus) => void;
}): Promise<{
  modelUrl: string; // local URL
  modelSizeBytes: number;
  modelChecksum: string;
  renderedImageUrl?: string;
  creditsConsumed?: number;
  externalTaskId: string;
}> {
  const created = await createTextToModelTask(params);
  const finalStatus = await pollTaskUntilComplete(
    created.taskId,
    params.onProgress
  );

  if (!finalStatus.modelUrl) {
    throw new TripoError(
      'Task succeeded but no model_url in output',
      'TASK_FAILED',
      undefined,
      finalStatus.raw
    );
  }

  const downloaded = await downloadModelToLocal(finalStatus.modelUrl, params.outputFilename);

  return {
    modelUrl: downloaded.localUrl,
    modelSizeBytes: downloaded.sizeBytes,
    modelChecksum: downloaded.checksum,
    renderedImageUrl: finalStatus.renderedImageUrl,
    creditsConsumed: finalStatus.creditsConsumed,
    externalTaskId: created.taskId,
  };
}
