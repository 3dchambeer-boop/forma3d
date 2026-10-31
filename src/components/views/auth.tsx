'use client';

import { useState } from 'react';
import { useAppStore } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Hexagon, ArrowRight, ChevronLeft, Loader2 } from 'lucide-react';
import { sonnerToast } from '../sonner-toast';
import { api } from '@/lib/api-client';

export function AuthView() {
  const t = useT();
  const isRTL = useIsRTL();
  const setView = useAppStore(s => s.setView);
  const signIn = useAppStore(s => s.signIn);
  const authLoading = useAppStore(s => s.authLoading);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    if (mode === 'signup') {
      try {
        await api.signUp({ name, email, password });
      } catch (e) {
        setLoading(false);
        setError(e instanceof Error ? e.message : 'Sign up failed');
        return;
      }
    }
    const result = await signIn(email, password);
    setLoading(false);
    if (result.ok) {
      sonnerToast.success(t('dashboard.welcome'));
    } else {
      setError(result.error || 'Sign in failed');
    }
  }

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Left visual panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-card border-e border-border/40">
        <div className="absolute inset-0 hero-grid opacity-60" />
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-cyan-glow/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-violet-glow/20 blur-3xl" />

        <div className="relative flex flex-col justify-between p-12 w-full">
          <button
            onClick={() => setView('landing')}
            className="flex items-center gap-2 hover:opacity-80 transition w-fit"
          >
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-cyan-glow to-violet-glow flex items-center justify-center glow-cyan">
              <Hexagon className="h-5 w-5 text-background" />
            </div>
            <span className="text-base font-bold tracking-tight">{t('brand.name')}</span>
          </button>

          <div className="space-y-6 max-w-md">
            <Badge variant="outline" className="border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow">
              {t('brand.tagline')}
            </Badge>
            <h2 className="text-3xl font-bold leading-tight">
              {t('landing.hero_title').split('.')[0]}.
              <br />
              <span className="gradient-text">{t('landing.hero_title').split('.').slice(1, 2).join('.')}</span>
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('landing.hero_subtitle')}
            </p>
          </div>

          <div className="text-xs text-muted-foreground">
            {t('footer.copyright')}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 relative">
        <div className="absolute top-6 start-6 lg:hidden">
          <button
            onClick={() => setView('landing')}
            className="flex items-center gap-2 hover:opacity-80 transition"
          >
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-glow to-violet-glow flex items-center justify-center">
              <Hexagon className="h-4 w-4 text-background" />
            </div>
            <span className="text-sm font-bold">{t('brand.name')}</span>
          </button>
        </div>

        <div className="w-full max-w-md space-y-6">
          <div className="space-y-1.5 text-center sm:text-start">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {mode === 'signin' ? t('auth.signin_title') : t('auth.signup_button')}
            </h1>
            <p className="text-sm text-muted-foreground">{t('auth.signin_subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div className="space-y-2">
                <Label htmlFor="name">{t('auth.name')}</Label>
                <Input
                  id="name" type="text" value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('auth.name')}
                  className="bg-background/60"
                  required
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email" type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="bg-background/60"
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password" type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="bg-background/60"
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={mode === 'signup' ? 10 : undefined}
              />
            </div>

            {error && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 flex items-start gap-2">
                <span className="flex-1">{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading || authLoading}
              className="w-full bg-gradient-to-r from-cyan-glow to-violet-glow text-background hover:opacity-90 gap-2 h-11"
            >
              {(loading || authLoading) ? (
                <><Loader2 className="h-4 w-4 animate-spin" />{t('common.loading')}</>
              ) : (
                <>
                  {mode === 'signin' ? t('auth.signin_button') : t('auth.signup_button')}
                  {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                </>
              )}
            </Button>
          </form>

          <div className="text-center text-xs text-muted-foreground">
            {mode === 'signin' ? (
              <button onClick={() => setMode('signup')} className="hover:text-foreground hover:underline">
                {t('auth.signup_link')}
              </button>
            ) : (
              <button onClick={() => setMode('signin')} className="hover:text-foreground hover:underline">
                {t('auth.signin_link')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

