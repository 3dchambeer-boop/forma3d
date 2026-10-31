'use client';

import { useAppStore } from '@/lib/store';
import { useT } from './use-t';
import { Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export function LiveConnectionBadge() {
  const t = useT();
  const connected = useAppStore(s => s.liveConnected);
  const lastEventAt = useAppStore(s => s.lastEventAt);

  if (connected) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 px-3 py-2 rounded-lg bg-card/95 backdrop-blur border border-warning/30 text-xs flex items-center gap-2 shadow-xl">
      <WifiOff className="h-3.5 w-3.5 text-warning" />
      <span className="text-muted-foreground">
        {t('health.websocket')}: {t('health.degraded')}
      </span>
    </div>
  );
}

export function LiveBadge({ className }: { className?: string }) {
  const connected = useAppStore(s => s.liveConnected);
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono border',
      connected
        ? 'border-success/30 bg-success/10 text-success'
        : 'border-muted-foreground/30 bg-muted/30 text-muted-foreground',
      className
    )}>
      <span className={cn('status-dot', connected ? 'online' : 'offline')} />
      {connected ? 'LIVE' : 'IDLE'}
    </span>
  );
}
