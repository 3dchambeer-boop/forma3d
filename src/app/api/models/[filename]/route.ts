// =====================================================================
// GET /api/models/[filename] — serve a stored model file after checking
// that the caller may see the revision it belongs to.
//
// Files live in private storage (STORAGE_DIR/models), not in /public, so
// this route is the only way to reach them. ?download=1 forces a download
// with a readable file name.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { requireAuth } from '@/lib/session';
import { statStored } from '@/lib/storage';
import { canReadModelFile } from '@/lib/access';
import { signingSecret, verifyDownload } from '@/lib/security/signed-url';
import { clientIp, rateLimited } from '@/lib/security/rate-limit';

const CONTENT_TYPES: Record<string, string> = {
  stl: 'model/stl',
  glb: 'model/gltf-binary',
  obj: 'model/obj',
};

function err(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  const sig = new URL(req.url).searchParams.get('sig');
  if (sig) {
    // signed link (issued by an authorised user for a machine without a session, e.g. the slicer worker)
    const limited = rateLimited(clientIp(req.headers), 'download');
    if (limited) return limited;
    let ok = false;
    try { ok = verifyDownload(sig, { kind: 'models', key: filename }, signingSecret()).ok; } catch { ok = false; }
    if (!ok) return err(403, 'FORBIDDEN', 'Invalid or expired link');
  } else {
    const auth = await requireAuth();
    if (auth.error) return err(401, 'UNAUTHORIZED', 'Authentication required');
    if (!(await canReadModelFile(auth.user, filename))) return err(404, 'NOT_FOUND', 'Model not found');
  }
  const file = await statStored('models', filename);
  // same answer for "missing" and "not yours": do not reveal which files exist
  if (!file) return err(404, 'NOT_FOUND', 'Model not found');

  const ext = filename.split('.').pop()!.toLowerCase();
  const download = new URL(req.url).searchParams.get('download') === '1';
  const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': String(file.size),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
