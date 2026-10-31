'use client';

import { useAppStore } from '@/lib/store';
import { translate, type Locale } from '@/lib/i18n';

export function useT() {
  const locale = useAppStore(s => s.locale) as Locale;
  return (key: string, params?: Record<string, string | number>) => translate(locale, key, params);
}

export function useLocale(): Locale {
  return useAppStore(s => s.locale) as Locale;
}

export function useIsRTL(): boolean {
  return useLocale() === 'ar';
}
