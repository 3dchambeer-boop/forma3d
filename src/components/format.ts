'use client';

import { useIsRTL } from './use-t';

const AR_RELATIVE: Record<string, string> = {
  now: 'الآن',
  minutes: 'دقيقة',
  hours: 'ساعة',
  days: 'يوم',
  ago: 'منذ',
};

export function formatRelative(iso: string, isRTL: boolean): string {
  const now = new Date();
  const d = new Date(iso);
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (isRTL) {
    if (diffMin < 1) return AR_RELATIVE.now;
    if (diffMin < 60) return `${AR_RELATIVE.ago} ${diffMin} ${AR_RELATIVE.minutes}`;
    if (diffHr < 24) return `${AR_RELATIVE.ago} ${diffHr} ${AR_RELATIVE.hours}`;
    return `${AR_RELATIVE.ago} ${diffDay} ${AR_RELATIVE.days}`;
  } else {
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${diffDay}d ago`;
  }
}

export function formatDateTime(iso: string, isRTL: boolean): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(isRTL ? 'ar' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const time = d.toLocaleTimeString(isRTL ? 'ar' : 'en-US', {
    hour: '2-digit', minute: '2-digit',
  });
  return `${date} · ${time}`;
}

export function formatNumber(n: number, isRTL: boolean): string {
  return n.toLocaleString(isRTL ? 'ar-EG' : 'en-US');
}

export function formatBytes(bytes: number, isRTL: boolean): string {
  const units = isRTL
    ? ['بايت', 'ك.ب', 'م.ب', 'ج.ب']
    : ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx++;
  }
  return `${size.toFixed(1)} ${units[unitIdx]}`;
}
