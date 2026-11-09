import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, FileCheck, Building2, BedDouble, MessageSquareWarning,
  Wrench, Sparkles, Wallet, Contact, CalendarDays, FolderOpen, Megaphone,
  BarChart3, ScrollText, Settings as SettingsIcon, Search, Bell, Menu, X,
  ChevronLeft, ChevronRight, LogOut, UserCircle2, ShieldCheck, Circle,
  Globe, ChevronDown, Loader2,
} from 'lucide-react';
import { useAuth } from '../auth';
import { roleLabel } from '../lib/access';
import { api } from '../lib/api';
import { CalvinControl } from './Calvin';
import { sastClock, sastDate, fmtWhen, initials, titleCase } from '../lib/format';
import type { Notification } from '../lib/types';
import { toast } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  perm?: string | string[];
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, perm: 'dashboard.exec' },
  { to: '/dashboard', label: 'My Dashboard', icon: LayoutDashboard },
  { to: '/students', label: 'Students', icon: Users, perm: 'students.view' },
  { to: '/applications', label: 'Applications & Admissions', icon: FileCheck, perm: 'applications.view' },
  { to: '/properties', label: 'Properties & Buildings', icon: Building2, perm: 'properties.view' },
  { to: '/rooms', label: 'Rooms & Bed Allocation', icon: BedDouble, perm: 'rooms.view' },
  { to: '/complaints', label: 'Complaints & Requests', icon: MessageSquareWarning, perm: 'complaints.view' },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench, perm: 'maintenance.view' },
  { to: '/cleaning', label: 'Cleaning & Housekeeping', icon: Sparkles, perm: 'cleaning.view' },
  { to: '/finance', label: 'Finance & Accounting', icon: Wallet, perm: 'finance.view' },
  { to: '/office-admin', label: 'Office Administration', icon: FolderOpen, perm: ['office.view', 'office.dashboard'] },
  { to: '/hr', label: 'Human Resources', icon: Contact, perm: ['staff.view', 'hr.dashboard'] },
  { to: '/tasks', label: 'Tasks & Calendar', icon: CalendarDays, perm: 'tasks.view' },
  { to: '/documents', label: 'Documents', icon: FolderOpen, perm: 'documents.view' },
  { to: '/announcements', label: 'Announcements & Communication', icon: Megaphone, perm: 'announcements.view' },
  { to: '/reports', label: 'Reports & Analytics', icon: BarChart3, perm: 'reports.view' },
  { to: '/audit', label: 'Audit Logs', icon: ScrollText, perm: 'audit.view' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, perm: 'settings.manage' },
];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, permissions, can, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const clock = useClock();

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('fg_sidebar') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const visibleNav = useMemo(
    () => NAV.filter((n) => !n.perm || can(n.perm)),
    [can]
  );

  useEffect(() => {
    if (!user) return;
    api.get<{ data: Notification[]; unread: number }>('/notifications')
      .then((r) => { setNotifications(r.data); setUnread(r.unread); })
      .catch(() => { /* silent */ });
  }, [user, location.pathname]);

  // global search
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      api.get<{ results: any[] }>(`/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => setResults(r.results))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setResults([]);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => { setMobileOpen(false); setProfileOpen(false); setNotifOpen(false); }, [location.pathname]);

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications((n) => n.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
      setUnread(0);
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('fg_sidebar', next ? '1' : '0');
  };

  if (!user) return null;

  const sidebar = (
    <aside
      className={`flex h-full flex-col bg-ink text-white transition-all duration-200 ${
        collapsed ? 'w-[68px]' : 'w-[256px]'
      }`}
    >
      {/* Brand — text only, no logo (per client brief) */}
      <div className="border-b border-white/10 px-4 py-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className={`font-extrabold leading-tight tracking-wide text-gold ${collapsed ? 'text-[10px]' : 'text-[15px]'}`}>
              {collapsed ? 'FPG' : 'FARANANI'}
            </p>
            {!collapsed && (
              <>
                <p className="text-[13px] font-semibold leading-tight text-white/95">PROPERTY GROUP</p>
                <p className="mt-1.5 text-[9.5px] font-medium uppercase leading-snug tracking-wider text-white/45">
                  Student Accommodation &amp;<br />Property Operations
                </p>
              </>
            )}
          </div>
          {!collapsed && (
            <button onClick={toggleSidebar} aria-label="Collapse sidebar"
              className="hidden rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white lg:block">
              <ChevronLeft size={15} />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
          return (
            <NavLink key={item.to} to={item.to} className={`nav-item ${active ? 'active' : ''}`}
              title={collapsed ? item.label : undefined}>
              <Icon size={16.5} className="shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {collapsed && (
        <button onClick={toggleSidebar} aria-label="Expand sidebar"
          className="mx-auto mb-2 rounded-md p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white">
          <ChevronRight size={15} />
        </button>
      )}

      {/* profile footer */}
      <div className="border-t border-white/10 px-3 py-3">
        <button onClick={() => setProfileOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-white/5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold to-gold-dark text-[11px] font-bold text-ink">
            {initials(user.full_name)}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold text-white">{user.full_name}</span>
              <span className="block truncate text-[10.5px] text-white/50">{roleLabel(user.role)}</span>
            </span>
          )}
          {!collapsed && <span className="flex items-center gap-1 text-[10px] text-emerald-400"><Circle size={6} fill="currentColor" />Online</span>}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-workspace">
      {/* desktop sidebar */}
      <div className="hidden lg:block">{sidebar}</div>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="relative">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------------- top bar ---------------- */}
        <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-white px-3 sm:px-4">
          <button onClick={() => setMobileOpen(true)} aria-label="Open menu"
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 lg:hidden">
            <Menu size={19} />
          </button>

          <div ref={searchRef} className="relative min-w-0 flex-1 max-w-md">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search students, properties, tasks…"
              aria-label="Global search"
              className="w-full rounded-full border border-line bg-neutral-50 py-2 pl-9 pr-4 text-sm outline-none transition placeholder:text-neutral-400 focus:border-gold/60 focus:bg-white focus:ring-2 focus:ring-gold/20"
            />
            {(results.length > 0 || searching) && (
              <div className="absolute left-0 right-0 top-full mt-1.5 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
                {searching && <div className="flex items-center gap-2 px-4 py-3 text-xs text-neutral-500"><Loader2 size={13} className="animate-spin" />Searching…</div>}
                {!searching && results.map((r, i) => (
                  <button key={i} onClick={() => { navigate(r.link); setQuery(''); setResults([]); }}
                    className="flex w-full items-center gap-3 border-b border-neutral-100 px-4 py-2.5 text-left transition last:border-0 hover:bg-gold-soft/60">
                    <span className="pill bg-ink text-gold">{r.type}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-neutral-800">{r.label}</span>
                      <span className="block truncate text-xs text-neutral-400">{r.sub}</span>
                    </span>
                  </button>
                ))}
                {!searching && results.length === 0 && query.trim().length >= 2 && (
                  <div className="px-4 py-3 text-xs text-neutral-500">No matches for “{query}”.</div>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            {/* live date + clock (Africa/Johannesburg) */}
            <div className="hidden text-right sm:block">
              <p className="text-[11px] font-medium leading-tight text-neutral-500">{sastDate(clock)}</p>
              <p className="text-[13px] font-bold leading-tight tabular-nums text-ink">{sastClock(clock)}</p>
            </div>

            {/* CALVIN AI voice assistant */}
            <CalvinControl />

            {/* notifications */}
            <div className="relative">
              <button onClick={() => { setNotifOpen((v) => !v); setProfileOpen(false); }}
                aria-label={`Notifications (${unread} unread)`}
                className="relative rounded-lg p-2 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800">
                <Bell size={18} />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-full mt-2 w-80 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                    <p className="text-xs font-bold text-neutral-800">Notifications</p>
                    <button onClick={markAllRead} className="text-[11px] font-semibold text-gold-dark hover:underline">Mark all read</button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 && (
                      <p className="px-4 py-6 text-center text-xs text-neutral-400">No notifications yet.</p>
                    )}
                    {notifications.map((n) => (
                      <button key={n.id}
                        onClick={() => { if (n.link) navigate(n.link); setNotifOpen(false); }}
                        className={`flex w-full flex-col gap-0.5 border-b border-neutral-100 px-4 py-2.5 text-left transition last:border-0 hover:bg-gold-soft/50 ${!n.read_at ? 'bg-gold-soft/40' : ''}`}>
                        <span className="flex items-center gap-2">
                          {!n.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />}
                          <span className="truncate text-xs font-semibold text-neutral-800">{n.title}</span>
                        </span>
                        {n.body && <span className="line-clamp-2 text-[11px] text-neutral-500">{n.body}</span>}
                        <span className="text-[10px] text-neutral-400">{fmtWhen(n.created_at)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* profile menu */}
            <div className="relative">
              <button onClick={() => { setProfileOpen((v) => !v); setNotifOpen(false); }}
                className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 transition hover:bg-neutral-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-gold">
                  {initials(user.full_name)}
                </span>
                <span className="hidden text-left md:block">
                  <span className="block max-w-[140px] truncate text-[12.5px] font-semibold leading-tight text-neutral-800">
                    {user.full_name}
                  </span>
                  <span className="block text-[10.5px] leading-tight text-neutral-400">{roleLabel(user.role)}</span>
                </span>
                <ChevronDown size={14} className="hidden text-neutral-400 md:block" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-full mt-2 w-60 overflow-hidden rounded-xl border border-line bg-white shadow-xl">
                  <div className="border-b border-line px-4 py-3">
                    <p className="truncate text-sm font-bold text-neutral-800">{user.full_name}</p>
                    <p className="truncate text-xs text-neutral-500">{user.email}</p>
                    <span className="pill mt-1.5 bg-gold-soft text-gold-dark">{roleLabel(user.role)}</span>
                  </div>
                  <button onClick={() => { navigate('/portal'); setProfileOpen(false); }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-700 transition hover:bg-neutral-50">
                    <Globe size={15} className="text-gold" /> Student Portal view
                  </button>
                  <button onClick={() => { navigate('/settings?tab=account'); setProfileOpen(false); }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-700 transition hover:bg-neutral-50">
                    <UserCircle2 size={15} className="text-neutral-400" /> Account settings
                  </button>
                  <button onClick={() => { navigate('/settings'); setProfileOpen(false); }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-neutral-700 transition hover:bg-neutral-50">
                    <ShieldCheck size={15} className="text-neutral-400" /> Administration
                  </button>
                  <button onClick={async () => { await logout(); navigate('/login'); }}
                    className="flex w-full items-center gap-2.5 border-t border-line px-4 py-2.5 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50">
                    <LogOut size={15} /> Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ---------------- main ---------------- */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
