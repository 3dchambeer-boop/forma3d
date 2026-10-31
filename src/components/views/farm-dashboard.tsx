'use client';

import { useEffect, useState } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Cpu as CpuIcon, Factory, CheckCircle2, XCircle, AlertTriangle, Clock,
  Activity, ArrowRight, ChevronLeft, Printer as PrinterIcon, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { Breadcrumbs } from '../breadcrumbs';
import { LiveBadge } from '../live-badge';
import { formatRelative } from '../format';
import type { Printer as PrinterType, PrintJob as PrintJobType } from '@/lib/types';

export function FarmDashboardView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const setView = useAppStore(s => s.setView);

  const [printers, setPrinters] = useState<PrinterType[]>([]);
  const [jobs, setJobs] = useState<PrintJobType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [printersRes, jobsRes] = await Promise.all([
          api.listPrinters(),
          api.listPrintJobs(),
        ]);
        if (cancelled) return;
        setPrinters(printersRes.printers);
        setJobs(jobsRes.jobs);
      } catch (e) { if (!cancelled) console.error(e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  const total = printers.length;
  const idle = printers.filter(p => p.status === 'IDLE').length;
  const busy = printers.filter(p => p.status === 'BUSY' || p.status === 'HEATING').length;
  const offline = printers.filter(p => p.status === 'OFFLINE' || p.status === 'ERROR').length;

  const queuedJobs = jobs.filter(j => j.status === 'QUEUED_FOR_PRINTER' || j.status === 'SLICED').length;
  const activeJobs = jobs.filter(j => j.status === 'PRINTING').length;
  const completedToday = jobs.filter(j => j.status === 'COMPLETED').length;
  const failedToday = jobs.filter(j => j.status === 'FAILED').length;

  const kpis = [
    { label: t('farm.kpi.total_printers'), value: total, icon: CpuIcon, accent: 'cyan' as const },
    { label: t('farm.kpi.idle_printers'), value: idle, icon: CheckCircle2, accent: 'success' as const },
    { label: t('farm.kpi.busy_printers'), value: busy, icon: Activity, accent: 'warning' as const },
    { label: t('farm.kpi.offline_printers'), value: offline, icon: XCircle, accent: 'destructive' as const },
  ];

  const opsKpis = [
    { label: t('farm.kpi.queued_jobs'), value: queuedJobs, icon: Clock },
    { label: t('farm.kpi.active_jobs'), value: activeJobs, icon: Zap },
    { label: t('farm.kpi.completed_today'), value: completedToday, icon: CheckCircle2 },
    { label: t('farm.kpi.failed_today'), value: failedToday, icon: AlertTriangle },
  ];

  const activePrintJobs = jobs.filter(j => j.status === 'PRINTING' || j.status === 'QUEUED_FOR_PRINTER');

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
      <Breadcrumbs
        items={[
          { label: t('nav.dashboard'), onClick: () => setView('dashboard') },
          { label: t('nav.farm_dashboard') },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Factory className="h-6 w-6 text-cyan-glow" />
            {t('farm.dashboard_title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('farm.dashboard_subtitle')}</p>
        </div>
        <LiveBadge />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          const colorClass = {
            cyan: 'text-cyan-glow bg-cyan-glow/10 border-cyan-glow/20',
            success: 'text-success bg-success/10 border-success/20',
            warning: 'text-warning bg-warning/10 border-warning/20',
            destructive: 'text-destructive bg-destructive/10 border-destructive/20',
          }[kpi.accent];
          return (
            <Card key={i} className="premium-card">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={cn('inline-flex h-9 w-9 rounded-lg items-center justify-center border', colorClass)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {total > 0 ? ((kpi.value / total) * 100).toFixed(0) : 0}%
                  </span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">{kpi.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{kpi.label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="premium-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-violet-glow" />
            {isRTL ? 'مؤشرات العمليات' : 'Operations indicators'}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {opsKpis.map((kpi, i) => {
            const Icon = kpi.icon;
            return (
              <div key={i} className="p-3 rounded-md border border-border/40 bg-background/40">
                <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-1">
                  <Icon className="h-3 w-3" />
                  {kpi.label}
                </div>
                <div className="text-xl font-mono font-bold">{kpi.value}</div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="premium-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <PrinterIcon className="h-4 w-4 text-cyan-glow" />
              {t('farm.kpi.active_jobs')}
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setView('slicing_dispatch')}>
              {t('nav.slicing_dispatch')}
              {isRTL ? <ChevronLeft className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 max-h-96 overflow-y-auto scrollbar-custom">
            {activePrintJobs.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-8">{t('common.no_data')}</div>
            ) : (
              activePrintJobs.map(job => {
                const printer = printers.find(p => p.id === job.printerId);
                return (
                  <div key={job.id} className="p-3 rounded-md border border-border/40 bg-background/40 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{job.project?.name || job.projectName}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {printer?.name || job.printerName || '—'} · {job.initiatedBy?.name || job.initiatedByName}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[9px] font-mono shrink-0 gap-1">
                        <span className={cn('status-dot',
                          job.status === 'PRINTING' ? 'busy' : 'online'
                        )} />
                        {job.status.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </div>
                    {job.status === 'PRINTING' && printer && printer.progressPercent !== undefined && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{t('farm.printer.progress')}</span>
                          <span className="font-mono">{printer.progressPercent}%</span>
                        </div>
                        <Progress value={printer.progressPercent || 0} className="h-1" />
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{t('farm.slicing.estimated_time')}: {job.estimatedTimeMin}min</span>
                          <span>{job.materialGrams}g</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="premium-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CpuIcon className="h-4 w-4 text-violet-glow" />
              {t('farm.fleet_title')}
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setView('printer_fleet')}>
              {t('common.view')}
              {isRTL ? <ChevronLeft className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto scrollbar-custom">
            {printers.slice(0, 8).map(p => (
              <div key={p.id} className="flex items-center gap-2.5 p-2 rounded-md border border-border/40 bg-background/40">
                <div className={cn(
                  'h-8 w-8 rounded shrink-0 flex items-center justify-center',
                  p.status === 'IDLE' ? 'bg-success/15 text-success' :
                  p.status === 'BUSY' || p.status === 'HEATING' ? 'bg-warning/15 text-warning' :
                  p.status === 'OFFLINE' ? 'bg-muted text-muted-foreground' :
                  'bg-destructive/15 text-destructive'
                )}>
                  <CpuIcon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {p.model} · {p.currentJobName || (isRTL ? 'خامل' : 'idle')}
                  </div>
                </div>
                {p.progressPercent !== undefined && p.progressPercent > 0 && (
                  <div className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {p.progressPercent}%
                  </div>
                )}
                {p.lastSeenAt && (
                  <span className="text-[9px] text-muted-foreground shrink-0">
                    {formatRelative(p.lastSeenAt, isRTL)}
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
