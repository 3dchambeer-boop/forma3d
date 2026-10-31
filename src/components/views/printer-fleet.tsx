'use client';

import { useState, useEffect } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Cpu, Search, Thermometer, Clock, Box, CheckCircle2, XCircle,
  Wifi, WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { sonnerToast } from '../sonner-toast';
import { Breadcrumbs } from '../breadcrumbs';
import { formatRelative } from '../format';
import type { Printer, PrinterStatus } from '@/lib/types';

const statusColor = (s: PrinterStatus) => {
  switch (s) {
    case 'IDLE': return { dot: 'online', badge: 'border-success/30 text-success bg-success/10' };
    case 'BUSY':
    case 'HEATING': return { dot: 'busy', badge: 'border-warning/30 text-warning bg-warning/10' };
    case 'OFFLINE': return { dot: 'offline', badge: 'border-muted-foreground/30 text-muted-foreground bg-muted/20' };
    case 'ERROR': return { dot: 'error', badge: 'border-destructive/30 text-destructive bg-destructive/10' };
    case 'PAUSED': return { dot: 'busy', badge: 'border-warning/30 text-warning bg-warning/10' };
  }
};

export function PrinterFleetView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const setView = useAppStore(s => s.setView);

  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | PrinterStatus>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { printers } = await api.listPrinters();
        if (!cancelled) setPrinters(printers);
      } catch (e) { if (!cancelled) console.error(e); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = false; };
  }, []);

  const filtered = printers.filter(p => {
    if (filter !== 'all' && p.status !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.model.toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
      <Breadcrumbs
        items={[
          { label: t('nav.dashboard'), onClick: () => setView('dashboard') },
          { label: t('nav.farm_dashboard'), onClick: () => setView('farm_dashboard') },
          { label: t('nav.printer_fleet') },
        ]}
      />

      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Cpu className="h-6 w-6 text-cyan-glow" />
          {t('farm.fleet_title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('farm.fleet_subtitle')}</p>
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
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            <SelectItem value="IDLE">Idle</SelectItem>
            <SelectItem value="BUSY">Busy</SelectItem>
            <SelectItem value="HEATING">Heating</SelectItem>
            <SelectItem value="OFFLINE">Offline</SelectItem>
            <SelectItem value="ERROR">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(p => {
          const sc = statusColor(p.status);
          const materialsList = p.materials || [];
          return (
            <Card key={p.id} className="premium-card">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center border', sc.badge)}>
                      <Cpu className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground">{p.model}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className={cn('text-[10px] font-mono capitalize', sc.badge)}>
                    <span className={cn('status-dot', sc.dot)} />
                    {p.status.toLowerCase()}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 p-2 rounded-md bg-background/40">
                    <Thermometer className="h-3.5 w-3.5 text-warning" />
                    <div>
                      <div className="text-[10px] text-muted-foreground">{t('farm.printer.bed_temp')}</div>
                      <div className="font-mono text-sm">{p.bedTemp !== undefined ? `${p.bedTemp}°C` : '—'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 p-2 rounded-md bg-background/40">
                    <Thermometer className="h-3.5 w-3.5 text-destructive" />
                    <div>
                      <div className="text-[10px] text-muted-foreground">{t('farm.printer.nozzle_temp')}</div>
                      <div className="font-mono text-sm">{p.nozzleTemp !== undefined ? `${p.nozzleTemp}°C` : '—'}</div>
                    </div>
                  </div>
                </div>

                {(p.status === 'BUSY' || p.status === 'HEATING') && p.progressPercent !== undefined && p.progressPercent > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{t('farm.printer.current_job')}</span>
                      <span className="font-mono">{p.progressPercent}%</span>
                    </div>
                    <Progress value={p.progressPercent} className="h-1" />
                    <div className="text-[10px] text-muted-foreground truncate">{p.currentJobName}</div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {materialsList.map(m => (
                    <Badge key={m} variant="outline" className="text-[9px] font-mono">{m}</Badge>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40 text-[10px] text-muted-foreground">
                  <div>
                    <div className="text-[9px]">{t('farm.printer.build_volume')}</div>
                    <div className="font-mono">{p.buildVolumeX}×{p.buildVolumeY}×{p.buildVolumeZ}</div>
                  </div>
                  <div>
                    <div className="text-[9px]">Nozzle</div>
                    <div className="font-mono">{p.nozzleDiameter}mm</div>
                  </div>
                  <div>
                    <div className="text-[9px]">Utilization</div>
                    <div className="font-mono text-cyan-glow">{p.utilizationPercent}%</div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-border/40">
                  <span className="flex items-center gap-1">
                    {p.status === 'OFFLINE' ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3 text-success" />}
                    {p.lastSeenAt ? formatRelative(p.lastSeenAt, isRTL) : '—'}
                  </span>
                  <Button
                    size="sm" variant="ghost"
                    className="h-6 text-[10px]"
                    onClick={() => sonnerToast.info(p.name, { description: p.octoprintUrl || 'OctoPrint not configured' })}
                  >
                    {t('common.view')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
