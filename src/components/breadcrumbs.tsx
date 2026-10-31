'use client';

import { Fragment } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useIsRTL } from './use-t';
import { cn } from '@/lib/utils';

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  const isRTL = useIsRTL();
  const Separator = isRTL ? ChevronLeft : ChevronRight;

  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('flex items-center gap-1 text-xs text-muted-foreground mb-3', className)}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <Fragment key={i}>
            {item.onClick && !isLast ? (
              <button
                onClick={item.onClick}
                className="hover:text-foreground transition"
              >
                {item.label}
              </button>
            ) : (
              <span className={cn(isLast && 'text-foreground font-medium')}>{item.label}</span>
            )}
            {!isLast && <Separator className="h-3 w-3 text-muted-foreground/50" />}
          </Fragment>
        );
      })}
    </nav>
  );
}
