'use client';

import { useEffect, lazy, Suspense } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { TopNav } from './top-nav';
import { SideNav } from './side-nav';
import { LandingView } from './views/landing';
import { AuthView } from './views/auth';
import { LiveConnectionBadge } from './live-badge';
import { io } from 'socket.io-client';

// Lazy-load all heavy views to reduce initial bundle size and memory pressure
const UserDashboardView = lazy(() => import('./views/user-dashboard').then(m => ({ default: m.UserDashboardView })));
const NewProjectView = lazy(() => import('./views/new-project').then(m => ({ default: m.NewProjectView })));
const ModelViewerView = lazy(() => import('./views/model-viewer').then(m => ({ default: m.ModelViewerView })));
const DesignerQueueView = lazy(() => import('./views/designer-queue').then(m => ({ default: m.DesignerQueueView })));
const DesignerReviewView = lazy(() => import('./views/designer-review').then(m => ({ default: m.DesignerReviewView })));
const FarmDashboardView = lazy(() => import('./views/farm-dashboard').then(m => ({ default: m.FarmDashboardView })));
const PrinterFleetView = lazy(() => import('./views/printer-fleet').then(m => ({ default: m.PrinterFleetView })));
const SlicingDispatchView = lazy(() => import('./views/slicing-dispatch').then(m => ({ default: m.SlicingDispatchView })));
const AdminAnalyticsView = lazy(() => import('./views/admin-analytics').then(m => ({ default: m.AdminAnalyticsView })));
const AdminUsersView = lazy(() => import('./views/admin-users').then(m => ({ default: m.AdminUsersView })));
const NotificationsView = lazy(() => import('./views/notifications').then(m => ({ default: m.NotificationsView })));
const SettingsView = lazy(() => import('./views/settings').then(m => ({ default: m.SettingsView })));
const SystemHealthView = lazy(() => import('./views/system-health').then(m => ({ default: m.SystemHealthView })));

function ViewLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-xs text-muted-foreground font-mono animate-pulse">Loading...</div>
    </div>
  );
}

export function AppShell() {
  const isAuthenticated = useAppStore(s => s.isAuthenticated);
  const currentView = useAppStore(s => s.currentView);
  const user = useCurrentUser();
  const setView = useAppStore(s => s.setView);
  const setLiveConnected = useAppStore(s => s.setLiveConnected);
  const setLastEventAt = useAppStore(s => s.setLastEventAt);
  const refreshSession = useAppStore(s => s.refreshSession);

  // On mount: refresh session from server (validates JWT cookie)
  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Route-guard: if not authenticated, force landing/auth view
  useEffect(() => {
    if (!isAuthenticated && currentView !== 'landing' && currentView !== 'auth') {
      setView('landing');
    }
  }, [isAuthenticated, currentView, setView]);

  // Role-based view guards
  useEffect(() => {
    if (!user) return;
    const role = user.role;
    if (currentView === 'designer_queue' || currentView === 'designer_review') {
      if (role !== 'DESIGNER' && role !== 'ADMIN') setView('dashboard');
    }
    if (currentView === 'farm_dashboard' || currentView === 'printer_fleet' || currentView === 'slicing_dispatch') {
      if (role !== 'FARM_MANAGER' && role !== 'ADMIN') setView('dashboard');
    }
    if (currentView === 'admin_analytics' || currentView === 'admin_users') {
      if (role !== 'ADMIN') setView('dashboard');
    }
  }, [user, currentView, setView]);

  // Live realtime service connection
  useEffect(() => {
    if (!isAuthenticated) return;
    let socket: ReturnType<typeof io> | null = null;
    try {
      socket = io('/?XTransformPort=3030', {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 2000,
      });
      socket.on('connect', () => setLiveConnected(true));
      socket.on('disconnect', () => setLiveConnected(false));
      socket.on('forma:event', (payload: { type: string; at: string }) => {
        if (payload?.at) setLastEventAt(payload.at);
      });
      socket.on('forma:heartbeat', () => setLastEventAt(new Date().toISOString()));
    } catch {
      // Realtime optional — fail silently
    }
    return () => {
      socket?.disconnect();
    };
  }, [isAuthenticated, setLiveConnected, setLastEventAt]);

  // Unauthenticated views
  if (!isAuthenticated) {
    if (currentView === 'auth') return <AuthView />;
    return <LandingView />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <TopNav />
      <div className="flex flex-1 min-h-0">
        <SideNav />
        <main className="flex-1 min-w-0 overflow-x-hidden">
          <Suspense fallback={<ViewLoader />}>
            {renderView(currentView)}
          </Suspense>
        </main>
      </div>
      <LiveConnectionBadge />
    </div>
  );
}

function renderView(view: string): React.ReactNode {
  switch (view) {
    case 'dashboard': return <UserDashboardView />;
    case 'new_project': return <NewProjectView />;
    case 'model_viewer': return <ModelViewerView />;
    case 'designer_queue': return <DesignerQueueView />;
    case 'designer_review': return <DesignerReviewView />;
    case 'farm_dashboard': return <FarmDashboardView />;
    case 'printer_fleet': return <PrinterFleetView />;
    case 'slicing_dispatch': return <SlicingDispatchView />;
    case 'admin_analytics': return <AdminAnalyticsView />;
    case 'admin_users': return <AdminUsersView />;
    case 'notifications': return <NotificationsView />;
    case 'settings': return <SettingsView />;
    case 'system_health': return <SystemHealthView />;
    default: return <UserDashboardView />;
  }
}
