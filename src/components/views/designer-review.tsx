'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Eye, CheckCircle2, XCircle, AlertCircle, FileBox, Layers,
  Ruler, Cpu, User as UserIcon, Clock, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThreeViewer, type ModelStats } from '../three-viewer';
import { api } from '@/lib/api-client';
import { sonnerToast } from '../sonner-toast';
import { Breadcrumbs } from '../breadcrumbs';
import { formatDateTime } from '../format';
import type { DesignProject, DesignRevision, HumanReview } from '@/lib/types';

interface ReviewItem {
  project: DesignProject & { owner: { id: string; name: string; email: string } };
  revision: DesignRevision;
  reviews: HumanReview[];
}

const geometryFallback: Record<string, 'gear' | 'frame' | 'bracket' | 'vase' | 'stand' | 'clip'> = {
  'proj-1-rev-1': 'gear', 'proj-1-rev-2': 'gear',
  'proj-2-rev-1': 'frame',
  'proj-3-rev-1': 'stand', 'proj-3-rev-2': 'stand',
  'proj-4-rev-1': 'bracket',
  'proj-5-rev-1': 'vase',
  'proj-6-rev-1': 'clip',
};

export function DesignerReviewView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const selectedRevisionId = useAppStore(s => s.selectedRevisionId);
  const setView = useAppStore(s => s.setView);

  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [comments, setComments] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | 'APPROVE' | 'REJECT' | 'CHANGES_REQUESTED'>(null);
  const [liveStats, setLiveStats] = useState<ModelStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { revisions } = await api.listReviews('all');
        if (cancelled) return;
        const items = revisions.map(r => ({
          project: r.project,
          revision: r,
          reviews: r.reviews,
        }));
        setQueue(items);
      } catch (e) {
        if (!cancelled) sonnerToast.error('Failed to load reviews', { description: e instanceof Error ? e.message : '' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pick selected revision from queue
  const current = useMemo(() => {
    if (queue.length === 0) return null;
    return queue.find(q => q.revision.id === selectedRevisionId) || queue[0];
  }, [queue, selectedRevisionId]);

  const geometry = current ? geometryFallback[current.revision.id] || 'gear' : 'gear';
  const isRealFile = !!current?.revision.modelUrl && !current.revision.modelUrl.startsWith('mock://');

  const handleStats = useCallback((stats: ModelStats) => setLiveStats(stats), []);

  const submitDecision = useCallback(async (action: 'APPROVE' | 'REJECT' | 'CHANGES_REQUESTED') => {
    if (!current) return;
    if (action !== 'APPROVE' && !comments.trim()) {
      sonnerToast.error(t('designer.comments'), { description: t('designer.comments_placeholder') });
      return;
    }
    if (action === 'REJECT' && !rejectionReason.trim()) {
      sonnerToast.error(t('designer.rejection_reason'));
      return;
    }
    setSubmitting(true);
    setConfirmAction(null);
    try {
      if (action === 'APPROVE') {
        await api.approveReview(current.revision.id, comments);
        sonnerToast.success(t('designer.action.approve'));
      } else if (action === 'REJECT') {
        await api.rejectReview(current.revision.id, rejectionReason, comments);
        sonnerToast.success(t('designer.action.reject'));
      } else {
        await api.requestChanges(current.revision.id, comments);
        sonnerToast.success(t('designer.action.changes_requested'));
      }
      // Refresh queue
      const { revisions } = await api.listReviews('all');
      setQueue(revisions.map(r => ({ project: r.project, revision: r, reviews: r.reviews })));
      setComments('');
      setRejectionReason('');
      // Navigate to queue
      setView('designer_queue');
    } catch (e) {
      sonnerToast.error('Action failed', { description: e instanceof Error ? e.message : '' });
    } finally {
      setSubmitting(false);
    }
  }, [current, comments, rejectionReason, t, setView]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <Skeleton className="h-[500px]" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-12 text-center">
        <Eye className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <h2 className="text-lg font-semibold">{t('designer.empty_queue')}</h2>
        <Button onClick={() => setView('designer_queue')} className="mt-4">
          {t('designer.queue_title')}
        </Button>
      </div>
    );
  }

  const submitter = current.project.owner;

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
      <Breadcrumbs
        items={[
          { label: t('nav.designer_queue'), onClick: () => setView('designer_queue') },
          { label: current.project.name },
        ]}
      />

      <div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{current.project.name}</h1>
          <Badge variant="outline" className="font-mono text-xs">v{current.revision.version}</Badge>
          <Badge variant="outline" className={cn('text-xs gap-1 border-warning/30 text-warning')}>
            <Clock className="h-3 w-3" />
            {t('designer.submitted_at')}: {formatDateTime(current.revision.createdAt, isRTL)}
          </Badge>
          <Badge variant="outline" className={cn('text-[10px] font-mono',
            isRealFile ? 'border-success/30 text-success' : 'border-warning/30 text-warning'
          )}>
            {isRealFile ? 'REAL FILE' : 'PROCEDURAL'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{current.revision.prompt}</p>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Viewer */}
        <div className="space-y-3">
          <Card className="premium-card overflow-hidden">
            <CardContent className="p-0">
              <ThreeViewer
                geometry={geometry}
                modelUrl={current.revision.modelUrl}
                modelFormat={current.revision.format}
                className="h-[400px] sm:h-[500px] w-full"
                onStats={handleStats}
              />
            </CardContent>
          </Card>
          <Card className="premium-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileBox className="h-4 w-4 text-cyan-glow" />
                {t('designer.geometry_stats')}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <Stat icon={Layers} label={t('viewer.vertices')} value={(liveStats?.vertexCount ?? current.revision.vertexCount)?.toLocaleString() || '—'} live={!!liveStats} />
              <Stat icon={Layers} label={t('viewer.faces')} value={(liveStats?.faceCount ?? current.revision.faceCount)?.toLocaleString() || '—'} live={!!liveStats} />
              <Stat
                icon={Ruler}
                label={t('viewer.bounding_box')}
                value={`${(liveStats?.boundingBoxX ?? current.revision.boundingBoxX)?.toFixed(0)}×${(liveStats?.boundingBoxY ?? current.revision.boundingBoxY)?.toFixed(0)}×${(liveStats?.boundingBoxZ ?? current.revision.boundingBoxZ)?.toFixed(0)}`}
                live={!!liveStats}
              />
              <Stat icon={Cpu} label={t('viewer.format')} value={current.revision.format || '—'} />
            </CardContent>
          </Card>

          {/* Validation report */}
          <Card className="premium-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                {t('designer.validation_report')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {current.revision.validationReport?.split(',').map((v, i) => {
                const passed = v.startsWith('passed');
                const Icon = passed ? CheckCircle2 : AlertCircle;
                const label = v.split(':')[1] || v;
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <Icon className={cn('h-3.5 w-3.5', passed ? 'text-success' : 'text-destructive')} />
                    <span className="capitalize">{label.replace(/_/g, ' ')}</span>
                    <span className={cn('text-[10px] font-mono ms-auto', passed ? 'text-success' : 'text-destructive')}>
                      {passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Previous reviews */}
          {current.reviews.length > 0 && (
            <Card className="premium-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <UserIcon className="h-4 w-4 text-violet-glow" />
                  {t('designer.compare_revisions')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {current.reviews.map(r => (
                  <div key={r.id} className="p-2 rounded-md border border-border/40 bg-background/40 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-[9px] font-mono">
                        {t(`project.generation_status.${r.status.toLowerCase()}`)}
                      </Badge>
                      <span className="text-muted-foreground">{r.reviewerName}</span>
                      <span className="text-[10px] text-muted-foreground ms-auto">
                        {formatDateTime(r.decidedAt || r.createdAt, isRTL)}
                      </span>
                    </div>
                    {r.comments && <p className="text-muted-foreground">{r.comments}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Decision panel */}
        <div className="space-y-3">
          <Card className="premium-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <UserIcon className="h-4 w-4 text-cyan-glow" />
                {t('designer.review_workspace')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs space-y-1">
                <div className="text-muted-foreground">{t('designer.submitted_by')}</div>
                <div className="font-medium">{submitter.name}</div>
                <div className="text-[10px] text-muted-foreground">{submitter.email}</div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="comments" className="text-xs">{t('designer.comments')}</Label>
                <Textarea
                  id="comments"
                  value={comments}
                  onChange={e => setComments(e.target.value)}
                  placeholder={t('designer.comments_placeholder')}
                  className="bg-background/60 min-h-[100px] text-xs"
                />
              </div>
              {confirmAction === 'REJECT' && (
                <div className="space-y-2">
                  <Label htmlFor="rejection" className="text-xs">{t('designer.rejection_reason')}</Label>
                  <Textarea
                    id="rejection"
                    value={rejectionReason}
                    onChange={e => setRejectionReason(e.target.value)}
                    placeholder={isRTL ? 'حدّد سبب الرفض...' : 'Specify rejection reason...'}
                    className="bg-background/60 min-h-[60px] text-xs"
                  />
                </div>
              )}

              <div className="space-y-2 pt-2">
                <Button
                  onClick={() => setConfirmAction('APPROVE')}
                  disabled={submitting}
                  className="w-full bg-success hover:bg-success/90 text-success-foreground gap-2 h-10"
                >
                  {submitting && confirmAction === 'APPROVE' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {t('designer.action.approve')}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => setConfirmAction('CHANGES_REQUESTED')}
                    disabled={submitting}
                    variant="outline"
                    className="gap-2 h-10 border-warning/30 text-warning hover:bg-warning/10"
                  >
                    {submitting && confirmAction === 'CHANGES_REQUESTED' ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
                    <span className="text-xs">{t('designer.action.changes_requested')}</span>
                  </Button>
                  <Button
                    onClick={() => setConfirmAction('REJECT')}
                    disabled={submitting}
                    variant="outline"
                    className="gap-2 h-10 border-destructive/30 text-destructive hover:bg-destructive/10"
                  >
                    {submitting && confirmAction === 'REJECT' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    <span className="text-xs">{t('designer.action.reject')}</span>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="premium-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                {isRTL ? 'سياسة المراجعة' : 'Review policy'}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
              <p>• {isRTL ? 'الاعتماد يُسجّل كحدث قابل للتدقيق في قاعدة البيانات.' : 'Approval is recorded as an auditable event in the database.'}</p>
              <p>• {isRTL ? 'المراجعات لا ت inherit الاعتماد من مراجعات سابقة.' : 'Revisions do not inherit approval from prior revisions.'}</p>
              <p>• {isRTL ? 'فقط المراجعة المعتمدة يمكن تقطيعها وإرسالها للطباعة.' : 'Only the approved revision may be sliced and dispatched.'}</p>
              <p>• {isRTL ? 'بوابة الموافقة مُطبّقة على الخادم.' : 'Approval gate is enforced server-side.'}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirmation dialog */}
      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'APPROVE' && t('designer.action.approve')}
              {confirmAction === 'REJECT' && t('designer.action.reject')}
              {confirmAction === 'CHANGES_REQUESTED' && t('designer.action.changes_requested')}
              {' — '}{isRTL ? 'تأكيد' : 'Confirm'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'APPROVE' && (isRTL
                ? `سيتم اعتماد ${current.project.name} v${current.revision.version}. يمكن لمدير المزرعة بعدها تقطيعها وإرسالها للطباعة.`
                : `This will approve ${current.project.name} v${current.revision.version}. The farm manager can then slice and dispatch it.`
              )}
              {confirmAction === 'REJECT' && (isRTL
                ? `سيتم رفض ${current.project.name} v${current.revision.version}. يجب على المستخدم رفع نسخة جديدة.`
                : `This will reject ${current.project.name} v${current.revision.version}. The user must upload a new revision.`
              )}
              {confirmAction === 'CHANGES_REQUESTED' && (isRTL
                ? `سيتم طلب تعديلات على ${current.project.name} v${current.revision.version}.`
                : `This will request changes on ${current.project.name} v${current.revision.version}.`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && submitDecision(confirmAction)}
              className={confirmAction === 'APPROVE' ? 'bg-success text-success-foreground hover:bg-success/90' : confirmAction === 'REJECT' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-warning text-warning-foreground hover:bg-warning/90'}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {confirmAction === 'APPROVE' && t('designer.action.approve')}
              {confirmAction === 'REJECT' && t('designer.action.reject')}
              {confirmAction === 'CHANGES_REQUESTED' && t('designer.action.changes_requested')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ icon: Icon, label, value, live }: { icon: React.ElementType; label: string; value: string; live?: boolean }) {
  return (
    <div className="p-2.5 rounded-md border border-border/40 bg-background/40">
      <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] mb-1">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn('text-sm font-mono font-semibold', live && 'text-cyan-glow')}>{value}{live && <span className="ms-1 text-[9px]">●</span>}</div>
    </div>
  );
}
