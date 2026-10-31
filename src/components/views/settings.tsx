'use client';

import { useState } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Settings as SettingsIcon, User, Globe, Moon, Sun, Lock, Plug,
  Check, Languages,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { sonnerToast } from '../sonner-toast';

export function SettingsView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();
  const locale = useAppStore(s => s.locale);
  const theme = useAppStore(s => s.theme);
  const setLocale = useAppStore(s => s.setLocale);
  const setTheme = useAppStore(s => s.setTheme);

  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');

  if (!user) return null;

  const initials = user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

  function save() {
    sonnerToast.success(t('settings.save'));
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 sm:px-6 py-6 space-y-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-6 w-6 text-cyan-glow" />
          {t('settings.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t('settings.subtitle')}</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 h-auto">
          <TabsTrigger value="profile" className="text-xs gap-1.5 py-2">
            <User className="h-3.5 w-3.5" />
            {t('settings.profile')}
          </TabsTrigger>
          <TabsTrigger value="preferences" className="text-xs gap-1.5 py-2">
            <Globe className="h-3.5 w-3.5" />
            {t('settings.preferences')}
          </TabsTrigger>
          <TabsTrigger value="security" className="text-xs gap-1.5 py-2">
            <Lock className="h-3.5 w-3.5" />
            {t('settings.security')}
          </TabsTrigger>
          <TabsTrigger value="integrations" className="text-xs gap-1.5 py-2">
            <Plug className="h-3.5 w-3.5" />
            {t('settings.integrations')}
          </TabsTrigger>
        </TabsList>

        {/* Profile */}
        <TabsContent value="profile" className="mt-4">
          <Card className="premium-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('settings.profile')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="text-lg font-semibold bg-gradient-to-br from-cyan-glow/30 to-violet-glow/30">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <Button variant="outline" size="sm">{t('settings.avatar')}</Button>
                  <p className="text-[10px] text-muted-foreground">PNG, JPG up to 2MB</p>
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="settings-name">{t('settings.name')}</Label>
                <Input
                  id="settings-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="bg-background/60"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-email">{t('settings.email')}</Label>
                <Input
                  id="settings-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="bg-background/60"
                />
              </div>
              <Button onClick={save} className="bg-gradient-to-r from-cyan-glow to-violet-glow text-background gap-2">
                <Check className="h-4 w-4" />
                {t('settings.save')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Preferences */}
        <TabsContent value="preferences" className="mt-4">
          <Card className="premium-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('settings.preferences')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-background/40">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-cyan-glow/15 text-cyan-glow flex items-center justify-center">
                    <Languages className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{t('settings.language')}</div>
                    <div className="text-[10px] text-muted-foreground">Arabic · English</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm" variant={locale === 'ar' ? 'default' : 'outline'}
                    onClick={() => setLocale('ar')}
                    className="h-8 text-xs"
                  >
                    عربي
                  </Button>
                  <Button
                    size="sm" variant={locale === 'en' ? 'default' : 'outline'}
                    onClick={() => setLocale('en')}
                    className="h-8 text-xs"
                  >
                    English
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-background/40">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-violet-glow/15 text-violet-glow flex items-center justify-center">
                    {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{t('settings.theme')}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {theme === 'dark' ? t('settings.theme_dark') : t('settings.theme_light')}
                    </div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm" variant={theme === 'dark' ? 'default' : 'outline'}
                    onClick={() => setTheme('dark')}
                    className="h-8 text-xs gap-1"
                  >
                    <Moon className="h-3 w-3" />
                    {t('settings.theme_dark')}
                  </Button>
                  <Button
                    size="sm" variant={theme === 'light' ? 'default' : 'outline'}
                    onClick={() => setTheme('light')}
                    className="h-8 text-xs gap-1"
                  >
                    <Sun className="h-3 w-3" />
                    {t('settings.theme_light')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="mt-4">
          <Card className="premium-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('settings.change_password')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="cur-pw">{t('settings.current_password')}</Label>
                <Input id="cur-pw" type="password" className="bg-background/60" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-pw">{t('settings.new_password')}</Label>
                <Input id="new-pw" type="password" className="bg-background/60" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="conf-pw">{t('settings.confirm_password')}</Label>
                <Input id="conf-pw" type="password" className="bg-background/60" />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Two-factor authentication</div>
                  <div className="text-[10px] text-muted-foreground">Add an extra layer of security</div>
                </div>
                <Switch />
              </div>
              <Button onClick={save} className="bg-gradient-to-r from-cyan-glow to-violet-glow text-background gap-2">
                <Check className="h-4 w-4" />
                {t('settings.save')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="mt-4">
          <Card className="premium-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('settings.integrations')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { name: 'Tripo AI', desc: 'AI 3D generation provider', status: 'connected' as const, color: 'cyan' as const },
                { name: 'Meshy AI', desc: 'AI 3D generation provider', status: 'connected' as const, color: 'violet' as const },
                { name: 'Rodin AI', desc: 'AI 3D generation provider', status: 'connected' as const, color: 'cyan' as const },
                { name: 'OctoPrint', desc: '3D printer control', status: 'connected' as const, color: 'violet' as const },
                { name: 'OrcaSlicer', desc: 'Slicing engine', status: 'connected' as const, color: 'cyan' as const },
                { name: 'Supabase', desc: 'Auth, Database, Storage', status: 'connected' as const, color: 'violet' as const },
              ].map((int, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-background/40">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'h-9 w-9 rounded-lg flex items-center justify-center',
                      int.color === 'cyan' ? 'bg-cyan-glow/15 text-cyan-glow' : 'bg-violet-glow/15 text-violet-glow'
                    )}>
                      <Plug className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{int.name}</div>
                      <div className="text-[10px] text-muted-foreground">{int.desc}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    <span className="text-[10px] text-success font-mono uppercase">connected</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
