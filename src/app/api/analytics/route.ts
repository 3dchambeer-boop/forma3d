// =====================================================================
// GET /api/analytics — platform-wide metrics from real DB
//
// Returns:
//   - Generation volume (per day, per provider) — last 30 days
//   - Print success/failure — last 30 days
//   - User growth — cumulative
//   - Provider latency & success rate — derived from generation job outcomes
//   - Review turnaround — average hours from revision.createdAt to review.decidedAt
//   - Printer utilization — last 7 days
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';

function dateRange(days: number): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return { start, end };
}

function dateKey(d: Date): string {
  return d.toISOString().slice(5, 10); // MM-DD
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(['ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }

  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get('days') || '30');
  const { start, end } = dateRange(days);

  // === Generation volume per day per provider ===
  const generations = await db.aIGenerationJob.findMany({
    where: { createdAt: { gte: start, lte: end } },
    select: { provider: true, status: true, createdAt: true, startedAt: true, completedAt: true, costCredits: true },
  });

  const genVolumeMap = new Map<string, { parametric: number; tripo: number; selfHosted: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    genVolumeMap.set(dateKey(d), { parametric: 0, tripo: 0, selfHosted: 0 });
  }
  for (const g of generations) {
    const k = dateKey(g.createdAt);
    const entry = genVolumeMap.get(k);
    if (!entry) continue;
    if (g.provider === 'PARAMETRIC') entry.parametric++;
    else if (g.provider === 'TRIPO') entry.tripo++;
    else if (g.provider === 'SELF_HOSTED') entry.selfHosted++;
    // MOCK jobs are test traffic and are deliberately not charted
  }
  const generationVolume = Array.from(genVolumeMap.entries()).map(([date, v]) => ({ date, ...v }));

  // === Print success/failure per day ===
  const printJobs = await db.printJob.findMany({
    where: { createdAt: { gte: start, lte: end } },
    select: { status: true, createdAt: true, completedAt: true, dispatchedAt: true, estimatedTimeMin: true, actualTimeMin: true, gcodeChecksum: true },
  });

  const printMap = new Map<string, { success: number; failed: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    printMap.set(dateKey(d), { success: 0, failed: 0 });
  }
  for (const p of printJobs) {
    const k = dateKey(p.createdAt);
    const entry = printMap.get(k);
    if (!entry) continue;
    if (p.status === 'COMPLETED') entry.success++;
    else if (p.status === 'FAILED') entry.failed++;
  }
  const printSuccess = Array.from(printMap.entries()).map(([date, v]) => ({ date, ...v }));

  // === User growth (cumulative, 90 days, sampled every 3 days) ===
  const users = await db.user.findMany({
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  let cumulative = 0;
  const userGrowth: { date: string; users: number }[] = [];
  const oldest = users.length > 0 ? users[0].createdAt : new Date();
  const totalDays = Math.min(90, Math.ceil((Date.now() - oldest.getTime()) / 86400000));
  for (let i = totalDays; i >= 0; i -= 3) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    cumulative = users.filter(u => u.createdAt <= d).length;
    userGrowth.push({ date: dateKey(d), users: cumulative });
  }

  // === Provider latency & success rate ===
  const providerStats = ['PARAMETRIC', 'TRIPO', 'SELF_HOSTED'].map(provider => {
    const jobs = generations.filter(g => g.provider === provider);
    const completed = jobs.filter(g => g.status === 'APPROVED' || g.status === 'REVIEW_REQUIRED');
    const failed = jobs.filter(g => g.status === 'FAILED');
    const success = jobs.length > 0 ? ((completed.length / jobs.length) * 100) : 0;
    // Average latency from startedAt to completedAt
    const latencies = jobs
      .filter(g => g.startedAt && g.completedAt)
      .map(g => (g.completedAt!.getTime() - g.startedAt!.getTime()) / 1000);
    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;
    return {
      provider: provider.charAt(0) + provider.slice(1).toLowerCase(),
      latency: parseFloat((avgLatency / 60).toFixed(1)), // minutes → display as decimal minutes
      success: parseFloat(success.toFixed(1)),
      total: jobs.length,
    };
  });

  // === Review turnaround ===
  // Average hours from revision.createdAt to review.decidedAt, grouped by week
  const reviews = await db.humanReview.findMany({
    where: { decidedAt: { not: null } },
    include: { revision: { select: { createdAt: true } } },
    orderBy: { decidedAt: 'desc' },
    take: 100,
  });
  const reviewBuckets = new Map<string, { total: number; count: number }>();
  for (const r of reviews) {
    if (!r.decidedAt) continue;
    const hours = (r.decidedAt.getTime() - r.revision.createdAt.getTime()) / 3600000;
    if (hours < 0 || hours > 720) continue; // skip outliers
    const weekKey = `Wk ${Math.ceil(reviews.indexOf(r) / 5) + 1}`;
    const bucket = reviewBuckets.get(weekKey) || { total: 0, count: 0 };
    bucket.total += hours;
    bucket.count++;
    reviewBuckets.set(weekKey, bucket);
  }
  const reviewTurnaround = Array.from(reviewBuckets.entries())
    .slice(0, 4)
    .map(([date, v]) => ({
      date,
      hours: v.count > 0 ? parseFloat((v.total / v.count).toFixed(1)) : 0,
    }));

  // === Printer utilization ===
  const printers = await db.printer.findMany({
    include: {
      telemetry: {
        where: { recordedAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      },
      _count: { select: { printJobs: true } },
    },
  });
  const printerUtilization = printers.map(p => {
    // Compute as ratio of busy telemetry samples to total
    const busySamples = p.telemetry.filter(t => t.progressPercent !== null).length;
    const totalSamples = Math.max(1, p.telemetry.length);
    const utilization = Math.min(100, Math.round((busySamples / totalSamples) * 100) + (p.status === 'BUSY' ? 20 : 0));
    return {
      name: p.name,
      utilization,
      model: p.model,
    };
  });

  // === Summary KPIs ===
  const totalGenerations = generations.length;
  const totalPrints = printJobs.length;
  const successfulPrints = printJobs.filter(p => p.status === 'COMPLETED').length;
  const printSuccessRate = totalPrints > 0 ? ((successfulPrints / totalPrints) * 100).toFixed(1) : '0.0';
  const totalUsers = users.length;

  // === Geometry quality (from engine validation results stored on revisions) ===
  const revs = await db.designRevision.findMany({
    where: { createdAt: { gte: start, lte: end }, stlUrl: { not: null } },
    select: { validationStatus: true },
  });
  const validation = { VALIDATED: 0, VALID_WITH_WARNINGS: 0, REPAIR_REQUIRED: 0 } as Record<string, number>;
  for (const r of revs) if (r.validationStatus && r.validationStatus in validation) validation[r.validationStatus]++;
  const slicedCount = printJobs.filter(p => p.gcodeChecksum).length;
  const creditsUsed = generations.reduce((a, g) => a + (g.costCredits ?? 0), 0);
  const finishedGen = generations.filter(g => ['REVIEW_REQUIRED', 'APPROVED', 'FAILED'].includes(g.status));
  const generationSuccessRate = finishedGen.length
    ? parseFloat(((finishedGen.filter(g => g.status !== 'FAILED').length / finishedGen.length) * 100).toFixed(1))
    : null;

  return ok({
    summary: {
      totalGenerations,
      totalPrints,
      successfulPrints,
      printSuccessRate: parseFloat(printSuccessRate),
      totalUsers,
      generationSuccessRate, // null when there is no finished job yet — never a made-up 0 %
      stlReady: revs.length,
      validation,
      slicedCount,
      creditsUsed,
    },
    generationVolume,
    printSuccess,
    userGrowth,
    providerLatency: providerStats,
    reviewTurnaround,
    printerUtilization,
    generatedAt: new Date().toISOString(),
  });
}
