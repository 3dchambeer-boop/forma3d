// =====================================================================
// GET /api/gcode/[filename] — G-code download for farm managers/admins.
// G-code lives in private storage (STORAGE_DIR/gcode), never in /public.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/session';
import { readStored } from '@/lib/storage';
import { canReadGcodeFile } from '@/lib/access';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const auth = await requireAuth(['FARM_MANAGER', 'ADMIN']);
  if (auth.error) {
    return NextResponse.json({ error: { code: auth.error.code, message: auth.error.message } }, { status: auth.error.status });
  }
  const { filename } = await params;
  const data = (await canReadGcodeFile(auth.user, filename)) ? await readStored('gcode', filename) : null;
  if (!data) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'G-code not found' } }, { status: 404 });
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'text/x.gcode',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
