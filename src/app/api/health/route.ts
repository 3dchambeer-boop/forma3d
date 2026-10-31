// =====================================================================
// GET /api/health
//   anonymous: liveness only ({status, timestamp}) — no internals disclosed
//   ADMIN:     every dependency actually probed; nothing is reported
//              HEALTHY without a real check
// =====================================================================

import { db } from '@/lib/db';
import { ok } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';
import { EngineClient } from '@/lib/generation/engine-client.ts';
import { CadClient } from '@/lib/cad/cad-client.ts';
import { providerStatus } from '@/lib/generation/registry.ts';
import { isOrcaSlicerConfigured } from '@/lib/orcaslicer';
import { storageRoot } from '@/lib/storage';
import { access, constants } from 'node:fs/promises';

type Check = { id: string; name: string; status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'NOT_CONFIGURED'; latencyMs?: number; message?: string };

async function timed(fn: () => Promise<string | void>): Promise<{ ms: number; msg?: string; err?: string }> {
  const t0 = Date.now();
  try {
    const msg = await fn();
    return { ms: Date.now() - t0, msg: msg || undefined };
  } catch (e) {
    return { ms: Date.now() - t0, err: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  const dbProbe = await timed(async () => { await db.$queryRaw`SELECT 1`; });
  const user = await getCurrentUser().catch(() => null);
  if (!user || user.role !== 'ADMIN') {
    return ok({ status: dbProbe.err ? 'DEGRADED' : 'HEALTHY', timestamp: new Date().toISOString() });
  }

  const checks: Check[] = [
    { id: 'svc-db', name: 'Database', status: dbProbe.err ? 'OFFLINE' : 'HEALTHY', latencyMs: dbProbe.ms, message: dbProbe.err },
  ];

  const engine = EngineClient.fromEnv();
  if (!engine) {
    checks.push({ id: 'svc-engine', name: 'Geometry engine (ai_3d_engine)', status: 'NOT_CONFIGURED', message: 'ENGINE_URL / ENGINE_SERVICE_TOKEN not set' });
  } else {
    const r = await timed(async () => {
      const c = await engine.capabilities();
      return `v${c.version} · spec extractor: ${c.spec_extractor} · ${(c.templates as unknown[]).length} templates`;
    });
    checks.push({ id: 'svc-engine', name: 'Geometry engine (ai_3d_engine)', status: r.err ? 'OFFLINE' : 'HEALTHY', latencyMs: r.ms, message: r.err ?? r.msg });
  }

  const cad = CadClient.fromEnv();
  if (!cad) {
    checks.push({ id: 'svc-cad', name: 'OpenCascade CAD service', status: 'NOT_CONFIGURED', message: 'CAD_ENGINE_URL not set (STEP export unavailable)' });
  } else {
    const r = await timed(async () => { const h = await cad.health(); if (!h.ok || !h.kernel) throw new Error('no B-Rep kernel available'); return h.kernel; });
    checks.push({ id: 'svc-cad', name: 'OpenCascade CAD service', status: r.err ? 'OFFLINE' : 'HEALTHY', latencyMs: r.ms, message: r.err ?? r.msg });
  }

  // providers: configuration only — no paid API call per health check
  for (const p of providerStatus()) {
    checks.push({
      id: `svc-provider-${p.id.toLowerCase()}`,
      name: `Generation provider ${p.id}${p.paid ? ' (paid)' : ''}`,
      status: p.configured ? 'HEALTHY' : 'NOT_CONFIGURED',
      message: p.configured ? 'configured (not probed)' : p.reason ?? undefined,
    });
  }

  const orca = await isOrcaSlicerConfigured();
  checks.push({ id: 'svc-orca', name: 'OrcaSlicer', status: orca.configured ? 'HEALTHY' : 'NOT_CONFIGURED', message: orca.configured ? 'binary present (slicing verified only by an actual slice)' : orca.reason });

  const printers = await db.printer.findMany({ select: { name: true, octoprintUrl: true, octoprintApiKeyRef: true, lastSeenAt: true } });
  const wired = printers.filter((p) => p.octoprintUrl && p.octoprintApiKeyRef && process.env[p.octoprintApiKeyRef]);
  checks.push({
    id: 'svc-octo', name: 'OctoPrint printers',
    status: wired.length ? 'HEALTHY' : 'NOT_CONFIGURED',
    message: `${wired.length}/${printers.length} printers have an OctoPrint URL and key; reachability is checked on dispatch/status`,
  });

  const store = await timed(async () => { await access(storageRoot(), constants.W_OK); return storageRoot(); });
  checks.push({ id: 'svc-storage', name: 'Private file storage', status: store.err ? 'OFFLINE' : 'HEALTHY', message: store.err ?? 'writable' });

  const ws = await timed(async () => {
    const r = await fetch('http://127.0.0.1:3030/health', { signal: AbortSignal.timeout(1500) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });
  checks.push({ id: 'svc-ws', name: 'Realtime service', status: ws.err ? 'OFFLINE' : 'HEALTHY', latencyMs: ws.ms, message: ws.err });

  const degraded = checks.some((c) => c.status === 'OFFLINE' || c.status === 'DEGRADED');
  return ok({ status: degraded ? 'DEGRADED' : 'HEALTHY', timestamp: new Date().toISOString(), services: checks });
}
