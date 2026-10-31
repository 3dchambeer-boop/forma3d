'use client';

import { useEffect, useState } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  HeartPulse, Server, Database, Brain, Cpu, Scissors, HardDrive,
  Wifi, Activity, Clock, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Coins, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { Breadcrumbs } from '../breadcrumbs';
import type { ServiceStatus } from '@/lib/types';

const statusIcon = (status: ServiceStatus['status']) => {
  switch (status) {
    case 'HEALTHY': return CheckCircle2;
    case 'DEGRADED': return AlertTriangle;
    case 'OFFLINE': return XCircle;
    case 'NOT_CONFIGURED': return AlertTriangle;
  }
};

const statusColor = (status: ServiceStatus['status']) => {
  switch (status) {
    case 'HEALTHY': return { dot: 'online', badge: 'border-success/30 text-success bg-success/10', icon: 'text-success' };
    case 'DEGRADED': return { dot: 'busy', badge: 'border-warning/30 text-warning bg-warning/10', icon: 'text-warning' };
    case 'OFFLINE': return { dot: 'offline', badge: 'border-muted-foreground/30 text-muted-foreground bg-muted/20', icon: 'text-muted-foreground' };
    case 'NOT_CONFIGURED': return { dot: 'offline', badge: 'border-warning/30 text-warning bg-warning/10', icon: 'text-warning' };
  }
};

const serviceIcon = (id: string) => {
  if (id.includes('db')) return Database;
  if (id.includes('ai')) return Brain;
  if (id.includes('octo')) return Cpu;
  if (id.includes('orca')) return Scissors;
  if (id.includes('storage')) return HardDrive;
  if (id.includes('ws')) return Wifi;
  return Server;
};

export function SystemHealthView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const setView = useAppStore(s => s.setView);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('');

  const loadHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getHealth();
      setServices(result.services);
      setLastUpdated(result.timestamp);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadHealth(); }, []);

  if (loading) {
    return (
      <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-12 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
        <h2 className="text-lg font-semibold mb-1">{t('common.no_data')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <Button onClick={loadHealth} variant="outline" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  const healthy = services.filter(s => s.status === 'HEALTHY').length;
  const degraded = services.filter(s => s.status === 'DEGRADED').length;
  const offline = services.filter(s => s.status === 'OFFLINE' || s.status === 'NOT_CONFIGURED').length;

  return (
    <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-4">
      <Breadcrumbs
        items={[
          { label: t('nav.dashboard'), onClick: () => setView('dashboard') },
          { label: t('nav.system_health') },
        ]}
      />

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <HeartPulse className="h-6 w-6 text-cyan-glow" />
            {t('health.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('health.subtitle')}</p>
        </div>
        <Button onClick={loadHealth} variant="outline" size="sm" className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="text-[10px] text-muted-foreground font-mono">
        {isRTL ? 'آخر تحديث' : 'Last updated'}: {lastUpdated ? new Date(lastUpdated).toLocaleString(isRTL ? 'ar' : 'en-US') : '—'}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="premium-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-success/15 text-success flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono">{healthy}</div>
              <div className="text-[10px] text-muted-foreground">{t('health.healthy')}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="premium-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-warning/15 text-warning flex items-center justify-center">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono">{degraded}</div>
              <div className="text-[10px] text-muted-foreground">{t('health.degraded')}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="premium-card">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-muted text-muted-foreground flex items-center justify-center">
              <XCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono">{offline}</div>
              <div className="text-[10px] text-muted-foreground">{t('health.offline')} / {t('health.not_configured')}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tripo API Balance Card — shown to all users (read-only) */}
      <TripoBalanceCard />

      <div className="grid sm:grid-cols-2 gap-3">
        {services.map(svc => {
          const sc = statusColor(svc.status);
          const SIcon = serviceIcon(svc.id);
          const StIcon = statusIcon(svc.status);
          return (
            <Card key={svc.id} className="premium-card">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-cyan-glow/10 text-cyan-glow flex items-center justify-center">
                      <SIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{svc.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{svc.id}</div>
                    </div>
                  </div>
                  <StIcon className={cn('h-4 w-4', sc.icon)} />
                </div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <Badge variant="outline" className={cn('text-[9px] font-mono', sc.badge)}>
                    <span className={cn('status-dot', sc.dot)} />
                    {svc.status}
                  </Badge>
                  {svc.latencyMs !== undefined && (
                    <Badge variant="outline" className="text-[9px] font-mono">
                      <Clock className="h-2.5 w-2.5" />
                      {svc.latencyMs}ms
                    </Badge>
                  )}
                  {svc.uptime && (
                    <Badge variant="outline" className="text-[9px] font-mono">
                      <Activity className="h-2.5 w-2.5" />
                      {svc.uptime}
                    </Badge>
                  )}
                </div>
                {svc.message && (
                  <p className="text-[10px] text-muted-foreground leading-relaxed">{svc.message}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recovery procedures */}
      <Card className="premium-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            {isRTL ? 'إجراءات الاستعادة' : 'Recovery procedures'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          {[
            { ar: 'للمهام العالقة: أعد تشغيل العامل وستستأنف من آخر حالة محفوظة في قاعدة البيانات.', en: 'For stuck jobs: restart the worker, it resumes from the last durable DB state.' },
            { ar: 'لمزود الذكاء المتدهور: يُحوّل تلقائياً إلى المزود الاحتياطي المُعد (يتطلب متغيرات بيئية لـ TRIPO_API_KEY/MESHY_API_KEY/RODIN_API_KEY).', en: 'For degraded AI provider: automatic failover to configured backup (requires TRIPO_API_KEY/MESHY_API_KEY/RODIN_API_KEY env vars).' },
            { ar: 'لطابعة غير متصلة: تحقق من OctoPrint URL ومفتاح API (OCTOPRINT_API_KEY) في إعدادات الطابعة.', en: 'For offline printer: verify OctoPrint URL and API key (OCTOPRINT_API_KEY) in printer settings.' },
            { ar: 'لمهمة تقطيع فاشلة: تأكد من ملف الطابعة والمادة، ثم أعد المحاولة. لتقطيع حقيقي، اضبط ORCASLICER_BIN.', en: 'For failed slicing job: verify printer profile and material, then retry. For real slicing, set ORCASLICER_BIN.' },
            { ar: 'لاتصال قاعدة بيانات مفقود: تحقق من DATABASE_URL وأعد تشغيل الخدمة.', en: 'For lost DB connection: verify DATABASE_URL and restart the service.' },
          ].map((p, i) => (
            <div key={i} className="flex items-start gap-2 p-2 rounded-md border border-border/40 bg-background/40">
              <span className="h-5 w-5 rounded shrink-0 bg-cyan-glow/15 text-cyan-glow flex items-center justify-center text-[10px] font-mono">
                {i + 1}
              </span>
              <span className="text-muted-foreground leading-relaxed">{isRTL ? p.ar : p.en}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// =====================================================================
// Tripo Balance Card — fetches /api/tripo/status and displays balance
// Visible to all authenticated users (read-only check)
// =====================================================================
function TripoBalanceCard() {
  const isRTL = useIsRTL();
  const [data, setData] = useState<{
    configured: boolean;
    message: string;
    balance: { balance: number; frozen: number } | null;
    error?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBalance = async () => {
    setLoading(true);
    try {
      // Try fetching tripo status — requires farm_manager or admin role
      const res = await fetch('/api/tripo/status', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setData(json);
      } else if (res.status === 403) {
        // End users don't have permission — show a friendly message
        setData({
          configured: true,
          message: isRTL
            ? 'لعرض رصيد Tripo، سجّل دخول كمدير أو مدير مزرعة'
            : 'Sign in as Admin or Farm Manager to view Tripo balance',
          balance: null,
        });
      } else {
        setData({
          configured: false,
          message: 'Failed to load Tripo status',
          balance: null,
          error: true,
        });
      }
    } catch (e) {
      setData({
        configured: false,
        message: e instanceof Error ? e.message : 'Connection failed',
        balance: null,
        error: true,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBalance(); }, []);

  if (loading) {
    return (
      <Card className="premium-card">
        <CardContent className="p-5">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const balance = data.balance?.balance ?? null;
  const isHealthy = data.configured && balance !== null && balance > 0;
  const isLow = balance !== null && balance > 0 && balance < 30;
  const isEmpty = balance === 0;
  const isFrozen = data.balance?.frozen ?? 0;

  return (
    <Card className={cn(
      'premium-card overflow-hidden',
      isHealthy && !isLow && 'border-success/30',
      isLow && 'border-warning/30',
      isEmpty && 'border-destructive/30',
    )}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          {/* Left: Icon + Title */}
          <div className="flex items-center gap-3">
            <div className={cn(
              'h-12 w-12 rounded-xl flex items-center justify-center',
              isHealthy && !isLow && 'bg-success/15 text-success',
              isLow && 'bg-warning/15 text-warning',
              isEmpty && 'bg-destructive/15 text-destructive',
              !isHealthy && !isLow && !isEmpty && 'bg-muted text-muted-foreground',
            )}>
              <Coins className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                {isRTL ? 'رصيد Tripo API' : 'Tripo API Balance'}
                <Badge variant="outline" className={cn(
                  'text-[9px] font-mono',
                  isHealthy && !isLow && 'border-success/30 text-success',
                  isLow && 'border-warning/30 text-warning',
                  isEmpty && 'border-destructive/30 text-destructive',
                  !isHealthy && !isLow && !isEmpty && 'border-muted-foreground/30 text-muted-foreground',
                )}>
                  {data.configured ? (isRTL ? 'مهيّأ' : 'CONFIGURED') : (isRTL ? 'غير مهيّأ' : 'NOT CONFIGURED')}
                </Badge>
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {isRTL ? 'مزود التوليد ثلاثي الأبعاد' : '3D generation provider'}
              </p>
            </div>
          </div>

          {/* Right: Balance number */}
          {balance !== null ? (
            <div className="text-end">
              <div className={cn(
                'text-3xl font-bold font-mono',
                isLow && 'text-warning',
                isEmpty && 'text-destructive',
                !isLow && !isEmpty && 'text-foreground',
              )}>
                {balance}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {isRTL ? 'نقطة متاحة' : 'credits available'}
              </div>
              {isFrozen > 0 && (
                <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {isFrozen} {isRTL ? 'مجمّدة' : 'frozen'}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Status message + estimated generations */}
        <div className="mt-4 pt-3 border-t border-border/40">
          <p className="text-xs text-muted-foreground">{data.message}</p>
          {balance !== null && balance > 0 && (
            <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3 text-cyan-glow" />
                {isRTL ? '~' : '~'}{Math.floor(balance / 10)} {isRTL ? 'نموذج (10 نقاط/نموذج)' : 'models (10 credits each)'}
              </span>
              {isLow && (
                <span className="text-warning flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {isRTL ? 'رصيد منخفض!' : 'Low balance!'}
                </span>
              )}
            </div>
          )}
          {balance === 0 && (
            <a
              href="https://platform.tripo3d.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-glow hover:underline"
            >
              {isRTL ? 'اشحن رصيدك على platform.tripo3d.ai' : 'Recharge at platform.tripo3d.ai →'}
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
