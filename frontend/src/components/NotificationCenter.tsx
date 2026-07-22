import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Thermometer, ShieldCheck, Users, Globe, ShieldAlert, Info,
  Check, X, Trash2, BellOff,
} from 'lucide-react';
import NotificationBell from './NotificationBell';
import {
  useNotificationStore,
  selectUnreadCount,
  type NotificationKind,
} from '../stores/useNotificationStore';

interface NotificationCenterProps {
  /** 'sidebar' = full nav row (respects `collapsed`); 'compact' = icon-only button. */
  variant?: 'sidebar' | 'compact';
  /** Sidebar collapsed to the icon rail. */
  collapsed?: boolean;
  /** Panel opens upward (for the sidebar's bottom cluster). */
  dropUp?: boolean;
  /** Horizontal edge the panel aligns to. */
  align?: 'left' | 'right';
}

const kindMeta: Record<NotificationKind, { icon: typeof Thermometer; color: string; ring: string }> = {
  calc:      { icon: Thermometer, color: 'text-emerald-400', ring: 'bg-emerald-500/15' },
  permit:    { icon: ShieldCheck, color: 'text-amber-400',   ring: 'bg-amber-500/15' },
  team:      { icon: Users,       color: 'text-sky-400',     ring: 'bg-sky-500/15' },
  community: { icon: Globe,       color: 'text-violet-400',  ring: 'bg-violet-500/15' },
  security:  { icon: ShieldAlert, color: 'text-rose-400',    ring: 'bg-rose-500/15' },
  system:    { icon: Info,        color: 'text-slate-300',   ring: 'bg-slate-500/15' },
};

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(ts).toLocaleDateString();
}

const PANEL_WIDTH = 360;

export default function NotificationCenter({
  variant = 'sidebar',
  collapsed = false,
  dropUp = false,
  align = 'left',
}: NotificationCenterProps) {
  const navigate = useNavigate();
  const notifications = useNotificationStore((s) => s.notifications);
  const enabled = useNotificationStore((s) => s.enabled);
  const unread = useNotificationStore(selectUnreadCount);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const toggleEnabled = useNotificationStore((s) => s.toggleEnabled);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    const top = dropUp ? rect.top - gap : rect.bottom + gap;
    let left = align === 'left' ? rect.left : rect.right - PANEL_WIDTH;
    if (left < 8) left = 8;
    if (left + PANEL_WIDTH > window.innerWidth - 8) left = window.innerWidth - PANEL_WIDTH - 8;
    setPos({ top, left });
  }, [dropUp, align]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  // After the panel measures, seat it fully above the trigger when dropUp.
  useEffect(() => {
    if (!open || !dropUp || !panelRef.current || !triggerRef.current) return;
    const h = panelRef.current.offsetHeight;
    const rect = triggerRef.current.getBoundingClientRect();
    let top = rect.top - h - 8;
    if (top < 8) top = 8;
    setPos((p) => ({ ...p, top }));
  }, [open, dropUp, notifications.length]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current && !triggerRef.current.contains(t) &&
          panelRef.current && !panelRef.current.contains(t)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const pending = enabled && unread > 0;
  const badgeText = unread > 9 ? '9+' : String(unread);
  const stateLabel = !enabled ? 'alerts muted' : unread > 0 ? `${unread} unread` : 'no new alerts';
  const ariaLabel = `Notifications — ${stateLabel}`;

  const openRow = (id: string, href?: string) => {
    markRead(id);
    setOpen(false);
    if (href) navigate(href);
  };

  // ── Count badge overlay ──────────────────────────────────────────────────
  const badge = unread > 0 ? (
    <span
      className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold leading-none flex items-center justify-center border shadow-sm ${
        enabled
          ? 'bg-cyan-500 text-slate-950 border-cyan-300/50'
          : 'bg-slate-600 text-slate-200 border-slate-400/40'
      }`}
    >
      {badgeText}
    </span>
  ) : null;

  const bellSize = variant === 'compact' ? 22 : collapsed ? 26 : 24;

  // ── Trigger ──────────────────────────────────────────────────────────────
  const trigger = variant === 'compact' ? (
    <button
      ref={triggerRef}
      onClick={() => setOpen((v) => !v)}
      className="relative p-2.5 rounded-xl hover:bg-slate-800/50 text-slate-400 hover:text-cyan-300 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      title="Notifications"
    >
      <NotificationBell pending={pending} muted={!enabled} size={bellSize} />
      {badge}
    </button>
  ) : (
    <button
      ref={triggerRef}
      onClick={() => setOpen((v) => !v)}
      className={`relative flex w-full items-center gap-2.5 p-3 rounded-xl text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors min-h-[44px] ${collapsed ? 'justify-center' : ''} ${open ? 'bg-cyan-500/10 text-cyan-300' : ''}`}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      title={collapsed ? 'Notifications' : undefined}
    >
      <span className="relative flex-shrink-0">
        <NotificationBell pending={pending} muted={!enabled} size={bellSize} />
        {collapsed && badge}
      </span>
      {!collapsed && (
        <>
          <span className="font-medium text-sm flex-1 text-left">Notifications</span>
          {unread > 0 && (
            <span
              className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold leading-none flex items-center justify-center ${
                enabled ? 'bg-cyan-500 text-slate-950' : 'bg-slate-600 text-slate-200'
              }`}
            >
              {badgeText}
            </span>
          )}
          {!enabled && unread === 0 && <BellOff className="w-3.5 h-3.5 text-slate-600" />}
        </>
      )}
    </button>
  );

  // ── Panel ────────────────────────────────────────────────────────────────
  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          className="fixed z-[9999] rounded-2xl border border-slate-700/60 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col"
          style={{
            top: pos.top,
            left: pos.left,
            width: PANEL_WIDTH,
            maxHeight: 'min(72vh, 560px)',
            background: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {/* Metallic hairline accent — ties the panel to the bell's material */}
          <div
            aria-hidden
            className="h-[2px] w-full flex-shrink-0"
            style={{ background: 'linear-gradient(90deg, #8a4a2c, #c47a4e, #cda43f, #cfd8e3, #8794a6)' }}
          />

          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-800/70 flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <NotificationBell pending={pending} muted={!enabled} size={22} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-white leading-tight">Notifications</p>
                <p className="text-[11px] text-slate-500 leading-tight">
                  {unread > 0 ? `${unread} unread` : 'All caught up'}
                </p>
              </div>
            </div>
            {/* Quick-enable: the Alerts master switch */}
            <button
              onClick={toggleEnabled}
              role="switch"
              aria-checked={enabled}
              className="ml-auto flex items-center gap-2 group flex-shrink-0"
              title={enabled ? 'Mute alerts' : 'Enable alerts'}
            >
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${enabled ? 'text-cyan-300' : 'text-slate-500'}`}>
                {enabled ? 'On' : 'Off'}
              </span>
              <span className={`relative w-9 h-5 rounded-full transition-colors ${enabled ? 'bg-cyan-500/80' : 'bg-slate-700'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
            </button>
          </div>

          {/* Muted banner */}
          {!enabled && (
            <div className="px-4 py-2 bg-slate-800/40 border-b border-slate-800/70 flex items-center gap-2 flex-shrink-0">
              <BellOff className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              <p className="text-[11px] text-slate-400">
                Alerts are muted. New activity is collected quietly — nothing pings until you switch alerts on.
              </p>
            </div>
          )}

          {/* List */}
          <div className="overflow-y-auto flex-1 min-h-0">
            {notifications.length === 0 ? (
              <div className="px-6 py-10 flex flex-col items-center text-center gap-3">
                <NotificationBell size={48} />
                <div>
                  <p className="text-sm font-semibold text-slate-300">You&apos;re all caught up</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Alerts land here as calculations finish, permits change status, and your team is active.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="p-1.5">
                {notifications.map((n) => {
                  const meta = kindMeta[n.kind];
                  const Icon = meta.icon;
                  return (
                    <li key={n.id}>
                      <div
                        className={`group relative flex items-start gap-3 px-3 py-2.5 rounded-xl transition-colors ${n.read ? 'hover:bg-slate-800/40' : 'bg-slate-800/30 hover:bg-slate-800/60'}`}
                      >
                        {/* Unread dot */}
                        <span className={`absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full ${n.read ? 'bg-transparent' : 'bg-cyan-400'}`} />
                        <span className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.ring}`}>
                          <Icon className={`w-4 h-4 ${meta.color}`} />
                        </span>
                        <button
                          onClick={() => openRow(n.id, n.href)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <p className={`text-sm leading-snug ${n.read ? 'text-slate-400 font-medium' : 'text-slate-100 font-semibold'}`}>
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>
                          )}
                          <p className="text-[10px] text-slate-600 mt-1">{timeAgo(n.createdAt)}</p>
                        </button>
                        {/* Row actions */}
                        <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          {!n.read && (
                            <button
                              onClick={() => markRead(n.id)}
                              className="p-1 rounded-md text-slate-500 hover:text-emerald-400 hover:bg-slate-700/50"
                              aria-label="Mark as read"
                              title="Mark as read"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => dismiss(n.id)}
                            className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-slate-700/50"
                            aria-label="Dismiss"
                            title="Dismiss"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-3 py-2 border-t border-slate-800/70 flex items-center justify-between flex-shrink-0">
              <button
                onClick={markAllRead}
                disabled={unread === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-cyan-300 hover:bg-slate-800/60 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
              >
                <Check className="w-3.5 h-3.5" /> Mark all read
              </button>
              <button
                onClick={clearAll}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear all
              </button>
            </div>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {trigger}
      {panel}
    </>
  );
}
