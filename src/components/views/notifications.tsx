'use client';

import { useState, useEffect } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Bell, BellOff, CheckCheck, Brain, Eye, Cpu, AlertTriangle,
  Info, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { sonnerToast } from '../sonner-toast';
import { Breadcrumbs } from '../breadcrumbs';
import { formatRelative, formatDateTime } from '../format';
import type { AppNotification, ViewId } from '@/lib/types';

const typeIcon = (type: string) => {
  switch (type) {
    case 'GENERATION_DONE': return Brain;
    case 'REVIEW_DECISION': return Eye;
    case 'PRINT_COMPLETE': return Cpu;
    case 'PRINT_FAILED': return AlertTriangle;
    case 'PRINTER_OFFLINE': return AlertTriangle;
    default: return Info;
  }
};

const typeColor = (type: string) => {
  switch (type) {
    case 'GENERATION_DONE': return 'cyan';
    case 'REVIEW_DECISION': return 'violet';
    case 'PRINT_COMPLETE': return 'success';
    case 'PRINT_FAILED': return 'destructive';
    case 'PRINTER_OFFLINE': return 'destructive';
    default: return 'muted';
  }
};

export function NotificationsView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const setView = useAppStore(s => s.setView);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { notifications } = await api.listNotifications();
        if (!cancelled) setItems(notifications);
      } catch (e) {
        if (!cancelled) console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function markAllRead() {
    setMarkingAll(true);
    try {
      const unread = items.filter(n => !n.read);
      await Promise.all(unread.map(n => api.markNotificationRead(n.id)));
      setItems(items.map(n => ({ ...n, read: true })));
      sonnerToast.success(t('notifications.mark_all_read'));
    } catch (e) {
      sonnerToast.error('Failed to mark all as read');
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleAction(notif: AppNotification) {
    if (!notif.read) {
      try {
        await api.markNotificationRead(notif.id);
        setItems(items.map(n => n.id === notif.id ? { ...n, read: true } : n));
      } catch { /* ignore */ }
    }
    if (notif.link) setView(notif.link as ViewId);
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 sm:px-6 py-6 space-y-4">
      <Breadcrumbs
        items={[
          { label: t('nav.dashboard'), onClick: () => setView('dashboard') },
          { label: t('nav.notifications') },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="h-6 w-6 text-cyan-glow" />
            {t('notifications.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('notifications.subtitle')}</p>
        </div>
        {items.some(n => !n.read) && (
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={markingAll} className="gap-1.5">
            {markingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
            {t('notifications.mark_all_read')}
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <Card className="premium-card">
          <CardContent className="p-12 text-center">
            <BellOff className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-semibold">{t('notifications.empty')}</h2>
          </CardContent>
        </Card>
      ) : (
        <Card className="premium-card">
          <CardContent className="p-2 space-y-1">
            {items.map(n => {
              const Icon = typeIcon(n.type);
              const color = typeColor(n.type);
              const colorClass = {
                cyan: 'bg-cyan-glow/15 text-cyan-glow',
                violet: 'bg-violet-glow/15 text-violet-glow',
                success: 'bg-success/15 text-success',
                destructive: 'bg-destructive/15 text-destructive',
                muted: 'bg-muted text-muted-foreground',
              }[color];
              return (
                <button
                  key={n.id}
                  onClick={() => handleAction(n)}
                  className={cn(
                    'w-full flex items-start gap-3 p-3 rounded-lg text-start transition',
                    !n.read && 'bg-cyan-glow/5',
                    'hover:bg-accent/60'
                  )}
                >
                  <div className={cn('h-9 w-9 rounded-lg shrink-0 flex items-center justify-center', colorClass)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-sm font-medium', !n.read && 'text-foreground')}>{n.title}</span>
                      {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-cyan-glow pulse-ring" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="outline" className="text-[9px] font-mono">{n.type}</Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {formatRelative(n.createdAt, isRTL)} · {formatDateTime(n.createdAt, isRTL)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
