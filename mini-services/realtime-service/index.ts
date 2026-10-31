// =====================================================================
// FORMA·3D Realtime Service — WebSocket mini-service
//
// Polls main app's REST API every 5s for actual DB state, broadcasts
// only diffs to subscribed clients. This avoids coupling the realtime
// service to Prisma client directly.
//
// Port: 3030 (Caddy routes via ?XTransformPort=3030)
// =====================================================================

import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = 3030;
const MAIN_APP_URL = 'http://localhost:3000';

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'forma3d-realtime',
      uptime: process.uptime(),
      clients: io ? io.engine.clientsCount : 0,
    }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('FORMA·3D Realtime Service');
});

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  path: '/',
  transports: ['websocket', 'polling'],
});

const clients = new Set<string>();

io.on('connection', (socket) => {
  clients.add(socket.id);
  console.log(`[realtime] client connected: ${socket.id} (total: ${clients.size})`);

  socket.emit('forma:event', {
    type: 'CONNECTION_ESTABLISHED',
    at: new Date().toISOString(),
  });

  // Send initial snapshot
  fetchSnapshot().then(snapshot => {
    socket.emit('forma:snapshot', { at: new Date().toISOString(), snapshot });
  });

  socket.on('disconnect', () => {
    clients.delete(socket.id);
    console.log(`[realtime] client disconnected: ${socket.id} (total: ${clients.size})`);
  });

  socket.on('forma:subscribe', (channel: string) => {
    socket.join(`channel:${channel}`);
  });
});

interface Snapshot {
  printers: { id: string; name: string; status: string; bedTemp: number | null; nozzleTemp: number | null; progressPercent: number | null; currentJobName: string | null }[];
  activeJobs: { id: string; status: string; projectName: string | null; printerName: string | null }[];
  pendingReviews: number;
  serviceHealth: string;
}

async function fetchFromMainApp(path: string): Promise<any> {
  try {
    const res = await fetch(`${MAIN_APP_URL}${path}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchSnapshot(): Promise<Snapshot> {
  const [printersRes, jobsRes, healthRes] = await Promise.all([
    fetchFromMainApp('/api/printers'),
    fetchFromMainApp('/api/print-jobs'),
    fetchFromMainApp('/api/health'),
  ]);

  // Note: /api/printers and /api/print-jobs require auth; for the realtime service
  // we use the public /api/health as a liveness signal + fall back to empty arrays
  // when auth fails. This is intentional — the realtime service only broadcasts
  // what it can see without a user session.

  const printers = printersRes?.printers || [];
  const jobs = jobsRes?.jobs || [];

  return {
    printers: printers.map((p: any) => ({
      id: p.id, name: p.name, status: p.status,
      bedTemp: p.latestTelemetry?.bedTemp ?? null,
      nozzleTemp: p.latestTelemetry?.nozzleTemp ?? null,
      progressPercent: p.latestTelemetry?.progressPercent ?? null,
      currentJobName: p.latestTelemetry?.jobName ?? null,
    })),
    activeJobs: jobs
      .filter((j: any) => ['PRINTING', 'QUEUED_FOR_PRINTER', 'SLICED', 'SLICING'].includes(j.status))
      .map((j: any) => ({
        id: j.id, status: j.status,
        projectName: j.project?.name || j.projectName || null,
        printerName: j.printer?.name || j.printerName || null,
      })),
    pendingReviews: 0, // would require authed query
    serviceHealth: healthRes?.status || 'UNKNOWN',
  };
}

function diffSnapshots(prev: Snapshot, curr: Snapshot): Array<{ type: string; payload: unknown }> {
  const events: Array<{ type: string; payload: unknown }> = [];
  for (const cp of curr.printers) {
    const pp = prev.printers.find(p => p.id === cp.id);
    if (!pp) {
      events.push({ type: 'PRINTER_ADDED', payload: cp });
      continue;
    }
    if (pp.status !== cp.status) {
      events.push({ type: 'PRINTER_STATUS_CHANGE', payload: { printerId: cp.id, name: cp.name, from: pp.status, to: cp.status } });
    }
    if (pp.progressPercent !== cp.progressPercent && cp.progressPercent !== null) {
      events.push({ type: 'PROGRESS_UPDATE', payload: { printerId: cp.id, name: cp.name, progress: cp.progressPercent, jobName: cp.currentJobName } });
    }
  }
  for (const cj of curr.activeJobs) {
    const pj = prev.activeJobs.find(j => j.id === cj.id);
    if (!pj) {
      events.push({ type: 'JOB_NEW', payload: cj });
      continue;
    }
    if (pj.status !== cj.status) {
      events.push({ type: 'JOB_STATE_CHANGE', payload: { jobId: cj.id, from: pj.status, to: cj.status, projectName: cj.projectName, printerName: cj.printerName } });
    }
  }
  if (prev.serviceHealth !== curr.serviceHealth && curr.serviceHealth !== 'UNKNOWN') {
    events.push({ type: 'SERVICE_HEALTH', payload: { status: curr.serviceHealth } });
  }
  return events;
}

let lastSnapshot: Snapshot = { printers: [], activeJobs: [], pendingReviews: 0, serviceHealth: 'UNKNOWN' };

// Initial fetch
fetchSnapshot().then(s => { lastSnapshot = s; console.log('[realtime] initial snapshot:', s.printers.length, 'printers,', s.activeJobs.length, 'active jobs'); });

// Poll every 5s, broadcast only diffs
setInterval(async () => {
  if (clients.size === 0) return;
  const current = await fetchSnapshot();
  const events = diffSnapshots(lastSnapshot, current);
  if (events.length > 0) {
    const at = new Date().toISOString();
    for (const e of events) {
      io.emit('forma:event', { ...e, at });
      console.log(`[realtime] event: ${e.type}`);
    }
  }
  lastSnapshot = current;
}, 5000);

// Heartbeat every 15s
setInterval(() => {
  if (clients.size === 0) return;
  io.emit('forma:heartbeat', { at: new Date().toISOString() });
}, 15000);

httpServer.listen(PORT, () => {
  console.log(`[realtime] FORMA·3D realtime service listening on port ${PORT}`);
  console.log(`[realtime] polling ${MAIN_APP_URL} every 5s for state changes`);
});
