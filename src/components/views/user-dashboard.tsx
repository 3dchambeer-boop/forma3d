'use client';

import { useEffect, useState } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Plus, Box, Brain, Eye, Cpu, FolderGit2, Activity,
  ArrowRight, ChevronLeft, Clock, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { Breadcrumbs } from '../breadcrumbs';
import { formatRelative } from '../format';
import type { DesignProject, DesignRevision, AIGenerationJob } from '@/lib/types';

interface ProjectWithRelations extends DesignProject {
  owner: { id: string; name: string; email: string };
  revisions: DesignRevision[];
}

const statusColor = (status: string) => ({
  APPROVED: 'success',
  REVIEW_REQUIRED: 'warning',
  REJECTED: 'error',
  CHANGES_REQUESTED: 'warning',
  DRAFT: 'offline',
  PROCESSING: 'busy',
}[status] || 'offline');

export function UserDashboardView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const setView = useAppStore(s => s.setView);
  const selectProject = useAppStore(s => s.selectProject);
  const selectRevision = useAppStore(s => s.selectRevision);

  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectWithRelations[]>([]);
  const [generations, setGenerations] = useState<AIGenerationJob[]>([]);
  const [pendingReviews, setPendingReviews] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [projectsRes, reviewsRes] = await Promise.all([
          api.listProjects(),
          user?.role === 'DESIGNER' || user?.role === 'ADMIN'
            ? api.listReviews('REVIEW_REQUIRED')
            : Promise.resolve({ revisions: [] }),
        ]);
        if (cancelled) return;
        setProjects(projectsRes.projects);
        // Extract generations from projects
        const gens = projectsRes.projects.flatMap(p => (p as DesignProject & { generations?: AIGenerationJob[] }).generations || []);
        setGenerations(gens);
        setPendingReviews(reviewsRes.revisions.length);
      } catch (e) {
        if (!cancelled) console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = false; };
  }, [user?.role]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-20 w-full" />
        <div className="grid lg:grid-cols-3 gap-4">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!user) return null;

  const recentProjects = projects.slice(0, 6);
  const recentGenerations = generations.slice(0, 5);

  const kpis = [
    { label: t('dashboard.kpi.active_projects'), value: projects.filter(p => p.status === 'ACTIVE').length, icon: FolderGit2, accent: 'cyan' as const },
    { label: t('dashboard.kpi.models_generated'), value: generations.length, icon: Brain, accent: 'violet' as const },
    { label: t('dashboard.kpi.pending_reviews'), value: pendingReviews, icon: Eye, accent: 'warning' as const },
    { label: t('dashboard.kpi.active_prints'), value: 0, icon: Cpu, accent: 'cyan' as const },
  ];

  const accentClasses = {
    cyan: 'text-cyan-glow bg-cyan-glow/10 border-cyan-glow/20',
    violet: 'text-violet-glow bg-violet-glow/10 border-violet-glow/20',
    warning: 'text-warning bg-warning/10 border-warning/20',
    destructive: 'text-destructive bg-destructive/10 border-destructive/20',
  };

  function openProject(projectId: string, revisionId: string) {
    selectProject(projectId);
    selectRevision(revisionId);
    setView('model_viewer');
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {t('dashboard.welcome')}, <span className="gradient-text">{user.name.split(' ')[0]}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('dashboard.subtitle')}</p>
        </div>
        <Button
          onClick={() => setView('new_project')}
          className="bg-gradient-to-r from-cyan-glow to-violet-glow text-background hover:opacity-90 gap-2"
        >
          <Plus className="h-4 w-4" />
          {t('dashboard.action.new_project')}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <Card key={i} className="premium-card">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={cn('inline-flex h-9 w-9 rounded-lg items-center justify-center border', accentClasses[kpi.accent])}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
                    {isRTL ? '↗' : '↑'} 12%
                  </span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">{kpi.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{kpi.label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          {t('dashboard.quick_actions')}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: t('dashboard.action.new_project'), icon: Plus, view: 'new_project' as const, accent: 'cyan' },
            { label: t('dashboard.action.upload_model'), icon: Box, view: 'model_viewer' as const, accent: 'violet' },
            { label: t('dashboard.action.view_prints'), icon: Cpu, view: 'farm_dashboard' as const, accent: 'warning' },
            { label: t('dashboard.action.help'), icon: Activity, view: 'system_health' as const, accent: 'cyan' },
          ].map((action, i) => {
            const Icon = action.icon;
            return (
              <button
                key={i}
                onClick={() => setView(action.view)}
                className="group flex items-center gap-3 p-3 rounded-lg border text-start transition-all hover:scale-[1.02] active:scale-[0.98] border-border bg-card/40 hover:bg-card/80"
              >
                <div className={cn('inline-flex h-9 w-9 rounded-lg items-center justify-center border', accentClasses[action.accent as keyof typeof accentClasses])}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium flex-1">{action.label}</span>
                {isRTL ? <ChevronLeft className="h-4 w-4 text-muted-foreground group-hover:text-foreground" /> : <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 premium-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderGit2 className="h-4 w-4 text-cyan-glow" />
              {t('dashboard.recent_projects')}
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-xs h-7">
              {t('common.view')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto scrollbar-custom">
            {recentProjects.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                <FolderGit2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                {t('common.no_data')}
              </div>
            ) : (
              recentProjects.map(p => {
                const latestRev = p.revisions[p.revisions.length - 1];
                if (!latestRev) return null;
                return (
                  <button
                    key={p.id}
                    onClick={() => openProject(p.id, latestRev.id)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/40 hover:bg-background/80 hover:border-cyan-glow/30 transition group text-start"
                  >
                    <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-cyan-glow/20 to-violet-glow/20 flex items-center justify-center shrink-0">
                      <Box className="h-5 w-5 text-cyan-glow" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.description}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('status-dot', statusColor(latestRev.status))} />
                      <Badge variant="outline" className="text-[10px] font-mono">
                        v{latestRev.version}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground hidden sm:inline">
                        {formatRelative(p.updatedAt, isRTL)}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="premium-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-violet-glow" />
              {t('dashboard.recent_activity')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 max-h-96 overflow-y-auto scrollbar-custom">
            {recentGenerations.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                {t('common.no_data')}
              </div>
            ) : (
              recentGenerations.map(g => (
                <div key={g.id} className="flex items-start gap-2.5 text-xs">
                  <div className={cn(
                    'mt-0.5 h-6 w-6 rounded shrink-0 flex items-center justify-center',
                    g.status === 'APPROVED' ? 'bg-success/15 text-success' :
                    g.status === 'REVIEW_REQUIRED' ? 'bg-warning/15 text-warning' :
                    g.status === 'FAILED' ? 'bg-destructive/15 text-destructive' :
                    'bg-muted text-muted-foreground'
                  )}>
                    {g.status === 'APPROVED' ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                     g.status === 'REVIEW_REQUIRED' ? <AlertCircle className="h-3.5 w-3.5" /> :
                     <Clock className="h-3.5 w-3.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{g.textPrompt || 'Image-to-3D'}</div>
                    <div className="text-muted-foreground">
                      {g.provider} · {formatRelative(g.createdAt, isRTL)}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[9px] font-mono shrink-0">
                    {t(`project.generation_status.${g.status.toLowerCase()}`)}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pending reviews for designer/admin */}
      {(user.role === 'DESIGNER' || user.role === 'ADMIN') && pendingReviews > 0 && (
        <Card className="premium-card">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-warning" />
              {t('designer.queue_title')}
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setView('designer_queue')}>
              {t('common.view')}
              {isRTL ? <ChevronLeft className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
            </Button>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setView('designer_queue')} variant="outline" className="w-full gap-2">
              <Eye className="h-4 w-4" />
              {pendingReviews} {isRTL ? 'مراجعات معلّقة' : 'pending reviews'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
