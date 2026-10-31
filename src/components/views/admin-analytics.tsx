'use client';

import { useEffect, useState } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
  Legend,
} from 'recharts';
import {
  BarChart3, TrendingUp, Activity, Users, Brain, Clock,
  Cpu, CheckCircle2, AlertCircle, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { formatNumber } from '../format';
import { Breadcrumbs } from '../breadcrumbs';

const CHART_COLORS = {
  cyan: '#5dd9e8',
  violet: '#a78bfa',
  success: '#22c55e',
  warning: '#f59e0b',
  destructive: '#ef4444',
  muted: '#64748b',
};

type AnalyticsData = Awaited<ReturnType<typeof api.getAnalytics>>;

export function AdminAnalyticsView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const setView = useAppStore(s => s.setView);

  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.getAnalytics(days);
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load analytics');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days]);

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-12">
        <div className="text-center max-w-md mx-auto">
          <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-1">{t('common.no_data')}</h2>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => setDays(days)} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const kpiCards = [
    {
      label: t('admin.chart.generations_over_time'),
      value: formatNumber(data.summary.totalGenerations, isRTL),
      sub: isRTL ? `آخر ${days} يوماً` : `last ${days} days`,
      icon: Brain,
      accent: 'cyan' as const,
    },
    {
      label: t('admin.chart.print_success'),
      value: `${data.summary.printSuccessRate}%`,
      sub: `${formatNumber(data.summary.successfulPrints, isRTL)}/${formatNumber(data.summary.totalPrints, isRTL)}`,
      icon: CheckCircle2,
      accent: 'violet' as const,
    },
    {
      label: t('admin.chart.user_growth'),
      value: formatNumber(data.summary.totalUsers, isRTL),
      sub: isRTL ? 'تراكمي' : 'cumulative',
      icon: Users,
      accent: 'cyan' as const,
    },
    {
      label: t('admin.chart.provider_latency'),
      value: data.providerLatency.length > 0
        ? `${data.providerLatency.reduce((a, p) => a + p.success, 0) / data.providerLatency.length}%`
        : '—',
      sub: isRTL ? 'متوسط نجاح المزود' : 'avg provider success',
      icon: Activity,
      accent: 'violet' as const,
    },
  ];

  const hasGenerationData = data.generationVolume.some(d => d.parametric + d.tripo + d.selfHosted > 0);
  const hasPrintData = data.printSuccess.some(d => d.success + d.failed > 0);
  const hasUserGrowth = data.userGrowth.length > 0;
  const hasProviderLatency = data.providerLatency.some(p => p.total > 0);
  const hasReviewTurnaround = data.reviewTurnaround.length > 0;
  const hasPrinterUtilization = data.printerUtilization.length > 0;

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
      <Breadcrumbs
        items={[
          { label: t('nav.dashboard'), onClick: () => setView('dashboard') },
          { label: t('nav.admin_analytics') },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-cyan-glow" />
            {t('admin.analytics_title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('admin.analytics_subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v))}>
            <SelectTrigger className="w-32 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7d</SelectItem>
              <SelectItem value="14">14d</SelectItem>
              <SelectItem value="30">30d</SelectItem>
              <SelectItem value="90">90d</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="text-[10px] font-mono gap-1.5">
            <Activity className="h-3 w-3" />
            {new Date(data.generatedAt).toLocaleTimeString(isRTL ? 'ar' : 'en-US')}
          </Badge>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiCards.map((kpi, i) => {
          const Icon = kpi.icon;
          const colorClass = {
            cyan: 'text-cyan-glow bg-cyan-glow/10 border-cyan-glow/20',
            violet: 'text-violet-glow bg-violet-glow/10 border-violet-glow/20',
          }[kpi.accent];
          return (
            <Card key={i} className="premium-card">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={cn('inline-flex h-9 w-9 rounded-lg items-center justify-center border', colorClass)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <TrendingUp className="h-3 w-3 text-success" />
                </div>
                <div className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">{kpi.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{kpi.label}</div>
                <div className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">{kpi.sub}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts grid */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Generation volume */}
        <Card className="premium-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="h-4 w-4 text-cyan-glow" />
              {t('admin.chart.generations_over_time')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('admin.chart.generations_desc')}</p>
          </CardHeader>
          <CardContent>
            {hasGenerationData ? (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data.generationVolume} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                  <defs>
                    <linearGradient id="gradTripo" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.cyan} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={CHART_COLORS.cyan} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradMeshy" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.violet} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={CHART_COLORS.violet} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradRodin" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS.warning} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={CHART_COLORS.warning} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(20,20,30,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Area type="monotone" dataKey="parametric" stackId="1" stroke={CHART_COLORS.cyan} fill="url(#gradTripo)" strokeWidth={2} name={isRTL ? 'هندسي دقيق' : 'Parametric CAD'} />
                  <Area type="monotone" dataKey="tripo" stackId="1" stroke={CHART_COLORS.violet} fill="url(#gradMeshy)" strokeWidth={2} name="Tripo" />
                  <Area type="monotone" dataKey="selfHosted" stackId="1" stroke={CHART_COLORS.warning} fill="url(#gradRodin)" strokeWidth={2} name={isRTL ? 'النموذج المحلي' : 'Self-hosted'} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart label={isRTL ? 'لا توجد بيانات توليد في هذه الفترة' : 'No generation data in this period'} />
            )}
          </CardContent>
        </Card>

        {/* Print success */}
        <Card className="premium-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              {t('admin.chart.print_success')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('admin.chart.print_success_desc')}</p>
          </CardHeader>
          <CardContent>
            {hasPrintData ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.printSuccess} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(20,20,30,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Bar dataKey="success" stackId="a" fill={CHART_COLORS.success} name={isRTL ? 'ناجح' : 'Success'} />
                  <Bar dataKey="failed" stackId="a" fill={CHART_COLORS.destructive} name={isRTL ? 'فاشل' : 'Failed'} radius={[4, 4, 0, 0]} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart label={isRTL ? 'لا توجد بيانات طباعة' : 'No print data'} />
            )}
          </CardContent>
        </Card>

        {/* User growth */}
        <Card className="premium-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-violet-glow" />
              {t('admin.chart.user_growth')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('admin.chart.user_growth_desc')}</p>
          </CardHeader>
          <CardContent>
            {hasUserGrowth ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.userGrowth} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(20,20,30,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Line type="monotone" dataKey="users" stroke={CHART_COLORS.cyan} strokeWidth={2.5} dot={{ fill: CHART_COLORS.cyan, r: 3 }} name={isRTL ? 'المستخدمون' : 'Users'} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart label={isRTL ? 'لا توجد بيانات نمو' : 'No growth data'} />
            )}
          </CardContent>
        </Card>

        {/* Provider latency */}
        <Card className="premium-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              {t('admin.chart.provider_latency')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('admin.chart.provider_latency_desc')}</p>
          </CardHeader>
          <CardContent>
            {hasProviderLatency ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.providerLatency} layout="vertical" margin={{ top: 5, right: 20, bottom: 0, left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} unit="s" />
                  <YAxis type="category" dataKey="provider" tick={{ fontSize: 11, fill: '#cbd5e1' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(20,20,30,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    formatter={(v: number) => [`${v}s`, 'Latency']}
                  />
                  <Bar dataKey="latency" fill={CHART_COLORS.cyan} radius={[0, 4, 4, 0]} name="Latency (s)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart label={isRTL ? 'لا توجد بيانات مزود' : 'No provider data'} />
            )}
          </CardContent>
        </Card>

        {/* Review turnaround */}
        <Card className="premium-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-violet-glow" />
              {t('admin.chart.review_turnaround')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('admin.chart.review_turnaround_desc')}</p>
          </CardHeader>
          <CardContent>
            {hasReviewTurnaround ? (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.reviewTurnaround} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} unit="h" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(20,20,30,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Line type="monotone" dataKey="hours" stroke={CHART_COLORS.violet} strokeWidth={2.5} dot={{ fill: CHART_COLORS.violet, r: 4 }} name={isRTL ? 'ساعات' : 'Hours'} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart label={isRTL ? 'لا توجد بيانات مراجعة' : 'No review data'} />
            )}
          </CardContent>
        </Card>

        {/* Printer utilization */}
        <Card className="premium-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Cpu className="h-4 w-4 text-cyan-glow" />
              {t('admin.chart.printer_utilization')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('admin.chart.printer_utilization_desc')}</p>
          </CardHeader>
          <CardContent>
            {hasPrinterUtilization ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.printerUtilization} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(20,20,30,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Bar dataKey="utilization" radius={[4, 4, 0, 0]} name={isRTL ? 'الاستخدام' : 'Utilization'}>
                    {data.printerUtilization.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={
                          entry.utilization >= 80 ? CHART_COLORS.cyan :
                          entry.utilization >= 60 ? CHART_COLORS.violet :
                          entry.utilization >= 30 ? CHART_COLORS.warning :
                          CHART_COLORS.muted
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart label={isRTL ? 'لا توجد بيانات استخدام' : 'No utilization data'} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Provider breakdown table */}
      <Card className="premium-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-violet-glow" />
            {isRTL ? 'تفصيل أداء المزودين' : 'Provider performance breakdown'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto scrollbar-custom">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-start">
                  <th className="text-start font-medium text-muted-foreground py-2 px-3">Provider</th>
                  <th className="text-start font-medium text-muted-foreground py-2 px-3">Latency (s)</th>
                  <th className="text-start font-medium text-muted-foreground py-2 px-3">Success rate</th>
                  <th className="text-start font-medium text-muted-foreground py-2 px-3">Total jobs</th>
                  <th className="text-start font-medium text-muted-foreground py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.providerLatency.map(p => (
                  <tr key={p.provider} className="border-b border-border/40 hover:bg-accent/40">
                    <td className="py-2.5 px-3 font-medium">{p.provider}</td>
                    <td className="py-2.5 px-3 font-mono">{p.latency || '—'}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden max-w-24">
                          <div className="h-full bg-gradient-to-r from-cyan-glow to-violet-glow" style={{ width: `${p.success}%` }} />
                        </div>
                        <span className="font-mono text-[10px]">{p.success}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono">{p.total}</td>
                    <td className="py-2.5 px-3">
                      <Badge variant="outline" className={cn(
                        'text-[10px] font-mono',
                        p.success >= 92 ? 'border-success/30 text-success' :
                        p.success >= 88 ? 'border-warning/30 text-warning' :
                        'border-destructive/30 text-destructive'
                      )}>
                        {p.success >= 92 ? 'HEALTHY' : p.success >= 88 ? 'DEGRADED' : 'CRITICAL'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[240px] flex flex-col items-center justify-center text-center gap-2 text-muted-foreground">
      <BarChart3 className="h-8 w-8 opacity-30" />
      <p className="text-xs">{label}</p>
    </div>
  );
}
