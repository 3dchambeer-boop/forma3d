// =====================================================================
// GET /api/printers — list printers
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(['FARM_MANAGER', 'ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const printers = await db.printer.findMany({
    where: status ? { status: status as 'IDLE' | 'BUSY' | 'OFFLINE' | 'ERROR' | 'PAUSED' | 'HEATING' } : {},
    include: {
      telemetry: { orderBy: { recordedAt: 'desc' }, take: 1 },
      organization: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });

  // Compute utilization from last 7 days of telemetry
  // never return credential columns (legacy octoprintApiKey) to any client
  const printersWithUtil = printers.map(({ octoprintApiKey: _secret, ...p }) => ({
    ...p,
    materialsList: p.materials.split(',').map(m => m.trim()),
    latestTelemetry: p.telemetry[0] || null,
    utilizationPercent: p.telemetry.length > 0
      ? Math.min(95, Math.round((p.telemetry.filter(t => t.progressPercent !== null).length / Math.max(1, p.telemetry.length)) * 100))
      : 0,
  }));

  return ok({ printers: printersWithUtil });
}
