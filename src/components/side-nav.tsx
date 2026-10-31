'use client';

import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from './use-t';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Plus, Box, Eye, ListChecks, ClipboardCheck,
  Factory, Cpu, Scissors, BarChart3, Users, Bell, Settings, HeartPulse,
} from 'lucide-react';
import type { ViewId, Role } from '@/lib/types';

interface NavItem {
  view: ViewId;
  labelKey: string;
  icon: React.ElementType;
  roles: Role[];
  group: 'workspace' | 'operations' | 'administration';
}

const NAV_ITEMS: NavItem[] = [
  // Workspace — everyone
  { view: 'dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard, roles: ['END_USER', 'DESIGNER', 'FARM_MANAGER', 'ADMIN'], group: 'workspace' },
  { view: 'new_project', labelKey: 'nav.new_project', icon: Plus, roles: ['END_USER', 'DESIGNER', 'FARM_MANAGER', 'ADMIN'], group: 'workspace' },
  { view: 'model_viewer', labelKey: 'nav.model_viewer', icon: Box, roles: ['END_USER', 'DESIGNER', 'FARM_MANAGER', 'ADMIN'], group: 'workspace' },

  // Operations — designer + farm + admin
  { view: 'designer_queue', labelKey: 'nav.designer_queue', icon: ListChecks, roles: ['DESIGNER', 'ADMIN'], group: 'operations' },
  { view: 'designer_review', labelKey: 'nav.designer_review', icon: ClipboardCheck, roles: ['DESIGNER', 'ADMIN'], group: 'operations' },
  { view: 'farm_dashboard', labelKey: 'nav.farm_dashboard', icon: Factory, roles: ['FARM_MANAGER', 'ADMIN'], group: 'operations' },
  { view: 'printer_fleet', labelKey: 'nav.printer_fleet', icon: Cpu, roles: ['FARM_MANAGER', 'ADMIN'], group: 'operations' },
  { view: 'slicing_dispatch', labelKey: 'nav.slicing_dispatch', icon: Scissors, roles: ['FARM_MANAGER', 'ADMIN'], group: 'operations' },

  // Administration — admin only
  { view: 'admin_analytics', labelKey: 'nav.admin_analytics', icon: BarChart3, roles: ['ADMIN'], group: 'administration' },
  { view: 'admin_users', labelKey: 'nav.admin_users', icon: Users, roles: ['ADMIN'], group: 'administration' },

  // Common
  { view: 'notifications', labelKey: 'nav.notifications', icon: Bell, roles: ['END_USER', 'DESIGNER', 'FARM_MANAGER', 'ADMIN'], group: 'administration' },
  { view: 'settings', labelKey: 'nav.settings', icon: Settings, roles: ['END_USER', 'DESIGNER', 'FARM_MANAGER', 'ADMIN'], group: 'administration' },
  { view: 'system_health', labelKey: 'nav.system_health', icon: HeartPulse, roles: ['END_USER', 'DESIGNER', 'FARM_MANAGER', 'ADMIN'], group: 'administration' },
];

const GROUP_LABELS: Record<string, string> = {
  workspace: 'nav.workspace',
  operations: 'nav.operations',
  administration: 'nav.administration',
};

export function SideNav() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const currentView = useAppStore(s => s.currentView);
  const setView = useAppStore(s => s.setView);
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const setSidebarOpen = useAppStore(s => s.setSidebarOpen);

  if (!user) return null;

  const visibleItems = NAV_ITEMS.filter(i => i.roles.includes(user.role));
  const groups = ['workspace', 'operations', 'administration'] as const;

  return (
    <>
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          'shrink-0 w-60 border-border bg-sidebar/80 backdrop-blur-xl',
          isRTL ? 'border-l' : 'border-r',
          // Mobile: slide in/out
          'fixed lg:static top-14 bottom-0 z-40 lg:z-auto',
          'transition-transform duration-300',
          sidebarOpen ? 'translate-x-0' : (isRTL ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0'),
        )}
      >
        <nav className="h-full flex flex-col overflow-y-auto scrollbar-custom px-3 py-4">
          {groups.map(group => {
            const items = visibleItems.filter(i => i.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="mb-4">
                <h3 className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {t(GROUP_LABELS[group])}
                </h3>
                <div className="space-y-0.5">
                  {items.map(item => {
                    const active = currentView === item.view;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.view}
                        onClick={() => setView(item.view)}
                        className={cn(
                          'group w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all',
                          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                          active && 'bg-gradient-to-r from-cyan-glow/15 to-violet-glow/10 text-foreground border border-cyan-glow/20',
                          !active && 'text-muted-foreground',
                        )}
                      >
                        <Icon className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          active ? 'text-cyan-glow' : 'text-muted-foreground group-hover:text-foreground'
                        )} />
                        <span className="truncate text-start">{t(item.labelKey)}</span>
                        {active && (
                          <span className={cn('h-1.5 w-1.5 rounded-full bg-cyan-glow ml-auto', isRTL && 'mr-auto ml-0')} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="mt-auto pt-4 border-t border-border/50">
            <div className="px-3 text-[10px] text-muted-foreground/60 leading-relaxed">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span>{t('health.healthy')}</span>
              </div>
              <div className="mt-1 font-mono">v2.1.0-rc.4</div>
            </div>
          </div>
        </nav>
      </aside>
    </>
  );
}
