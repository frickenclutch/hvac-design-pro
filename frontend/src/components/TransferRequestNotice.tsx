import { useEffect, useState } from 'react';
import { ArrowRightLeft, Check, X } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../stores/useToastStore';
import { useAuthStore, type User, type Organisation } from '../features/auth/store/useAuthStore';

type Transfer = Awaited<ReturnType<typeof api.authTransfers>>['transfers'][number];

/**
 * The consent surface for reparent requests (POST /api/org/reparent).
 * Checks once per app load whether any tenant has asked to pull this
 * account in; if so, renders a fixed banner with Accept / Decline.
 * Accepting moves the ACCOUNT (not its projects) into the requesting org
 * and swaps to the fresh session the server returns.
 */
export default function TransferRequestNotice() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const impersonating = useAuthStore((s) => s.impersonating);
  const adoptTransferredSession = useAuthStore((s) => s.adoptTransferredSession);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || impersonating) {
      setTransfers([]);
      return;
    }
    let cancelled = false;
    api.authTransfers()
      .then((r) => { if (!cancelled) setTransfers(r.transfers); })
      .catch(() => { /* silent — a failed poll just means no banner */ });
    return () => { cancelled = true; };
  }, [isAuthenticated, impersonating]);

  const t = transfers[0];
  if (!isAuthenticated || impersonating || !t) return null;

  const inviter = [t.inviter_first_name, t.inviter_last_name].filter(Boolean).join(' ')
    || t.inviter_email || 'An administrator';
  const roleLabel = t.invited_role.charAt(0).toUpperCase() + t.invited_role.slice(1);

  const handleAccept = async () => {
    if (!confirm(
      `Move your account into ${t.org_name ?? 'this organisation'} as ${roleLabel}?\n\n` +
      'Your account moves — your existing projects stay in your current workspace.'
    )) return;
    setBusy(true);
    try {
      const resp = await api.authTransferAccept(t.id);
      adoptTransferredSession({
        token: resp.token,
        refreshToken: resp.refreshToken,
        user: {
          id: resp.user.id,
          email: resp.user.email,
          firstName: resp.user.firstName ?? '',
          lastName: resp.user.lastName ?? '',
          role: resp.user.role,
          isVerified: resp.user.isVerified,
          isPlatformAdmin: resp.user.isPlatformAdmin,
          isPermitAuthority: resp.user.isPermitAuthority,
        } as User,
        organisation: {
          id: resp.organisation.id,
          name: resp.organisation.name,
          type: resp.organisation.type,
          slug: resp.organisation.slug,
          regionCode: resp.organisation.regionCode,
        } as Organisation,
      });
      toast.success(`Welcome to ${resp.organisation.name}!`);
      // Hard navigation so every store re-initializes under the new org.
      window.location.assign('/dashboard');
    } catch {
      setBusy(false); // api.ts already toasted the server error
    }
  };

  const handleDecline = async () => {
    setBusy(true);
    try {
      await api.authTransferDecline(t.id);
      setTransfers((prev) => prev.filter((x) => x.id !== t.id));
      toast.info('Transfer request declined.');
    } catch { /* toasted by api.ts */ }
    setBusy(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-1/2 -translate-x-1/2 z-[60] mt-2 glass-panel rounded-xl border border-sky-500/50 bg-sky-500/10 px-4 py-2.5 flex flex-wrap items-center gap-3 shadow-lg shadow-sky-500/10 max-w-[calc(100vw-2rem)]"
    >
      <ArrowRightLeft className="w-4 h-4 text-sky-400 flex-shrink-0" />
      <span className="text-xs text-sky-200">
        <span className="font-semibold text-white">{inviter}</span> wants to bring your account into{' '}
        <span className="font-semibold text-white">{t.org_name ?? 'their organisation'}</span> as {roleLabel}.
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={handleAccept}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs font-bold text-emerald-300 hover:text-white bg-emerald-500/20 hover:bg-emerald-500/40 rounded-lg px-3 py-1.5 min-h-[32px] transition-colors disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" /> Accept
        </button>
        <button
          onClick={handleDecline}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-300 hover:text-white bg-slate-700/40 hover:bg-slate-700/70 rounded-lg px-3 py-1.5 min-h-[32px] transition-colors disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" /> Decline
        </button>
      </div>
    </div>
  );
}
