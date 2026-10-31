'use client';

// Renders a mesh_validation_service report exactly as the engine produced it:
// status, issues, repairs applied, and the checks it did NOT perform.

import { AlertTriangle, CheckCircle2, Info, Wrench, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ValidationReport } from '@/lib/types';

const STATUS_STYLE: Record<string, { cls: string; ar: string; en: string }> = {
  VALIDATED: { cls: 'border-success/30 bg-success/10 text-success', ar: 'اجتاز الفحص', en: 'Validated' },
  VALID_WITH_WARNINGS: { cls: 'border-warning/30 bg-warning/10 text-warning', ar: 'صالح مع تحذيرات', en: 'Valid with warnings' },
  REPAIR_REQUIRED: { cls: 'border-destructive/30 bg-destructive/10 text-destructive', ar: 'يحتاج إصلاحًا', en: 'Repair required' },
};

export function parseReport(raw: unknown): ValidationReport | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as ValidationReport;
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === 'object' && 'status' in v ? (v as ValidationReport) : null;
    } catch {
      return null; // legacy free-text reports are not trustworthy enough to render as a result
    }
  }
  return null;
}

export function ValidationPanel({ report, isRTL }: { report: ValidationReport | null; isRTL: boolean }) {
  if (!report) {
    return (
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5" />
        {isRTL ? 'لا يوجد تقرير فحص هندسي لهذه النسخة.' : 'No geometry validation report for this revision.'}
      </div>
    );
  }
  const st = STATUS_STYLE[report.status] ?? { cls: 'border-border text-muted-foreground', ar: report.status, en: report.status };
  return (
    <div className="space-y-2 text-xs">
      <Badge variant="outline" className={cn('font-medium', st.cls)}>
        {report.status === 'VALIDATED' ? <CheckCircle2 className="h-3 w-3 me-1" /> : <AlertTriangle className="h-3 w-3 me-1" />}
        {isRTL ? st.ar : st.en}
      </Badge>
      {report.issues.length > 0 && (
        <ul className="space-y-1">
          {report.issues.map((i, k) => (
            <li key={k} className="flex items-start gap-1.5">
              {i.severity === 'error'
                ? <XCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                : <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />}
              <span dir="ltr" className="text-start">
                <span className="font-mono text-[10px] me-1">{i.code}{i.count != null ? ` ×${i.count}` : ''}</span>
                {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {report.repairs_applied.length > 0 && (
        <div className="space-y-1">
          <div className="text-muted-foreground flex items-center gap-1"><Wrench className="h-3 w-3" />{isRTL ? 'إصلاحات آلية طُبّقت' : 'Automatic repairs applied'}</div>
          <ul className="list-disc ps-5 space-y-0.5" dir="ltr">{report.repairs_applied.map((r, k) => <li key={k}>{r}</li>)}</ul>
        </div>
      )}
      {report.checks_not_performed.length > 0 && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer">{isRTL ? 'فحوص لم تُجرَ (تحتاج مراجعة بشرية أو المقطّع)' : 'Checks not performed (need human review or the slicer)'}</summary>
          <ul className="list-disc ps-5 mt-1 space-y-0.5" dir="ltr">{report.checks_not_performed.map((c, k) => <li key={k}>{c}</li>)}</ul>
        </details>
      )}
      {report.stats?.estimated_min_wall_mm != null && (
        <div className="text-muted-foreground">
          {isRTL ? 'أرقّ جدار (تقدير بالعيّنات): ' : 'Thinnest wall (sampled estimate): '}
          <span className="font-mono">{report.stats.estimated_min_wall_mm} mm</span>
        </div>
      )}
    </div>
  );
}
