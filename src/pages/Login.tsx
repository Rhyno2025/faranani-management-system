import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, Loader2, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../auth';
import { toast } from '../components/ui';
import { defaultRouteFor } from '../lib/access';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@farananigroup.co.za');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email address and password.');
      return;
    }
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      if (res.user.must_change_password) {
        toast('Please set a new password before continuing', 'info');
        navigate('/settings?tab=account&force=1', { replace: true });
      } else {
        toast('Welcome back to Faranani Property Group');
        navigate(defaultRouteFor(res.permissions, res.user.role), { replace: true });
      }
    } catch (err: any) {
      setError(err.message || 'Sign in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-bg flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        {/* brand */}
        <div className="mb-7 text-center">
          <p className="text-[26px] font-extrabold tracking-[0.14em] text-gold">FARANANI</p>
          <p className="-mt-0.5 text-[15px] font-semibold tracking-[0.3em] text-white">PROPERTY GROUP</p>
          <p className="mt-2 text-[10.5px] font-medium uppercase tracking-[0.18em] text-white/45">
            Student Accommodation &amp; Property Operations
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white p-6 shadow-2xl sm:p-7">
          <div className="mb-5">
            <h1 className="text-lg font-bold text-neutral-900">Sign in to your account</h1>
            <p className="mt-1 text-[13px] text-neutral-500">
              Enter your credentials to open the management system.
            </p>
          </div>

          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-medium text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={submit} noValidate>
            <label className="mb-3.5 block">
              <span className="mb-1.5 block text-xs font-semibold text-neutral-600">Email address</span>
              <div className="relative">
                <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@farananigroup.co.za"
                  className="field !pl-9"
                  required
                />
              </div>
            </label>

            <label className="mb-2 block">
              <span className="mb-1.5 block text-xs font-semibold text-neutral-600">Password</span>
              <div className="relative">
                <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  className="field !pl-9 !pr-10"
                  required
                />
                <button type="button" onClick={() => setShow((v) => !v)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-neutral-400 hover:text-neutral-600">
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>

            <div className="mb-4 flex items-center justify-between text-xs">
              <label className="flex cursor-pointer items-center gap-1.5 text-neutral-500">
                <input type="checkbox" defaultChecked className="h-3.5 w-3.5 accent-[#c9a227]" />
                Keep me signed in
              </label>
              <span className="text-neutral-400">Secured session</span>
            </div>

            <button type="submit" disabled={busy} className="btn-gold flex w-full items-center justify-center gap-2 !py-2.5">
              {busy ? (
                <><Loader2 size={16} className="animate-spin" /> Signing in…</>
              ) : (
                <>Sign in <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          <div className="mt-5 flex items-start gap-2 rounded-lg bg-neutral-50 px-3 py-2.5 text-[11.5px] leading-relaxed text-neutral-500">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-gold" />
            <span>
              Access is role-based and enforced on the server. All activity is recorded in the audit log.
            </span>
          </div>
        </div>

        <p className="mt-5 text-center text-[11px] text-white/35">
          © {new Date().getFullYear()} Faranani Property Group · Africa/Johannesburg
        </p>
      </div>
    </div>
  );
}
