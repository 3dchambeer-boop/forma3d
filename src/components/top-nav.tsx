'use client';

import { useState } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from './use-t';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Hexagon, Bell, Sun, Moon, Languages, ChevronDown, LogOut,
  User as UserIcon, Settings, Activity, Menu, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sonnerToast } from './sonner-toast';

export function TopNav() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const locale = useAppStore(s => s.locale);
  const theme = useAppStore(s => s.theme);
  const toggleLocale = useAppStore(s => s.toggleLocale);
  const toggleTheme = useAppStore(s => s.toggleTheme);
  const setView = useAppStore(s => s.setView);
  const signOut = useAppStore(s => s.signOut);
  const setSidebarOpen = useAppStore(s => s.setSidebarOpen);
  const sidebarOpen = useAppStore(s => s.sidebarOpen);
  const liveConnected = useAppStore(s => s.liveConnected);

  if (!user) return null;

  const initials = user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  const roleColor = {
    END_USER: 'bg-cyan-glow/15 text-cyan-glow border-cyan-glow/30',
    DESIGNER: 'bg-violet-glow/15 text-violet-glow border-violet-glow/30',
    FARM_MANAGER: 'bg-warning/15 text-warning border-warning/30',
    ADMIN: 'bg-destructive/15 text-destructive border-destructive/30',
  }[user.role];

  const roleLabel = t(`role.${user.role.toLowerCase()}`);

  async function handleSignOut() {
    await signOut();
    sonnerToast.success(t('nav.sign_out'), {
      description: locale === 'ar' ? 'تم تسجيل الخروج بنجاح' : 'Signed out successfully',
    });
  }

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-card/80 backdrop-blur-xl">
      <div className="h-full px-3 sm:px-4 flex items-center justify-between gap-2">
        {/* Left: Logo + sidebar toggle */}
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost" size="icon"
            className="lg:hidden h-9 w-9"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
          >
            <Menu className="h-4 w-4" />
          </Button>
          <button
            onClick={() => setView('dashboard')}
            className="flex items-center gap-2 hover:opacity-80 transition"
          >
            <div className="relative h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-glow to-violet-glow flex items-center justify-center glow-cyan">
              <Hexagon className="h-4 w-4 text-background" />
            </div>
            <div className="hidden sm:flex flex-col leading-none">
              <span className="text-sm font-bold tracking-tight">FORMA·3D</span>
              <span className="text-[10px] text-muted-foreground hidden md:block">{t('brand.tagline')}</span>
            </div>
          </button>
        </div>

        {/* Center: Live status */}
        <div className="hidden md:flex items-center gap-2">
          <Badge variant="outline" className={cn(
            'gap-1.5 font-mono text-[11px]',
            liveConnected
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-muted-foreground/30 bg-muted/30 text-muted-foreground'
          )}>
            <span className={cn('status-dot', liveConnected ? 'online' : 'offline')} />
            {liveConnected
              ? (locale === 'ar' ? 'مباشر متصل' : 'Live · Connected')
              : (locale === 'ar' ? 'غير متصل' : 'Disconnected')}
          </Badge>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon"
            className="h-9 w-9"
            onClick={toggleLocale}
            aria-label="Toggle language"
            title={locale === 'ar' ? 'Switch to English' : 'تبديل إلى العربية'}
          >
            <Languages className="h-4 w-4" />
            <span className="sr-only">Toggle language</span>
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-9 w-9"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-9 w-9 relative"
            onClick={() => setView('notifications')}
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-cyan-glow pulse-ring" />
          </Button>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 h-9 px-2 hover:bg-accent">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className={cn('text-[11px] font-semibold bg-gradient-to-br from-cyan-glow/20 to-violet-glow/20 text-foreground')}>
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden sm:flex flex-col items-start leading-none">
                  <span className="text-xs font-medium">{user.name}</span>
                  <span className="text-[10px] text-muted-foreground">{roleLabel}</span>
                </div>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isRTL ? 'start' : 'end'} className="w-64">
              <DropdownMenuLabel className="flex flex-col gap-1">
                <span>{user.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
                <Badge variant="outline" className={cn('mt-1 w-fit text-[10px] gap-1', roleColor)}>
                  <ShieldCheck className="h-3 w-3" />{roleLabel}
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setView('settings')}>
                <UserIcon className="h-4 w-4" />{t('nav.settings')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setView('notifications')}>
                <Bell className="h-4 w-4" />{t('nav.notifications')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setView('system_health')}>
                <Activity className="h-4 w-4" />{t('nav.system_health')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4" />{t('nav.sign_out')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
