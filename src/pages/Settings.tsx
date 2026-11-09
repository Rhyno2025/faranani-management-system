import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, UserCircle2, Building2, Users, Network, ShieldCheck,
  Lock, Bot, Plug, ScrollText, Database, Settings as SettingsIcon, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../auth';
import { PageHeader } from '../components/ui';
import { roleLabel } from '../lib/access';
import { OverviewPanel } from './settings/OverviewPanel';
import { UsersPanel } from './settings/UsersPanel';
import { GeneralPanel, DepartmentsPanel, RolesPanel, SystemPanel } from './settings/OrgPanels';
import { SecurityPanel, AccountPanel, AuditPanel } from './settings/SecurityPanel';
import { CalvinPanel, IntegrationsPanel } from './settings/CalvinPanel';

type SectionKey =
  | 'overview' | 'account' | 'general' | 'users' | 'departments'
  | 'roles' | 'security' | 'calvin' | 'integrations' | 'audit' | 'system';

interface Section {
  key: SectionKey;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  perm?: string | string[];
}

const SECTIONS: Section[] = [
  { key: 'overview', label: 'Control centre', description: 'Accounts, sign-in activity and security alerts', icon: LayoutDashboard, perm: ['users.manage', 'settings.manage', 'audit.view'] },
  { key: 'account', label: 'My account', description: 'Your profile and password', icon: UserCircle2 },
  { key: 'general', label: 'General settings', description: 'Company profile, notifications and portal', icon: Building2, perm: 'settings.manage' },
  { key: 'users', label: 'User management', description: 'Employee accounts, roles and permissions', icon: Users, perm: 'users.manage' },
  { key: 'departments', label: 'Departments', description: 'Departments and their landing dashboards', icon: Network, perm: 'settings.manage' },
  { key: 'roles', label: 'Roles & permissions', description: 'Default grants for each role', icon: ShieldCheck, perm: 'users.manage' },
  { key: 'security', label: 'Security & logins', description: 'Lockout policy and authentication activity', icon: Lock, perm: 'settings.manage' },
  { key: 'calvin', label: 'CALVIN AI', description: 'Providers, voice and memory', icon: Bot, perm: 'settings.manage' },
  { key: 'integrations', label: 'API integrations', description: 'Email and other service credentials', icon: Plug, perm: 'settings.manage' },
  { key: 'audit', label: 'Audit logs', description: 'Administrative and system activity', icon: ScrollText, perm: 'audit.view' },
  { key: 'system', label: 'System & backup', description: 'Version, counts and database backup', icon: Database, perm: 'settings.manage' },
];

export default function Settings() {
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();

  const available = useMemo(() => SECTIONS.filter((s) => !s.perm || can(s.perm)), [can]);
  const requested = params.get('tab') as SectionKey | null;
  const forceChange = params.get('force') === '1' || Boolean(user?.must_change_password);
  const fallback = forceChange && available.some((s) => s.key === 'account') ? 'account' : available[0]?.key || 'account';
  const active: SectionKey = available.some((s) => s.key === requested) ? (requested as SectionKey) : fallback;
  const activeSection = SECTIONS.find((s) => s.key === active) || SECTIONS[1];

  const goTo = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    if (key !== 'account') next.delete('force');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Administration & Settings"
        subtitle="Central control for employees, departmental access, security and integrations."
        actions={
          <div className="flex items-center gap-2">
            <span className="pill bg-ink text-gold"><SettingsIcon size={11} /> {roleLabel(user?.role || '')}</span>
            <span className="pill bg-neutral-100 text-neutral-600">{user?.department || 'Unassigned department'}</span>
          </div>
        }
      />

      {forceChange && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
          <AlertTriangle size={16} />
          <span className="flex-1">
            This account must set a new password before continuing. Use <strong>My account → Change password</strong>.
          </span>
          <button onClick={() => goTo('account')} className="btn-gold !py-1.5 text-xs">Set password</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
        {/* section navigation */}
        <nav className="panel h-fit overflow-hidden">
          <div className="hidden border-b border-line bg-neutral-50 px-4 py-2.5 lg:block">
            <p className="text-[10.5px] font-bold uppercase tracking-wide text-neutral-500">Administration</p>
          </div>
          <div className="flex gap-1 overflow-x-auto p-2 lg:block lg:space-y-0.5 lg:overflow-visible">
            {available.map((s) => {
              const Icon = s.icon;
              const isActive = s.key === active;
              return (
                <button
                  key={s.key}
                  onClick={() => goTo(s.key)}
                  className={`flex w-full shrink-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition lg:w-auto ${
                    isActive ? 'bg-ink text-white' : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  <Icon size={15} className={isActive ? 'mt-0.5 shrink-0 text-gold' : 'mt-0.5 shrink-0 text-neutral-400'} />
                  <span className="min-w-0">
                    <span className={`block whitespace-nowrap text-[12.5px] font-semibold ${isActive ? 'text-white' : 'text-neutral-700'}`}>
                      {s.label}
                    </span>
                    <span className={`hidden text-[10.5px] leading-snug lg:block ${isActive ? 'text-white/55' : 'text-neutral-400'}`}>
                      {s.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="hidden border-t border-line px-3.5 py-2.5 text-[10px] leading-relaxed text-neutral-400 lg:block">
            Sections are shown according to your granted permissions.
          </div>
        </nav>

        {/* section content */}
        <section className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-neutral-900">{activeSection.label}</h2>
              <p className="text-[11.5px] text-neutral-500">{activeSection.description}</p>
            </div>
          </div>

          {active === 'overview' && <OverviewPanel goTo={goTo} />}
          {active === 'account' && <AccountPanel forceChange={forceChange} />}
          {active === 'general' && <GeneralPanel />}
          {active === 'users' && <UsersPanel />}
          {active === 'departments' && <DepartmentsPanel />}
          {active === 'roles' && <RolesPanel />}
          {active === 'security' && <SecurityPanel />}
          {active === 'calvin' && <CalvinPanel />}
          {active === 'integrations' && <IntegrationsPanel />}
          {active === 'audit' && <AuditPanel />}
          {active === 'system' && <SystemPanel />}
        </section>
      </div>
    </div>
  );
}
