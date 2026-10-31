'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Box, Eye, AlertCircle, History, FileBox, Layers, Ruler,
  ChevronRight, Cpu, FileWarning, Printer,
} from 'lucide-react';
import { ValidationPanel, parseReport } from '../validation-panel';
import { cn } from '@/lib/utils';
import { ThreeViewer, ViewerControls, type ModelStats } from '../three-viewer';
import { api } from '@/lib/api-client';
import { formatDateTime } from '../format';
import { sonnerToast } from '../sonner-toast';
import { Breadcrumbs } from '../breadcrumbs';
import type { DesignProject, DesignRevision } from '@/lib/types';

interface ProjectWithRelations extends DesignProject {
  owner: { id: string; name: string; email: string };
  revisions: DesignRevision[];
}

const geometryFallback: Record<string, 'gear' | 'frame' | 'bracket' | 'vase' | 'stand' | 'clip'> = {
  'proj-1-rev-1': 'gear', 'proj-1-rev-2': 'gear',
  'proj-2-rev-1': 'frame',
  'proj-3-rev-1': 'stand', 'proj-3-rev-2': 'stand',
  'proj-4-rev-1': 'bracket',
  'proj-5-rev-1': 'vase',
  'proj-6-rev-1': 'clip',
};

const statusColor = (status: string) => ({
  APPROVED: 'success',
  REVIEW_REQUIRED: 'warning',
  REJECTED: 'error',
  CHANGES_REQUESTED: 'warning',
  DRAFT: 'offline',
  PROCESSING: 'busy',
}[status] || 'offline');

export function ModelViewerView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const selectedProjectId = useAppStore(s => s.selectedProjectId);
  const selectedRevisionId = useAppStore(s => s.selectedRevisionId);
  const selectProject = useAppStore(s => s.selectProject);
  const selectRevision = useAppStore(s => s.selectRevision);
  const setView = useAppStore(s => s.setView);

  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [fitKey, setFitKey] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printRequested, setPrintRequested] = useState(false);
  const [project, setProject] = useState<ProjectWithRelations | null>(null);
  const [liveStats, setLiveStats] = useState<ModelStats | null>(null);

  // Load project list, then load selected project
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const targetId = selectedProjectId || (await api.listProjects()).projects[0]?.id;
        if (!targetId) {
          setError('No projects available');
          setLoading(false);
          return;
        }
        const { project: fetched } = await api.getProject(targetId);
        if (cancelled) return;
        setProject(fetched as ProjectWithRelations);
        // Auto-select latest revision if none selected
        if (!selectedRevisionId && fetched.revisions.length > 0) {
          selectRevision(fetched.revisions[fetched.revisions.length - 1].id);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load project');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
     
  }, [selectedProjectId]);

  const revision = useMemo(() => {
    if (!project) return null;
    return project.revisions.find(r => r.id === selectedRevisionId)
      || project.revisions[project.revisions.length - 1]
      || null;
  }, [project, selectedRevisionId]);

  const handleStats = useCallback((stats: ModelStats) => {
    setLiveStats(stats);
  }, []);

  const handleError = useCallback((msg: string) => {
    setError(msg);
  }, []);

  async function requestPrint() {
    if (!revision) return;
    try {
      await api.requestPrint(revision.id);
      setPrintRequested(true);
      sonnerToast.success(isRTL ? 'أُرسل الطلب إلى مدير المزرعة' : 'Request sent to the farm manager');
    } catch (e) {
      sonnerToast.error(e instanceof Error ? e.message : 'Request failed');
    }
  }

  function handleDownload() {
    const fileUrl = revision?.stlUrl || revision?.modelUrl;
    if (!revision || !fileUrl) {
      sonnerToast.error('No model file available for download');
      return;
    }
    // Always through the access-checked API route (files are not public)
    const downloadUrl = fileUrl.startsWith('/models/') ? `/api/models/${fileUrl.replace('/models/', '')}` : fileUrl;
    // Trigger download via fetch + Blob
    fetch(downloadUrl, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project?.name || 'model'}-v${revision.version}.${revision.stlUrl ? 'stl' : revision.format?.toLowerCase() || 'stl'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        sonnerToast.success(t('viewer.download'), {
          description: `${revision.format} · ${liveStats?.vertexCount?.toLocaleString() || revision.vertexCount?.toLocaleString()} vertices`,
        });
      })
      .catch(() => sonnerToast.error('Download failed'));
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <Skeleton className="h-[500px] w-full" />
          <div className="space-y-3">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-12">
        <div className="text-center max-w-md mx-auto">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-1">{t('common.no_data')}</h2>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => setView('dashboard')} variant="outline">
            {t('nav.dashboard')}
          </Button>
        </div>
      </div>
    );
  }

  if (!project || !revision) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-12">
        <div className="text-center">
          <Eye className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-semibold">{t('viewer.no_model')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('viewer.no_model_desc')}</p>
          <Button
            onClick={() => setView('new_project')}
            className="mt-4 bg-gradient-to-r from-cyan-glow to-violet-glow text-background"
          >
            {t('project.new_title')}
          </Button>
        </div>
      </div>
    );
  }

  const geometry = geometryFallback[revision.id] || 'gear';
  const canRequestPrint = revision.status === 'APPROVED' && project.owner?.id === user?.id && !!(revision.stlUrl || revision.format === 'STL');
  const isRealFile = !!revision.modelUrl && !revision.modelUrl.startsWith('mock://');

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: t('nav.dashboard'), onClick: () => setView('dashboard') },
          { label: t('nav.projects'), onClick: () => setView('dashboard') },
          { label: project.name },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{project.name}</h1>
            <Badge variant="outline" className="font-mono text-xs">v{revision.version}</Badge>
            <span className={cn('status-dot', statusColor(revision.status))} />
            <Badge variant="outline" className={cn('text-[10px] font-mono',
              isRealFile ? 'border-success/30 text-success' : 'border-warning/30 text-warning'
            )}>
              {isRealFile ? 'REAL FILE' : 'PROCEDURAL'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{revision.prompt}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select value={revision.id} onValueChange={(v) => selectRevision(v)}>
            <SelectTrigger className="w-48 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {project.revisions.map(r => (
                <SelectItem key={r.id} value={r.id} className="text-xs">
                  v{r.version} · {t(`project.generation_status.${r.status.toLowerCase()}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4">
        {/* Viewer */}
        <div className="space-y-3">
          <Card className="premium-card overflow-hidden">
            <CardContent className="p-0">
              <div className="relative">
                <ThreeViewer
                  key={`${resetKey}-${fitKey}-${revision.id}`}
                  geometry={geometry}
                  modelUrl={revision.modelUrl}
                  modelFormat={revision.format}
                  wireframe={wireframe}
                  showGrid={showGrid}
                  showAxes={showAxes}
                  className="h-[400px] sm:h-[500px] w-full"
                  onStats={handleStats}
                  onError={handleError}
                />
                <div className="absolute top-3 start-3 px-2 py-1 rounded-md bg-background/80 backdrop-blur border border-border text-[10px] font-mono text-muted-foreground">
                  {revision.format}
                  {liveStats ? (
                    <> · {liveStats.vertexCount.toLocaleString()} v · {liveStats.faceCount.toLocaleString()} f</>
                  ) : revision.vertexCount ? (
                    <> · {revision.vertexCount.toLocaleString()} v · {revision.faceCount?.toLocaleString()} f</>
                  ) : null}
                  {isRealFile && (
                    <span className="text-success ms-1">· LIVE</span>
                  )}
                </div>
                {!isRealFile && (
                  <div className="absolute top-3 end-3 px-2 py-1 rounded-md bg-warning/10 border border-warning/30 text-warning text-[10px] font-medium flex items-center gap-1">
                    <FileWarning className="h-3 w-3" />
                    Procedural preview
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <ViewerControls
              wireframe={wireframe}
              onToggleWireframe={() => setWireframe(!wireframe)}
              showGrid={showGrid}
              onToggleGrid={() => setShowGrid(!showGrid)}
              showAxes={showAxes}
              onToggleAxes={() => setShowAxes(!showAxes)}
              onReset={() => setResetKey(k => k + 1)}
              onFit={() => setFitKey(k => k + 1)}
              onDownload={handleDownload}
            />
          </div>
        </div>

        {/* Metadata sidebar */}
        <div className="space-y-3">
          <Card className="premium-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileBox className="h-4 w-4 text-cyan-glow" />
                {t('viewer.metadata')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <MetadataRow icon={Box} label={t('viewer.format')} value={revision.format || '—'} mono />
              <MetadataRow
                icon={Layers}
                label={t('viewer.vertices')}
                value={(liveStats?.vertexCount ?? revision.vertexCount)?.toLocaleString() || '—'}
                mono
                live={!!liveStats}
              />
              <MetadataRow
                icon={Layers}
                label={t('viewer.faces')}
                value={(liveStats?.faceCount ?? revision.faceCount)?.toLocaleString() || '—'}
                mono
                live={!!liveStats}
              />
              <Separator />
              {/* Bounding box: prefer DB-stored real-world dimensions, fall back to live file stats */}
              {(() => {
                const dbX = revision.boundingBoxX;
                const dbY = revision.boundingBoxY;
                const dbZ = revision.boundingBoxZ;
                const hasDbDims = dbX && dbY && dbZ && dbX > 1 && dbY > 1 && dbZ > 1;
                const x = hasDbDims ? dbX! : (liveStats?.boundingBoxX ?? 0);
                const y = hasDbDims ? dbY! : (liveStats?.boundingBoxY ?? 0);
                const z = hasDbDims ? dbZ! : (liveStats?.boundingBoxZ ?? 0);
                return (
                  <MetadataRow
                    icon={Ruler}
                    label={t('viewer.bounding_box')}
                    value={`${x.toFixed(0)} × ${y.toFixed(0)} × ${z.toFixed(0)} mm`}
                    mono
                    live={!!liveStats && !hasDbDims}
                  />
                );
              })()}
              <Separator />
              <MetadataRow
                icon={Cpu}
                label={t('common.status')}
                value={t(`project.generation_status.${revision.status.toLowerCase()}`)}
              />
              <div>
                <div className="text-muted-foreground mb-1.5">{t('designer.validation_report')}</div>
                {/* legacy rows stored unverified "passed:..." strings; only engine reports are rendered as results */}
                <ValidationPanel report={parseReport(revision.validationReport)} isRTL={isRTL} />
              </div>
              {canRequestPrint && (
                <Button size="sm" onClick={requestPrint} disabled={printRequested} className="w-full gap-1.5">
                  <Printer className="h-3.5 w-3.5" />
                  {printRequested ? (isRTL ? 'أُرسل طلب الطباعة' : 'Print requested') : (isRTL ? 'اطلب الطباعة' : 'Request print')}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Revisions history */}
          <Card className="premium-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <History className="h-4 w-4 text-violet-glow" />
                {t('viewer.revisions')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 max-h-64 overflow-y-auto scrollbar-custom">
              {project.revisions.map(r => (
                <button
                  key={r.id}
                  onClick={() => selectRevision(r.id)}
                  className={cn(
                    'w-full flex items-center gap-2 p-2 rounded-md border text-start transition',
                    r.id === revision.id
                      ? 'border-cyan-glow/30 bg-cyan-glow/10'
                      : 'border-border/40 hover:bg-accent'
                  )}
                >
                  <span className={cn('status-dot', statusColor(r.status))} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">v{r.version}</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {formatDateTime(r.createdAt, isRTL)}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {r.format}
                  </Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function MetadataRow({ icon: Icon, label, value, mono, live }: {
  icon: React.ElementType;
  label: string;
  value: string;
  mono?: boolean;
  live?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className={cn('font-medium', mono && 'font-mono', live && 'text-cyan-glow')}>
        {value}
        {live && <span className="ms-1 text-[9px]">●</span>}
      </span>
    </div>
  );
}
