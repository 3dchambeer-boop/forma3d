'use client';

import { useAppStore } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Box, Brain, Eye, Scissors, Cpu, CheckCircle2, ShieldCheck,
  Languages, ArrowRight, Sparkles, Factory, Layers, GitBranch,
  Activity, Zap, ChevronLeft, Hexagon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function LandingView() {
  const t = useT();
  const isRTL = useIsRTL();
  const setView = useAppStore(s => s.setView);
  const toggleLocale = useAppStore(s => s.toggleLocale);
  const locale = useAppStore(s => s.locale);

  const features = [
    { icon: GitBranch, title: t('landing.feature_pipeline_title'), desc: t('landing.feature_pipeline_desc'), accent: 'cyan' },
    { icon: Eye, title: t('landing.feature_review_title'), desc: t('landing.feature_review_desc'), accent: 'violet' },
    { icon: Factory, title: t('landing.feature_farm_title'), desc: t('landing.feature_farm_desc'), accent: 'cyan' },
    { icon: ShieldCheck, title: t('landing.feature_rbac_title'), desc: t('landing.feature_rbac_desc'), accent: 'violet' },
    { icon: Languages, title: t('landing.feature_i18n_title'), desc: t('landing.feature_i18n_desc'), accent: 'cyan' },
    { icon: Zap, title: t('landing.feature_security_title'), desc: t('landing.feature_security_desc'), accent: 'violet' },
  ];

  const pipelineSteps = [
    { icon: Sparkles, label: t('landing.pipeline.step_1') },
    { icon: Brain, label: t('landing.pipeline.step_2') },
    { icon: Eye, label: t('landing.pipeline.step_3') },
    { icon: Scissors, label: t('landing.pipeline.step_4') },
    { icon: Cpu, label: t('landing.pipeline.step_5') },
    { icon: Box, label: t('landing.pipeline.step_6') },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="relative h-9 w-9 rounded-lg bg-gradient-to-br from-cyan-glow to-violet-glow flex items-center justify-center glow-cyan">
              <Hexagon className="h-5 w-5 text-background" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-base font-bold tracking-tight">{t('brand.name')}</span>
              <span className="text-[10px] text-muted-foreground hidden sm:block">{t('brand.tagline')}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleLocale} className="gap-1.5">
              <Languages className="h-4 w-4" />
              <span className="hidden sm:inline">{locale === 'ar' ? 'EN' : 'ع'}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setView('auth')} className="text-sm">
              {t('nav.sign_in')}
            </Button>
            <Button
              size="sm"
              onClick={() => setView('auth')}
              className="bg-gradient-to-r from-cyan-glow to-violet-glow text-background hover:opacity-90 gap-1.5"
            >
              {t('nav.get_started')}
              {isRTL ? <ChevronLeft className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0 hero-grid" />
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-cyan-glow/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-violet-glow/20 blur-3xl" />

        <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-20 sm:py-28 relative">
          <div className="text-center max-w-4xl mx-auto">
            <Badge variant="outline" className="mb-6 gap-1.5 border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow">
              <Sparkles className="h-3 w-3" />
              {t('brand.tagline')}
            </Badge>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
              {t('landing.hero_title').split('.')[0]}.
              <br />
              <span className="gradient-text">{t('landing.hero_title').split('.').slice(1, 2).join('.')}</span>
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              {t('landing.hero_subtitle')}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                size="lg"
                onClick={() => setView('auth')}
                className="bg-gradient-to-r from-cyan-glow to-violet-glow text-background hover:opacity-90 gap-2 h-12 px-8"
              >
                {t('landing.hero_cta')}
                {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setView('auth')}
                className="gap-2 h-12 px-8 border-border hover:border-cyan-glow/40"
              >
                <Eye className="h-4 w-4" />
                {t('landing.hero_demo')}
              </Button>
            </div>
          </div>

          <div className="mt-20 grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {[
              { label: t('landing.stat_models'), value: '12,847', icon: Box },
              { label: t('landing.stat_prints'), value: '8,492', icon: CheckCircle2 },
              { label: t('landing.stat_printers'), value: '24', icon: Cpu },
              { label: t('landing.stat_providers'), value: '3', icon: Brain },
            ].map((stat, i) => {
              const Icon = stat.icon;
              return (
                <Card key={i} className="premium-card">
                  <CardContent className="p-5">
                    <Icon className="h-5 w-5 text-cyan-glow mb-2" />
                    <div className="text-2xl sm:text-3xl font-bold tracking-tight font-mono">{stat.value}</div>
                    <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-border/40 py-20 sm:py-24">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
              {t('landing.pipeline.title')}
            </h2>
            <p className="text-muted-foreground">{t('landing.pipeline.desc')}</p>
          </div>
          <div className="relative">
            <div className={cn(
              'hidden md:block absolute top-7 h-px bg-gradient-to-r from-transparent via-cyan-glow/40 to-transparent left-0 right-0'
            )} />
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 relative">
              {pipelineSteps.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={i} className="flex flex-col items-center text-center gap-3">
                    <div className="relative h-14 w-14 rounded-xl bg-card border border-border flex items-center justify-center hover:border-cyan-glow/40 transition-colors group">
                      <Icon className="h-6 w-6 text-cyan-glow group-hover:scale-110 transition-transform" />
                      <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-violet-glow text-background text-[10px] font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                    </div>
                    <span className="text-xs sm:text-sm font-medium leading-tight">{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border/40 py-20 sm:py-24">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <Badge variant="outline" className="mb-4 border-violet-glow/30 bg-violet-glow/5 text-violet-glow">
              <Layers className="h-3 w-3" />
              {locale === 'ar' ? 'قدرات المنصة' : 'Platform capabilities'}
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              {locale === 'ar' ? 'هندسة صناعية متكاملة' : 'Integrated industrial engineering'}
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <Card key={i} className="premium-card group">
                  <CardContent className="p-6">
                    <div className={cn(
                      'inline-flex h-10 w-10 rounded-lg items-center justify-center mb-4 border',
                      f.accent === 'cyan'
                        ? 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow'
                        : 'border-violet-glow/30 bg-violet-glow/10 text-violet-glow'
                    )}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-base font-semibold mb-2">{f.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-28">
        <div className="container mx-auto max-w-4xl px-4 sm:px-6">
          <Card className="premium-card overflow-hidden">
            <CardContent className="p-8 sm:p-12 text-center relative">
              <div className="absolute inset-0 hero-grid opacity-50" />
              <div className="relative">
                <Activity className="h-10 w-10 text-cyan-glow mx-auto mb-4" />
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                  {locale === 'ar' ? 'ابدأ البناء اليوم' : 'Start building today'}
                </h2>
                <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
                  {locale === 'ar'
                    ? 'انضم إلى المصممين والمهندسين الذين يحوّلون الأفكار إلى قطع مادية بثقة.'
                    : 'Join designers and engineers turning ideas into physical parts with confidence.'}
                </p>
                <Button
                  size="lg"
                  onClick={() => setView('auth')}
                  className="bg-gradient-to-r from-cyan-glow to-violet-glow text-background hover:opacity-90 gap-2 h-12 px-8"
                >
                  {t('nav.get_started')}
                  {isRTL ? <ChevronLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="mt-auto border-t border-border/60 py-10 bg-card/40">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan-glow to-violet-glow flex items-center justify-center">
                  <Hexagon className="h-4 w-4 text-background" />
                </div>
                <span className="text-sm font-bold">{t('brand.name')}</span>
              </div>
              <p className="text-xs text-muted-foreground">{t('footer.tagline')}</p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('footer.product')}</h4>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li className="hover:text-foreground cursor-pointer transition">{t('footer.docs')}</li>
                <li className="hover:text-foreground cursor-pointer transition">{t('footer.api')}</li>
                <li className="hover:text-foreground cursor-pointer transition">{t('footer.changelog')}</li>
                <li className="hover:text-foreground cursor-pointer transition">{t('footer.status')}</li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('footer.platform')}</h4>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li className="hover:text-foreground cursor-pointer transition">{t('footer.security')}</li>
                <li className="hover:text-foreground cursor-pointer transition">{t('footer.privacy')}</li>
                <li className="hover:text-foreground cursor-pointer transition">{t('footer.terms')}</li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('footer.company')}</h4>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li className="hover:text-foreground cursor-pointer transition">{t('footer.about')}</li>
                <li className="hover:text-foreground cursor-pointer transition">{t('footer.contact')}</li>
              </ul>
            </div>
          </div>
          <div className="pt-6 border-t border-border/40 text-center text-xs text-muted-foreground">
            {t('footer.copyright')}
          </div>
        </div>
      </footer>
    </div>
  );
}
