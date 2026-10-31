// =====================================================================
// Print orchestration on top of OctoPrint.
//
//   SLICED ──dispatch──▶ AWAITING_PRINT_CONFIRMATION ──start(confirm)──▶ PRINTING
//                         (G-code uploaded + verified,      │
//                          nothing moves on the machine)    ├─▶ COMPLETED  (only when OctoPrint reports our file at 100 %)
//                                                           ├─▶ FAILED     (printer error / offline)
//                                                           └─▶ CANCELLED  (operator cancel)
//
// Every command and every observed state change is written to PrinterEvent
// and the audit log. Nothing here marks a print successful on its own.
// =====================================================================

import { db } from '../db';
import { logAuditSafe } from '../session';
import { keyFromUrl, readStored, sha256 } from '../storage';
import { checkGcode, interpretJob, notReadyReasons, OctoPrintClient, OctoPrintError } from './octoprint.ts';

export class PrintFlowError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

type Actor = { id: string; role: string };

async function event(printerId: string, printJobId: string | null, actorId: string | null, type: string, message: string, data?: unknown) {
  await db.printerEvent.create({ data: { printerId, printJobId, actorId, type, message: message.slice(0, 1000), data: data ? JSON.stringify(data) : null } });
}

function octoFail(e: unknown): PrintFlowError {
  if (e instanceof OctoPrintError) {
    const status = e.code === 'CONFLICT' ? 409 : e.code === 'NOT_CONFIGURED' ? 503 : e.code === 'AUTH' ? 502 : 502;
    return new PrintFlowError(status, `OCTOPRINT_${e.code}`, e.message);
  }
  return new PrintFlowError(500, 'INTERNAL', (e as Error).message);
}

async function loadJob(jobId: string) {
  const job = await db.printJob.findUnique({ where: { id: jobId }, include: { revision: true, slicingProfile: true, printer: true } });
  if (!job) throw new PrintFlowError(404, 'NOT_FOUND', 'Print job not found');
  return job;
}

/** Upload verified G-code to the printer's OctoPrint and stop there. */
export async function dispatch(jobId: string, printerId: string, actor: Actor, ip?: string) {
  const job = await loadJob(jobId);
  if (job.status !== 'SLICED') throw new PrintFlowError(409, 'CONFLICT', `Job is ${job.status}; it must be SLICED`);
  if (job.revision.status !== 'APPROVED') throw new PrintFlowError(403, 'FORBIDDEN', 'Revision is no longer approved');
  const printer = await db.printer.findUnique({ where: { id: printerId } });
  if (!printer) throw new PrintFlowError(404, 'NOT_FOUND', 'Printer not found');
  if (job.slicingProfile) {
    if (!printer.materials.split(',').map((m) => m.trim()).includes(job.slicingProfile.material)) {
      throw new PrintFlowError(409, 'INCOMPATIBLE', `Printer does not support ${job.slicingProfile.material}`);
    }
    if (Math.abs(printer.nozzleDiameter - job.slicingProfile.nozzleDiameter) > 0.01) {
      throw new PrintFlowError(409, 'INCOMPATIBLE', 'G-code was sliced for a different nozzle diameter');
    }
  }

  // the bytes we send must be exactly the bytes we sliced
  const key = keyFromUrl(job.gcodeUrl);
  const gcode = key ? await readStored('gcode', key) : null;
  if (!gcode) throw new PrintFlowError(409, 'NO_GCODE', 'G-code file missing from storage');
  if (job.gcodeChecksum !== `sha256:${sha256(gcode)}`) throw new PrintFlowError(409, 'CHECKSUM_MISMATCH', 'Stored G-code does not match the sliced checksum');
  const problems = checkGcode(gcode);
  if (problems.length) throw new PrintFlowError(422, 'INVALID_GCODE', problems.join('; '));

  let client: OctoPrintClient;
  try {
    client = OctoPrintClient.forPrinter(printer);
    const state = await client.printer();
    const reasons = notReadyReasons(state);
    await db.printer.update({ where: { id: printer.id }, data: { lastSeenAt: new Date(), status: reasons.length ? (state.connected ? 'BUSY' : 'OFFLINE') : 'IDLE' } });
    if (reasons.length) throw new PrintFlowError(409, 'PRINTER_NOT_READY', reasons.join('; '));
    const { path } = await client.upload(gcode, `forma3d-${jobId}.gcode`.replace(/[^A-Za-z0-9._-]/g, '_'));
    await client.select(path);
    await db.printJob.update({
      where: { id: jobId },
      data: { status: 'AWAITING_PRINT_CONFIRMATION', printerId: printer.id, printerName: printer.name, octoprintPath: path, dispatchedAt: new Date(), errorMessage: null },
    });
    await event(printer.id, jobId, actor.id, 'UPLOAD', `G-code uploaded and selected as ${path}`, { bytes: gcode.length, checksum: job.gcodeChecksum });
  } catch (e) {
    if (e instanceof PrintFlowError) throw e;
    await event(printer.id, jobId, actor.id, 'ERROR', `upload failed: ${(e as Error).message}`).catch(() => undefined);
    throw octoFail(e);
  }
  await logAuditSafe({ actorId: actor.id, action: 'PRINT_UPLOAD', resourceType: 'PrintJob', resourceId: jobId, metadata: { printerId }, ipAddress: ip });
  return { jobId, status: 'AWAITING_PRINT_CONFIRMATION' as const, printer: printer.name };
}

/** Physically start the print. Requires an explicit confirmation from a farm manager/admin. */
export async function startPrint(jobId: string, actor: Actor, ip?: string) {
  const job = await loadJob(jobId);
  if (job.status !== 'AWAITING_PRINT_CONFIRMATION' || !job.printer || !job.octoprintPath) {
    throw new PrintFlowError(409, 'CONFLICT', `Job is ${job.status}; upload the G-code first`);
  }
  if (job.revision.status !== 'APPROVED') throw new PrintFlowError(403, 'FORBIDDEN', 'Revision is no longer approved');
  try {
    const client = OctoPrintClient.forPrinter(job.printer);
    const reasons = notReadyReasons(await client.printer());
    if (reasons.length) throw new PrintFlowError(409, 'PRINTER_NOT_READY', reasons.join('; '));
    const current = await client.job();
    if (current.filePath !== job.octoprintPath && current.fileName !== job.octoprintPath) await client.select(job.octoprintPath);
    // claim the transition before touching the machine, so a double click cannot start twice
    const won = await db.printJob.updateMany({ where: { id: jobId, status: 'AWAITING_PRINT_CONFIRMATION' }, data: { status: 'PRINTING', printConfirmedById: actor.id, cancelRequested: false } });
    if (won.count !== 1) throw new PrintFlowError(409, 'CONFLICT', 'Job was started or changed by someone else');
    try {
      await client.start();
    } catch (e) {
      await db.printJob.update({ where: { id: jobId }, data: { status: 'AWAITING_PRINT_CONFIRMATION' } });
      throw e;
    }
    await db.printer.update({ where: { id: job.printer.id }, data: { status: 'BUSY', lastSeenAt: new Date() } });
    await event(job.printer.id, jobId, actor.id, 'START', `print started by ${actor.id}`);
  } catch (e) {
    if (e instanceof PrintFlowError) throw e;
    throw octoFail(e);
  }
  await logAuditSafe({ actorId: actor.id, action: 'PRINT_START', resourceType: 'PrintJob', resourceId: jobId, metadata: { printerId: job.printer.id }, ipAddress: ip });
  return { jobId, status: 'PRINTING' as const };
}

export async function control(jobId: string, action: 'cancel' | 'pause' | 'resume', actor: Actor, ip?: string) {
  const job = await loadJob(jobId);
  if (!job.printer || !['PRINTING', 'PAUSED'].includes(job.status)) throw new PrintFlowError(409, 'CONFLICT', `Job is ${job.status}`);
  try {
    const client = OctoPrintClient.forPrinter(job.printer);
    if (action === 'cancel') {
      await db.printJob.update({ where: { id: jobId }, data: { cancelRequested: true } });
      await client.cancel();
    } else if (action === 'pause') await client.pause();
    else await client.resume();
  } catch (e) {
    throw octoFail(e);
  }
  await event(job.printer.id, jobId, actor.id, action.toUpperCase(), `${action} sent by ${actor.id}`);
  await logAuditSafe({ actorId: actor.id, action: `PRINT_${action.toUpperCase()}`, resourceType: 'PrintJob', resourceId: jobId, ipAddress: ip });
  return syncStatus(jobId);
}

/** Read the printer and update the job. The printer is the only source of truth for progress and completion. */
export async function syncStatus(jobId: string) {
  const job = await loadJob(jobId);
  if (!job.printer || !job.octoprintPath || !['PRINTING', 'PAUSED'].includes(job.status)) {
    return { jobId, status: job.status, progress: job.progressPercent, printerState: job.lastPrinterState, source: 'database' as const };
  }
  let client: OctoPrintClient;
  try {
    client = OctoPrintClient.forPrinter(job.printer);
    const [jobState, printerState] = await Promise.all([client.job(), client.printer()]);
    const r = interpretJob(jobState, job.octoprintPath, job.cancelRequested);
    const next =
      r.status === 'PRINTING' ? 'PRINTING' :
      r.status === 'PAUSED' ? 'PAUSED' :
      r.status === 'COMPLETED' ? 'COMPLETED' :
      r.status === 'FAILED' ? 'FAILED' :
      r.status === 'CANCELLED' ? 'CANCELLED' : job.status; // UNKNOWN: keep status, surface the note
    const finished = next === 'COMPLETED' || next === 'FAILED' || next === 'CANCELLED';
    await db.printJob.update({
      where: { id: jobId },
      data: {
        status: next,
        progressPercent: r.progress,
        lastPrinterState: `${jobState.state}: ${r.note}`.slice(0, 300),
        ...(finished ? { completedAt: new Date(), actualTimeMin: jobState.printTime ? Math.round(jobState.printTime / 60) : null } : {}),
        ...(next === 'FAILED' ? { errorMessage: r.note } : {}),
      },
    });
    await db.printer.update({
      where: { id: job.printer.id },
      data: { lastSeenAt: new Date(), status: finished ? (next === 'FAILED' ? 'ERROR' : 'IDLE') : next === 'PAUSED' ? 'PAUSED' : 'BUSY' },
    });
    await db.printerTelemetry.create({
      data: {
        printerId: job.printer.id,
        bedTemp: printerState.temperatures.bed?.actual ?? null,
        nozzleTemp: printerState.temperatures.tool0?.actual ?? null,
        progressPercent: r.progress === null ? null : Math.round(r.progress),
        jobName: job.octoprintPath,
      },
    });
    if (next !== job.status) await event(job.printer.id, jobId, null, 'STATE', `${job.status} → ${next} (${r.note})`);
    return { jobId, status: next, progress: r.progress, printerState: jobState.state, note: r.note, source: 'octoprint' as const };
  } catch (e) {
    const fail = octoFail(e);
    await db.printJob.update({ where: { id: jobId }, data: { lastPrinterState: `unreachable: ${fail.message}`.slice(0, 300) } });
    // a lost connection is not a failed print: the status stays as it was
    return { jobId, status: job.status, progress: job.progressPercent, printerState: 'UNREACHABLE', note: fail.message, source: 'database' as const };
  }
}
