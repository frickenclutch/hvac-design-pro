import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Settings, LogOut, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../features/auth/store/useAuthStore';

interface UserAvatarMenuProps {
  /** px size of the avatar circle */
  size?: number;
  /** Show the user name + chevron next to the avatar */
  showName?: boolean;
  /** Compact mode for collapsed sidebar — tooltip instead of dropdown name header */
  compact?: boolean;
  /** Dropdown opens upward (for sidebar bottom placement) */
  dropUp?: boolean;
  /** Horizontal alignment of dropdown relative to trigger */
  align?: 'left' | 'right';
  /** Additional CSS classes on the wrapper */
  className?: string;
}

export default function UserAvatarMenu({
  size = 36,
  showName = false,
  compact = false,
  dropUp = false,
  align = 'right',
  className = '',
}: UserAvatarMenuProps) {
  const { user, organisation, logout } = useAuthStore();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Calculate dropdown position relative to trigger
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownWidth = 256; // w-64
    const gap = 8;

    let top: number;
    if (dropUp) {
      // Position above the trigger; we'll adjust after measuring the dropdown
      top = rect.top - gap;
    } else {
      top = rect.bottom + gap;
    }

    let left: number;
    if (align === 'left') {
      left = rect.left;
    } else {
      left = rect.right - dropdownWidth;
    }

    // Clamp horizontal: don't overflow left edge
    if (left < 8) left = 8;
    // Don't overflow right edge
    if (left + dropdownWidth > window.innerWidth - 8) {
      left = window.innerWidth - dropdownWidth - 8;
    }

    setPos({ top, left });
  }, [dropUp, align]);

  // Recalc on open and on scroll/resize
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

  // After dropdown renders, adjust if dropUp so it sits above trigger
  useEffect(() => {
    if (!open || !dropUp || !dropdownRef.current || !triggerRef.current) return;
    const dropdownHeight = dropdownRef.current.offsetHeight;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    let top = rect.top - dropdownHeight - gap;
    // Clamp: don't go above viewport
    if (top < 8) top = 8;
    setPos((prev) => ({ ...prev, top }));
  }, [open, dropUp]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
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

  if (!user) return null;

  const initials = `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() || '?';
  const fullName = `${user.firstName} ${user.lastName}`.trim();

  const dropdown = open
    ? createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[9999] w-64 rounded-xl border border-slate-700/60 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          style={{
            top: pos.top,
            left: pos.left,
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          {/* User info header */}
          <div className="px-4 py-3 border-b border-slate-800/60">
            <p className="text-sm font-bold text-white truncate">{fullName}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
            {organisation && (
              <p className="text-[10px] text-emerald-400/70 font-medium mt-1 truncate">{organisation.name}</p>
            )}
          </div>

          {/* Menu items */}
          <div className="p-1.5">
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-300 hover:bg-slate-800/60 hover:text-white transition-colors text-sm"
            >
              <Settings className="w-4 h-4 text-slate-500" />
              <span className="font-medium">Settings</span>
            </Link>
            <button
              onClick={() => { setOpen(false); logout(); }}
              className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" />
              <span className="font-medium">Sign Out</span>
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`relative ${className}`}>
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 rounded-full transition-all hover:ring-2 hover:ring-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 ${open ? 'ring-2 ring-emerald-500/50' : ''}`}
        aria-label="User menu"
        title={compact ? fullName : undefined}
      >
        <div
          className="flex items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold select-none border border-emerald-500/30 flex-shrink-0"
          style={{ width: size, height: size, fontSize: size * 0.38 }}
        >
          {initials}
        </div>
        {showName && (
          <>
            <span className="text-sm font-medium text-slate-200 truncate max-w-[120px]">{user.firstName}</span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {dropdown}
    </div>
  );
}
