/**
 * EntityAuditModal — modal wrapper around AuditLogView that scopes to one
 * entity. Used by every "what happened to this thing?" surface:
 *
 *   - Project tile in Dashboard (entityType='project')
 *   - Member row in TeamPage (entityType='user')
 *   - Permit submission detail (entityType='permit_submission')
 *   - Anywhere else a future page wants to surface entity history
 *
 * The actual rendering, filtering, and pagination is delegated to
 * AuditLogView; this component just provides the modal chrome and the
 * pre-filled entity filter.
 */

import { useEffect } from 'react';
import { X, Activity } from 'lucide-react';
import AuditLogView from './AuditLogView';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  entityType: string;
  entityId: string;
  /** Display name shown in the modal header. Use the same denormalized
   *  label that gets written into audit_log.entity_label so the modal
   *  stays meaningful even after the entity is deleted. */
  label: string;
  /** Optional context line under the header (e.g. "Project · 123 Main St"). */
  context?: string;
}

export default function EntityAuditModal({ isOpen, onClose, entityType, entityId, label, context }: Props) {
  // Lock body scroll when modal is open — prevents the background page
  // from scrolling underneath when the user wheels inside the audit list.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Escape closes the modal — standard modal affordance.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={`Activity for ${label}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white truncate">Activity</h2>
              <p className="text-xs text-slate-500 truncate">
                {label}
                {context && <span className="text-slate-600"> · {context}</span>}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 min-w-[40px] min-h-[40px] flex items-center justify-center flex-shrink-0"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Body — AuditLogView is the engine; initialFilters scopes to entity */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <AuditLogView
            scope="tenant"
            initialFilters={{ entityType, entityId, limit: 200 }}
            compact
          />
        </div>
      </div>
    </div>
  );
}
