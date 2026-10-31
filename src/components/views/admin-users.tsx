'use client';

import { useState, useEffect } from 'react';
import { useAppStore, useCurrentUser } from '@/lib/store';
import { useT, useIsRTL } from '../use-t';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Users, Search, ShieldCheck, UserCog, MoreHorizontal, UserPlus, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { sonnerToast } from '../sonner-toast';
import { Breadcrumbs } from '../breadcrumbs';
import { formatRelative, formatDateTime } from '../format';
import type { User, Role, AuditEvent } from '@/lib/types';

const roleColor = (role: Role) => ({
  END_USER: 'border-cyan-glow/30 text-cyan-glow bg-cyan-glow/5',
  DESIGNER: 'border-violet-glow/30 text-violet-glow bg-violet-glow/5',
  FARM_MANAGER: 'border-warning/30 text-warning bg-warning/5',
  ADMIN: 'border-destructive/30 text-destructive bg-destructive/5',
}[role]);

export function AdminUsersView() {
  const t = useT();
  const isRTL = useIsRTL();
  const user = useCurrentUser();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRoleChange, setPendingRoleChange] = useState<{ user: User; newRole: Role } | null>(null);
  const [changingRole, setChangingRole] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [usersRes, auditRes] = await Promise.all([
          api.listUsers(),
          api.listAudit(undefined, 10),
        ]);
        if (cancelled) return;
        setUsers(usersRes.users);
        setAudit(auditRes.events);
      } catch (e) {
        if (!cancelled) sonnerToast.error('Failed to load', { description: e instanceof Error ? e.message : '' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = users.filter(u => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  async function confirmRoleChange() {
    if (!pendingRoleChange) return;
    setChangingRole(true);
    try {
      await api.changeUserRole(pendingRoleChange.user.id, pendingRoleChange.newRole);
      sonnerToast.success('Role updated', {
        description: `${pendingRoleChange.user.name} → ${t(`role.${pendingRoleChange.newRole.toLowerCase()}`)}`,
      });
      // Refresh users
      const { users: updated } = await api.listUsers();
      setUsers(updated);
      // Refresh audit
      const { events } = await api.listAudit(undefined, 10);
      setAudit(events);
    } catch (e) {
      sonnerToast.error('Role change failed', { description: e instanceof Error ? e.message : '' });
    } finally {
      setChangingRole(false);
      setPendingRoleChange(null);
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-4">
      <Breadcrumbs
        items={[
          { label: t('nav.dashboard'), onClick: () => useAppStore.getState().setView('dashboard') },
          { label: t('nav.admin_users') },
        ]}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-cyan-glow" />
            {t('admin.users_title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('admin.users_subtitle')}</p>
        </div>
        <Button className="bg-gradient-to-r from-cyan-glow to-violet-glow text-background gap-2">
          <UserPlus className="h-4 w-4" />
          {isRTL ? 'مستخدم جديد' : 'New user'}
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('common.search')}
            className="ps-9 bg-background/60"
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
          <SelectTrigger className="w-full sm:w-48 bg-background/60">
            <ShieldCheck className="h-3.5 w-3.5 me-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            <SelectItem value="END_USER">{t('role.end_user')}</SelectItem>
            <SelectItem value="DESIGNER">{t('role.designer')}</SelectItem>
            <SelectItem value="FARM_MANAGER">{t('role.farm_manager')}</SelectItem>
            <SelectItem value="ADMIN">{t('role.admin')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="premium-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto scrollbar-custom">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-start font-medium text-muted-foreground py-3 px-4">{t('admin.user.name')}</th>
                  <th className="text-start font-medium text-muted-foreground py-3 px-4">{t('admin.user.role')}</th>
                  <th className="text-start font-medium text-muted-foreground py-3 px-4">{t('admin.user.status')}</th>
                  <th className="text-start font-medium text-muted-foreground py-3 px-4 hidden md:table-cell">{t('admin.user.created')}</th>
                  <th className="text-start font-medium text-muted-foreground py-3 px-4 hidden md:table-cell">{t('admin.user.last_login')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const initials = u.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
                  return (
                    <tr key={u.id} className="border-b border-border/40 hover:bg-accent/40">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className={cn('text-[10px] font-semibold bg-gradient-to-br from-cyan-glow/20 to-violet-glow/20')}>
                              {initials}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{u.name}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Select
                          value={u.role}
                          onValueChange={(v) => setPendingRoleChange({ user: u, newRole: v as Role })}
                          disabled={u.id === user?.id}
                        >
                          <SelectTrigger className="h-7 w-32 text-[10px] bg-background/40" disabled={u.id === user?.id}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="END_USER">{t('role.end_user')}</SelectItem>
                            <SelectItem value="DESIGNER">{t('role.designer')}</SelectItem>
                            <SelectItem value="FARM_MANAGER">{t('role.farm_manager')}</SelectItem>
                            <SelectItem value="ADMIN">{t('role.admin')}</SelectItem>
                          </SelectContent>
                        </Select>
                        {u.id === user?.id && (
                          <div className="text-[9px] text-muted-foreground mt-0.5">{isRTL ? '(أنت)' : '(you)'}</div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className={cn(
                          'text-[9px] font-mono',
                          u.status === 'ACTIVE' ? 'border-success/30 text-success' :
                          u.status === 'SUSPENDED' ? 'border-destructive/30 text-destructive' :
                          'border-warning/30 text-warning'
                        )}>
                          {u.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell text-muted-foreground font-mono text-[10px]">
                        {formatDateTime(u.createdAt, isRTL)}
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell text-muted-foreground font-mono text-[10px]">
                        {u.lastLoginAt ? formatRelative(u.lastLoginAt, isRTL) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card className="premium-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <UserCog className="h-4 w-4 text-violet-glow" />
            {isRTL ? 'سجل التدقيق (من قاعدة البيانات)' : 'Audit log (from database)'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 max-h-72 overflow-y-auto scrollbar-custom">
          {audit.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">{t('common.no_data')}</div>
          ) : (
            audit.map((e, i) => (
              <div key={e.id || i} className="flex items-center gap-3 p-2 rounded-md border border-border/40 bg-background/40 text-xs">
                <div className="h-6 w-6 rounded shrink-0 bg-violet-glow/15 text-violet-glow flex items-center justify-center font-mono text-[10px]">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    <span className="text-cyan-glow">{e.actor?.name || 'system'}</span> · {e.action}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    → {e.resourceType}/{e.resourceId || '—'}
                    {e.metadata && <span className="ms-2">{e.metadata.slice(0, 80)}</span>}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatRelative(e.createdAt, isRTL)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Confirmation dialog */}
      <AlertDialog open={pendingRoleChange !== null} onOpenChange={(open) => !open && setPendingRoleChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isRTL ? 'تأكيد تغيير الدور' : 'Confirm role change'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isRTL
                ? `سيتم تغيير دور ${pendingRoleChange?.user.name} إلى ${t(`role.${pendingRoleChange?.newRole.toLowerCase() || ''}`)}. سيتم تسجيل هذا التغيير في سجل التدقيق.`
                : `This will change ${pendingRoleChange?.user.name}'s role to ${t(`role.${pendingRoleChange?.newRole.toLowerCase() || ''}`)}. This change will be logged in the audit trail.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={changingRole}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRoleChange} disabled={changingRole}>
              {changingRole && <Loader2 className="h-4 w-4 animate-spin me-2" />}
              {t('common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
