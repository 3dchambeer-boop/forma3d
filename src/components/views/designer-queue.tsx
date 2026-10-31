'use client';

import { useState, useEffect } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Eye, Filter, Search, ChevronRight, ChevronLeft, Clock, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { Breadcrumbs } from '../breadcrumbs';
import { formatRelative } from '../format';
import type { DesignProject, DesignRevision } from '@/lib/types';

interface QueueItem {
  project: DesignProject & { owner: { id: string; name: string; email: string } };
  revision: DesignRevision;
}

const statusColor = (status: string) => ({
  APPROVED: 'success',
  REVIEW_REQUIRED: 'warning',
  REJECTED: 'error',
  CHANGES_REQUESTED: 'warning',
  DRAFT: 'offline',
  PROCESSING: 'busy',
}[status] || 'offline');

export function DesignerQueueView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const setView = useAppStore(s => s.setView);
  const selectProject = useAppStore(s => s.selectProject);
  const selectRevision = useAppStore(s => s.selectRevision);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'REVIEW_REQUIRED' | 'CHANGES_REQUESTED'>('REVIEW_REQUIRED');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<QueueItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { revisions } = await api.listReviews(filter === 'all' ? 'all' : filter);
        if (cancelled) return;
        setItems(revisions.map(r => ({ project: r.project, revision: r })));
      } catch (e) {
        if (!cancelled) console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filter]);

  const filtered = items.filter(({ project, revision }) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return project.name.toLowerCase().includes(q) || revision.prompt.toLowerCase().includes(q);
  });

  function openReview(projectId: string, revisionId: string) {
    selectProject(projectId);
    selectRevision(revisionId);
    setView('designer_review');
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
      <Breadcrumbs
        items={[
          { label: t('nav.dashboard'), onClick: () => setView('dashboard') },
          { label: t('nav.designer_queue') },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('designer.queue_title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('designer.queue_subtitle')}</p>
        </div>
        <Badge variant="outline" className="gap-1.5 border-warning/30 bg-warning/5 text-warning w-fit">
          <Clock className="h-3 w-3" />
          {filtered.length} {isRTL ? 'عنصر بانتظار المراجعة' : 'items awaiting review'}
        </Badge>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('common.search')}
            className="ps-9 bg-background/60"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-full sm:w-48 bg-background/60">
            <Filter className="h-3.5 w-3.5 me-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="REVIEW_REQUIRED">{t('project.generation_status.review_required')}</SelectItem>
            <SelectItem value="CHANGES_REQUESTED">{t('project.generation_status.changes_requested')}</SelectItem>
            <SelectItem value="all">{t('common.all')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="premium-card">
          <CardContent className="p-12 text-center">
            <Eye className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-semibold">{t('designer.empty_queue')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('designer.empty_queue_desc')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(({ project, revision }) => (
            <Card key={revision.id} className="premium-card group cursor-pointer" onClick={() => openReview(project.id, revision.id)}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{project.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {t('designer.submitted_by')}: {project.owner?.name || '—'}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                    v{revision.version}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{revision.prompt}</p>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[9px] font-mono">{revision.format}</Badge>
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {revision.vertexCount?.toLocaleString()} v
                  </Badge>
                  <Badge variant="outline" className="text-[9px] font-mono">
                    {revision.faceCount?.toLocaleString()} f
                  </Badge>
                  <Badge variant="outline" className={cn('text-[9px] font-mono gap-1',
                    revision.status === 'REVIEW_REQUIRED' ? 'border-warning/30 text-warning' : 'border-violet-glow/30 text-violet-glow'
                  )}>
                    <span className={cn('status-dot', statusColor(revision.status))} />
                    {t(`project.generation_status.${revision.status.toLowerCase()}`)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border/40">
                  <span className="text-[10px] text-muted-foreground">
                    {formatRelative(revision.createdAt, isRTL)}
                  </span>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 group-hover:text-cyan-glow">
                    {t('common.view')}
                    {isRTL ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
