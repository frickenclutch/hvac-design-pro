import { useEffect, useMemo, useState } from 'react';
import { PackageSearch, Search, X, Snowflake, Flame, AlertTriangle } from 'lucide-react';
import { api, type ApiCatalogProductRow, type CatalogEquipmentType } from '../lib/api';

interface CatalogPickerModalProps {
  /** Restrict the selectable rows to these equipment types. Cooling picker
   *  passes ['ac','heat_pump']; heating picker passes the heating-capable set.
   *  The full hvac_equipment list is still fetched once and filtered here. */
  allowedTypes: CatalogEquipmentType[];
  /** What the picker is selecting — drives the title + icon. */
  mode: 'cooling' | 'heating';
  onSelect: (row: ApiCatalogProductRow) => void;
  onClose: () => void;
}

const TYPE_LABELS: Record<CatalogEquipmentType, string> = {
  ac: 'Air Conditioner',
  heat_pump: 'Heat Pump',
  furnace_gas: 'Gas Furnace',
  furnace_electric: 'Electric Furnace',
};

function capacitySummary(row: ApiCatalogProductRow): string {
  const parts: string[] = [];
  if (row.total_cooling_btu != null) {
    const sens = row.sensible_cooling_btu != null ? ` / ${row.sensible_cooling_btu.toLocaleString()}` : '';
    parts.push(`${row.total_cooling_btu.toLocaleString()}${sens} BTU cool`);
  }
  if (row.heating_btu != null) {
    parts.push(`${row.heating_btu.toLocaleString()} BTU heat`);
  }
  return parts.join('  ·  ');
}

export default function CatalogPickerModal({ allowedTypes, mode, onSelect, onClose }: CatalogPickerModalProps) {
  const [rows, setRows] = useState<ApiCatalogProductRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Fetch the org's HVAC-equipment catalog once on open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listCatalog({ category: 'hvac_equipment', activeOnly: true, limit: 200 });
        if (!cancelled) setRows(res.items);
      } catch {
        // api.ts already surfaces a toast on failure; show an inline notice too.
        if (!cancelled) { setRows([]); setError('Could not load the catalog. Check your connection and try again.'); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Client-side filter: allowed equipment types + free-text on sku/model/name.
  const filtered = useMemo(() => {
    const list = (rows ?? []).filter((r) =>
      r.equipment_type != null && allowedTypes.includes(r.equipment_type),
    );
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) =>
      r.sku.toLowerCase().includes(q) ||
      (r.model ?? '').toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.brand ?? '').toLowerCase().includes(q),
    );
  }, [rows, allowedTypes, query]);

  const Icon = mode === 'cooling' ? Snowflake : Flame;
  const accent = mode === 'cooling' ? 'text-sky-400' : 'text-orange-400';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Pick equipment from catalog"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-2xl mx-4 rounded-3xl border border-slate-700/60 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-8 pt-7 pb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
              <PackageSearch className={`w-5 h-5 ${accent}`} />
              Pick {mode === 'cooling' ? 'Cooling' : 'Heating'} Equipment
            </h2>
            <p className="text-sm text-slate-400">
              Select a catalog item to auto-fill the {mode} equipment inputs.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-500 hover:text-white transition-colors p-1.5 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-8 pb-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by SKU, model, brand, or name…"
              className="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all min-h-[44px]"
            />
          </div>
        </div>

        {/* Body */}
        <div className="px-8 pb-8 overflow-y-auto">
          {rows === null && (
            <div className="py-12 text-center text-slate-500 text-sm">Loading catalog…</div>
          )}

          {rows !== null && error && (
            <div className="glass-panel rounded-2xl border border-amber-500/20 p-5 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-200/90">{error}</p>
            </div>
          )}

          {rows !== null && !error && filtered.length === 0 && (
            <div className="glass-panel rounded-2xl border border-slate-700/60 p-6 text-center">
              <PackageSearch className="w-8 h-8 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-300 font-semibold mb-1">
                {(rows.length === 0)
                  ? 'No equipment in your catalog yet.'
                  : 'No matching equipment.'}
              </p>
              <p className="text-xs text-slate-500">
                {(rows.length === 0)
                  ? 'Add inventory via the catalog API or your ERP feed. You can still hand-type the equipment fields below.'
                  : 'Try a different search, or hand-type the equipment fields below.'}
              </p>
            </div>
          )}

          {rows !== null && !error && filtered.length > 0 && (
            <ul className="space-y-2.5">
              {filtered.map((row) => (
                <li key={row.id}>
                  <button
                    onClick={() => { onSelect(row); onClose(); }}
                    className="w-full text-left glass-panel rounded-2xl border border-slate-700/60 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all p-4 min-h-[44px]"
                  >
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <span className="text-sm font-bold text-white">{row.model || row.name}</span>
                      {row.equipment_type && (
                        <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-lg shrink-0 flex items-center gap-1">
                          <Icon className="w-3 h-3" />
                          {TYPE_LABELS[row.equipment_type]}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
                      <span className="font-mono">{row.sku}</span>
                      {row.ahri_ref && <span>AHRI {row.ahri_ref}</span>}
                      {capacitySummary(row) && <span className="text-slate-400">{capacitySummary(row)}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
