'use client';

import dynamic from 'next/dynamic';

// Load the app shell client-side only (Three.js requires browser APIs)
const AppShell = dynamic(() => import('@/components/app-shell').then(m => ({ default: m.AppShell })), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-cyan-glow to-violet-glow animate-pulse" />
          <div className="absolute inset-0.5 rounded-[10px] bg-background flex items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-cyan-glow animate-pulse" />
          </div>
        </div>
        <div className="text-xs text-muted-foreground font-mono">Initializing FORMA·3D...</div>
      </div>
    </div>
  ),
});

export default function Home() {
  return <AppShell />;
}
