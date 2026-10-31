// =====================================================================
// Private file storage for models and G-code.
//
// Files live under STORAGE_DIR (default ./storage), which is NOT inside
// /public, so Next.js never serves them statically. Every read goes through
// an API route that checks the caller's access to the owning project.
//
// Keys are generated here (random id + fixed extension); callers never
// choose a path, so user input cannot escape the storage root.
// =====================================================================

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export type StorageKind = 'models' | 'gcode';

const ALLOWED_EXT: Record<StorageKind, readonly string[]> = {
  models: ['stl', 'glb', 'obj'],
  gcode: ['gcode'],
};

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;

export function storageRoot(): string {
  return resolve(process.env.STORAGE_DIR || join(process.cwd(), 'storage'));
}

export interface StoredFile {
  key: string; // file name inside the kind's folder
  url: string; // API URL that serves it after an access check
  sizeBytes: number;
  sha256: string;
}

export function urlFor(kind: StorageKind, key: string): string {
  return kind === 'models' ? `/api/models/${encodeURIComponent(key)}` : `/api/gcode/${encodeURIComponent(key)}`;
}

/** Resolve a stored key to an absolute path, or null if the key is not a safe storage key. */
export function pathFor(kind: StorageKind, key: string): string | null {
  if (!KEY_RE.test(key) || key.includes('..')) return null;
  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXT[kind].includes(ext)) return null;
  const dir = join(storageRoot(), kind);
  const full = resolve(dir, key);
  if (!full.startsWith(dir + sep)) return null;
  return full;
}

/**
 * Extract the storage key from a URL stored in the database.
 * Accepts the current form (/api/models/<key>) and the legacy public form (/models/<key>)
 * used by revisions created before storage was made private.
 */
export function keyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^\/(?:api\/)?(?:models|gcode)\/([^/?#]+)$/);
  if (!m) return null;
  const key = decodeURIComponent(m[1]);
  return KEY_RE.test(key) ? key : null;
}

export async function saveFile(kind: StorageKind, data: Buffer, ext: string, prefix = ''): Promise<StoredFile> {
  const cleanExt = ext.replace(/^\./, '').toLowerCase();
  if (!ALLOWED_EXT[kind].includes(cleanExt)) throw new Error(`extension .${cleanExt} not allowed for ${kind}`);
  if (data.length === 0) throw new Error('refusing to store an empty file');
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const key = `${safePrefix ? safePrefix + '-' : ''}${randomBytes(8).toString('hex')}.${cleanExt}`;
  const full = pathFor(kind, key);
  if (!full) throw new Error('generated key failed validation');
  await mkdir(join(storageRoot(), kind), { recursive: true, mode: 0o700 });
  const tmp = `${full}.${process.pid}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, full); // atomic: readers never see a half-written file
  return { key, url: urlFor(kind, key), sizeBytes: data.length, sha256: sha256(data) };
}

export async function readStored(kind: StorageKind, key: string): Promise<Buffer | null> {
  const full = pathFor(kind, key);
  if (!full) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

export async function statStored(kind: StorageKind, key: string): Promise<{ path: string; size: number } | null> {
  const full = pathFor(kind, key);
  if (!full) return null;
  try {
    const s = await stat(full);
    return s.isFile() ? { path: full, size: s.size } : null;
  } catch {
    return null;
  }
}

export async function deleteStored(kind: StorageKind, key: string): Promise<void> {
  const full = pathFor(kind, key);
  if (full) await unlink(full).catch(() => undefined);
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
