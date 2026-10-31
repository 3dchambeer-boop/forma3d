'use client';

// =====================================================================
// Slicing & Dispatch (farm manager).
//
//   print request (APPROVED) → slice with OrcaSlicer → upload to OctoPrint
//   → explicit "start" confirmation → live status read from the printer.
//
// Every figure shown comes from the server or the printer. The previous
// version animated fake slicing progress and defaulted to a "dry run" that
// still marked printers busy.
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertCircle, Ban, Loader2, Pause, Play, Scissors, Send, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThreeViewer } from '../three-viewer';
import { api, type PrintStatus } from '@/lib/api-client';
import { sonnerToast } from '../sonner-toast';
import { Breadcrumbs } from '../breadcrumbs';
import { formatBytes } from '../format';
import type { PrintJob, Printer, SlicingProfile } from '@/lib/types';

const ACTIVE = ['APPROVED', 'SLICING', 'SLICED', 'AWAITING_PRINT_CONFIRMATION', 'PRINTING', 'PAUSED', 'FAILED'];

export function SlicingDispatchView() {
  const t = useT();
  const isRTL = useIsRTL();
  const setView = useAppStore(s => s.setView);
  const L = (ar: string, en: string) => (isRTL ? ar : en);

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [profiles, setProfiles] = useState<SlicingProfile[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [jobId, setJobId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [printerId, setPrinterId] = useState('');
  const [busy, setBusy] = useState<null | 'slice' | 'upload' | 'start' | 'control'>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<PrintStatus | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);

  const reload = useCallback(async () => {
    const [j, p, pr] = await Promise.all([api.listPrintJobs(), api.listSlicingProfiles(), api.listPrinters()]);
    const relevant = j.jobs.filter(x => ACTIVE.includes(x.status));
    setJobs(relevant);
    setProfiles(p.profiles);
    setPrinters(pr.printers);
    return relevant;
  }, []);

  useEffect(() => {
    let cancelled = false;
    reload()
      .then(rel => {
        if (cancelled) return;
        setJobId(id => id || rel[0]?.id || '');
      })
      .catch(e => !cancelled && setError(e instanceof Error ? e.message : 'load failed'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [reload]);

  const job = jobs.find(j => j.id === jobId);
  const profile = profiles.find(p => p.id === profileId) ?? profiles[0];
  // the API returns materials as the stored comma list; accept either shape
  const materialsOf = (p: Printer) => (Array.isArray(p.materials) ? p.materials : String(p.materials).split(',')).map(m => m.trim());
  const compatible = printers.filter(p => !profile || (materialsOf(p).includes(profile.material) && Math.abs(p.nozzleDiameter - profile.nozzleDiameter) < 0.01));

  useEffect(() => { if (!profileId && profiles[0]) setProfileId(profiles[0].id); }, [profiles, profileId]);
  useEffect(() => { if (job?.printerId) setPrinterId(job.printerId); }, [job?.printerId]);

  // live printer status while printing (read from OctoPrint by the server)
  useEffect(() => {
    if (!job || !['PRINTING', 'PAUSED'].includes(job.status)) { setLive(null); return; }
    let stop = false;
    async function tick() {
      try {
        const s = await api.printStatus(job!.id);
        if (stop) return;
        setLive(s);
        if (s.status !== job!.status) await reload();
      } catch { /* shown via live.printerState on next tick */ }
      if (!stop) setTimeout(tick, 5000);
    }
    tick();
    return () => { stop = true; };
  }, [job?.id, job?.status, reload]);

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      sonnerToast.success(okMsg);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
      await reload().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" /></div>;
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
      <Breadcrumbs items={[{ label: t('nav.farm_dashboard'), onClick: () => setView('farm_dashboard') }, { label: t('nav.slicing_dispatch') }]} />
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('farm.dispatch_title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {L('التقطيع يتم بـ OrcaSlicer، ثم يُرفع الملف إلى OctoPrint، ولا تبدأ الطباعة إلا بتأكيد صريح منك.',
             'Slices with OrcaSlicer, uploads to OctoPrint, and never starts a print without your explicit confirmation.')}
        </p>
      </div>

      {jobs.length === 0 ? (
        <Card className="premium-card"><CardContent className="py-16 text-center text-sm text-muted-foreground">
          {L('لا توجد طلبات طباعة معتمدة حاليًا.', 'No approved print requests right now.')}
        </CardContent></Card>
      ) : (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          <Card className="premium-card">
            <CardHeader className="pb-3"><CardTitle className="text-sm">{L('طلبات الطباعة', 'Print requests')}</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 max-h-[560px] overflow-y-auto scrollbar-custom">
              {jobs.map(j => (
                <button key={j.id} onClick={() => { setJobId(j.id); setError(null); }}
                  className={cn('w-full text-start p-2 rounded-md border transition text-xs',
                    j.id === jobId ? 'border-cyan-glow/40 bg-cyan-glow/10' : 'border-border/40 hover:bg-accent')}>
                  <div className="font-medium truncate">{j.project?.name ?? j.projectName} · v{j.revision?.version ?? j.revisionVersion}</div>
                  <div className="flex items-center justify-between mt-1">
                    <Badge variant="outline" className="text-[9px] font-mono">{j.status}</Badge>
                    <span className="text-muted-foreground">{j.printer?.name ?? j.printerName ?? ''}</span>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {job && (
            <div className="space-y-4">
              <Card className="premium-card overflow-hidden">
                <CardContent className="p-0">
                  {job.revision ? (
                    <JobModel revisionId={job.revision.id} projectId={job.projectId} />
                  ) : null}
                </CardContent>
              </Card>

              <Card className="premium-card">
                <CardContent className="pt-6 space-y-4 text-xs">
                  {/* 1. slice */}
                  <div className="grid sm:grid-cols-3 gap-3 items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs">{L('ملف الإعدادات', 'Slicing profile')}</Label>
                      <Select value={profileId} onValueChange={setProfileId} disabled={!!busy}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>{profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">{L('الطابعة', 'Printer')}</Label>
                      <Select value={printerId} onValueChange={setPrinterId} disabled={!!busy}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {compatible.map(p => <SelectItem key={p.id} value={p.id}>{p.name} · {p.status}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button variant="outline" className="gap-2 h-9" disabled={!!busy || !profile || !['APPROVED', 'FAILED', 'SLICED'].includes(job.status)}
                      onClick={() => run('slice', () => api.sliceJob(job.id, profile!.id, printerId || undefined), L('اكتمل التقطيع', 'Slicing complete'))}>
                      {busy === 'slice' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                      {L('قطّع', 'Slice')}
                    </Button>
                  </div>
                  {busy === 'slice' && <div className="text-muted-foreground">{L('OrcaSlicer يعمل… (لا يوجد مؤشر تقدم من المقطّع)', 'OrcaSlicer running… (the slicer reports no progress)')}</div>}

                  {job.gcodeUrl && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Fact label="G-code" value={job.gcodeSizeBytes ? formatBytes(job.gcodeSizeBytes, isRTL) : '—'} />
                      <Fact label={L('الزمن المقدّر', 'Est. time')} value={job.estimatedTimeMin ? `${job.estimatedTimeMin} min` : '—'} />
                      <Fact label={L('المادة', 'Material')} value={job.materialGrams ? `${job.materialGrams} g` : '—'} />
                      <Fact label="SHA-256" value={job.gcodeChecksum ? job.gcodeChecksum.slice(7, 19) + '…' : '—'} mono />
                    </div>
                  )}

                  {/* 2. upload */}
                  <div className="flex flex-wrap gap-2">
                    <Button className="gap-2" disabled={!!busy || job.status !== 'SLICED' || !printerId}
                      onClick={() => run('upload', () => api.uploadToPrinter(job.id, printerId), L('رُفع الملف إلى الطابعة — بانتظار تأكيد البدء', 'Uploaded to the printer — waiting for start confirmation'))}>
                      {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      {L('ارفع إلى OctoPrint', 'Upload to OctoPrint')}
                    </Button>
                    {/* 3. start (explicit confirmation) */}
                    <Button variant="destructive" className="gap-2" disabled={!!busy || job.status !== 'AWAITING_PRINT_CONFIRMATION'} onClick={() => setConfirmStart(true)}>
                      <Play className="h-4 w-4" />{L('ابدأ الطباعة الفعلية', 'Start physical print')}
                    </Button>
                    {['PRINTING', 'PAUSED'].includes(job.status) && (
                      <>
                        <Button variant="outline" className="gap-2" disabled={!!busy}
                          onClick={() => run('control', () => api.controlPrint(job.id, job.status === 'PAUSED' ? 'resume' : 'pause'), L('أُرسل الأمر', 'Command sent'))}>
                          {job.status === 'PAUSED' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                          {job.status === 'PAUSED' ? L('استئناف', 'Resume') : L('إيقاف مؤقت', 'Pause')}
                        </Button>
                        <Button variant="outline" className="gap-2 text-destructive" disabled={!!busy}
                          onClick={() => run('control', () => api.controlPrint(job.id, 'cancel'), L('أُرسل الإلغاء', 'Cancel sent'))}>
                          <Ban className="h-4 w-4" />{L('إلغاء الطباعة', 'Cancel print')}
                        </Button>
                      </>
                    )}
                  </div>

                  {live && (
                    <div className="rounded-md border border-border/40 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">{L('حالة الطابعة', 'Printer state')} ({live.source === 'octoprint' ? 'OctoPrint' : L('آخر قيمة محفوظة', 'last known')})</span>
                        <span className="font-mono">{live.printerState}</span>
                      </div>
                      {live.progress != null && (
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-cyan-glow" style={{ width: `${live.progress}%` }} /></div>
                      )}
                      {live.note && <div className="text-muted-foreground" dir="ltr">{live.note}</div>}
                    </div>
                  )}

                  {(error || job.errorMessage) && (
                    <div className="text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" /><span className="break-words" dir="ltr">{error ?? job.errorMessage}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirmStart} onOpenChange={setConfirmStart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-destructive" />{L('تأكيد بدء الطباعة', 'Confirm print start')}</AlertDialogTitle>
            <AlertDialogDescription>
              {L('ستبدأ الطابعة بالتسخين والحركة فعليًا. تأكد أن السرير نظيف وأن الخيط محمّل.',
                 'The printer will heat up and move. Make sure the bed is clear and filament is loaded.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => job && run('start', () => api.startPrint(job.id), L('بدأت الطباعة', 'Print started'))}>
              {L('ابدأ', 'Start')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border/40 p-2">
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className={cn('font-medium', mono && 'font-mono text-[11px]')}>{value}</div>
    </div>
  );
}

/** Shows the revision's stored STL (never a placeholder shape). */
function JobModel({ projectId, revisionId }: { projectId: string; revisionId: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    api.getProject(projectId)
      .then(({ project }) => {
        if (cancelled) return;
        const r = project.revisions.find(x => x.id === revisionId);
        setUrl(r?.stlUrl ?? (r?.format === 'STL' ? r.modelUrl ?? null : null));
      })
      .catch(() => !cancelled && setUrl(null));
    return () => { cancelled = true; };
  }, [projectId, revisionId]);
  if (url === undefined) return <Skeleton className="h-[300px] w-full" />;
  if (!url) return <div className="h-[120px] flex items-center justify-center text-xs text-muted-foreground">No STL stored for this revision</div>;
  return <ThreeViewer modelUrl={url} modelFormat="STL" className="h-[300px] w-full" />;
}
