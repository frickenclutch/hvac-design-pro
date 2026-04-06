import { useEffect } from 'react';
import {
  X, MapPin, Phone, ExternalLink, Navigation, Star, ShoppingCart,
  ChevronRight, AlertCircle, Loader2, Shield
} from 'lucide-react';
import { useRetailerStore } from '../store/useRetailerStore';
import { getDirectionsUrl, type RetailerWithDistance } from '../utils/geolocation';
import { SYSTEM_TYPE_OPTIONS, type SystemType } from '../../../engines/costEstimator';
import type { WholeHouseResult, DesignConditions } from '../../../engines/manualJ';

interface Props {
  wholeHouse: WholeHouseResult;
  conditions: DesignConditions;
}

export default function RetailerFinderPanel({ wholeHouse, conditions }: Props) {
  const store = useRetailerStore();

  // Request location + generate estimate on mount
  useEffect(() => {
    store.generateEstimate(wholeHouse, conditions);
    if (store.locationStatus === 'idle') {
      store.requestLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!store.isOpen) return null;

  const estimate = store.costEstimate;

  return (
    <div className="fixed inset-0 z-[100] flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={store.close} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-xl h-full bg-slate-950 border-l border-slate-800/60 overflow-y-auto animate-in slide-in-from-right-5 duration-300">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800/60 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <ShoppingCart className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Project Cost & Retailers</h3>
              <p className="text-xs text-slate-500">Estimate based on your Manual J results</p>
            </div>
          </div>
          <button onClick={store.close}
            className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">

          {/* ═══ System Type Selector ═══ */}
          <section>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              System Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SYSTEM_TYPE_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => store.setSystemType(opt.value as SystemType)}
                  className={`py-2.5 px-3 rounded-xl border text-sm font-bold transition-all ${
                    store.systemType === opt.value
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                      : 'bg-slate-900 border-slate-700/50 text-slate-500 hover:border-slate-600'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* ═══ Cost Estimate ═══ */}
          {estimate && (
            <section className="glass-panel rounded-2xl border border-slate-800/60 overflow-hidden">
              <div className="p-4 border-b border-slate-800/40 flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-emerald-400" />
                <h4 className="text-sm font-bold text-white">Cost Estimate</h4>
                <span className="ml-auto text-xs text-slate-500">{estimate.tonnage} Ton</span>
              </div>

              <div className="divide-y divide-slate-800/30">
                {estimate.lineItems.map((li, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 truncate">{li.description}</p>
                      <p className="text-xs text-slate-500">
                        {li.quantity > 1 ? `${li.quantity} × $${li.unitCost.toLocaleString()}` : categoryLabel(li.category)}
                      </p>
                    </div>
                    <p className="text-sm font-mono font-bold text-white ml-4">
                      ${li.totalCost.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-slate-800/30 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Subtotal</span>
                  <span className="text-white font-mono">${estimate.subtotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Tax ({(estimate.taxRate * 100).toFixed(0)}%)</span>
                  <span className="text-white font-mono">${estimate.tax.toLocaleString()}</span>
                </div>
                <div className="h-px bg-slate-700/50" />
                <div className="flex justify-between text-lg font-bold">
                  <span className="text-white">Total</span>
                  <span className="text-emerald-400 font-mono">${estimate.total.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Typical Range</span>
                  <span className="font-mono">
                    ${estimate.lowRange.toLocaleString()} — ${estimate.highRange.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="px-4 py-3 bg-amber-500/5 border-t border-amber-500/20">
                <p className="text-xs text-amber-300/80 leading-relaxed">
                  <AlertCircle className="w-3 h-3 inline mr-1 relative -top-px" />
                  {estimate.disclaimer}
                </p>
              </div>
            </section>
          )}

          {/* ═══ Nearest Retailers ═══ */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-400" />
                Nearest HVAC Supply
              </h4>
              {store.locationStatus === 'requesting' && (
                <span className="flex items-center gap-1.5 text-xs text-sky-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Locating...
                </span>
              )}
              {store.locationStatus === 'denied' && (
                <button onClick={store.requestLocation}
                  className="text-xs text-amber-400 hover:text-amber-300 font-bold transition-colors">
                  Retry Location
                </button>
              )}
            </div>

            {store.locationError && (
              <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300">
                <AlertCircle className="w-3 h-3 inline mr-1" /> {store.locationError}
              </div>
            )}

            <div className="space-y-3">
              {store.retailers.map(retailer => (
                <RetailerCard
                  key={retailer.id}
                  retailer={retailer}
                  isSelected={store.selectedRetailer?.id === retailer.id}
                  onSelect={() => store.selectRetailer(retailer)}
                />
              ))}
            </div>
          </section>

          {/* ═══ Selected Retailer Actions ═══ */}
          {store.selectedRetailer && (
            <section className="glass-panel rounded-2xl border border-emerald-500/20 p-5 space-y-4">
              <div className="flex items-center gap-2">
                {store.selectedRetailer.preferred && <Star className="w-4 h-4 text-amber-400 fill-amber-400" />}
                <h4 className="text-sm font-bold text-white">
                  Request Quote from {store.selectedRetailer.name}
                </h4>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Contact this retailer with your project details and cost estimate.
                They can provide exact pricing for your specific equipment and installation needs.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <a href={`tel:${store.selectedRetailer.phone}`}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-sm hover:bg-emerald-500/20 transition-all">
                  <Phone className="w-4 h-4" /> Call
                </a>
                <a href={getDirectionsUrl(store.selectedRetailer)} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 font-bold text-sm hover:bg-sky-500/20 transition-all">
                  <Navigation className="w-4 h-4" /> Directions
                </a>
              </div>

              {store.selectedRetailer.email && (
                <a href={buildMailtoLink(store.selectedRetailer, estimate)}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-sm hover:bg-amber-500/20 transition-all">
                  <ExternalLink className="w-4 h-4" /> Email Quote Request
                </a>
              )}

              {store.selectedRetailer.website && (
                <a href={store.selectedRetailer.website} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-slate-400 text-xs font-semibold hover:text-white transition-colors">
                  <ExternalLink className="w-3 h-3" /> Visit Website
                </a>
              )}
            </section>
          )}

          {/* Powered By */}
          <div className="text-center py-4">
            <p className="text-xs text-slate-600">
              <Shield className="w-3 h-3 inline mr-1" />
              Preferred partner network powered by C4 Technologies
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Retailer Card ────────────────────────────────────────────────────────────

function RetailerCard({ retailer, isSelected, onSelect }: {
  retailer: RetailerWithDistance;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button onClick={onSelect}
      className={`w-full text-left p-4 rounded-xl border transition-all ${
        isSelected
          ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
          : 'bg-slate-900/50 border-slate-800/40 hover:border-slate-700/60'
      }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {retailer.preferred && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                <Star className="w-2.5 h-2.5 fill-current" /> Preferred
              </span>
            )}
            <h5 className="text-sm font-bold text-white truncate">{retailer.name}</h5>
          </div>
          <p className="text-xs text-slate-400">
            {retailer.address.line1}, {retailer.address.city}, {retailer.address.state} {retailer.address.zip}
          </p>
          {retailer.description && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{retailer.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Phone className="w-3 h-3" /> {retailer.phone}
            </span>
            {retailer.hours && (
              <span className="text-xs text-slate-600">{retailer.hours}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          {retailer.distanceMiles !== null ? (
            <span className="text-sm font-bold text-emerald-400 font-mono">
              {retailer.distanceMiles} mi
            </span>
          ) : (
            <span className="text-xs text-slate-600">—</span>
          )}
          <ChevronRight className={`w-4 h-4 transition-colors ${isSelected ? 'text-emerald-400' : 'text-slate-700'}`} />
        </div>
      </div>
    </button>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    equipment: 'Equipment',
    ductwork: 'Ductwork',
    controls: 'Controls',
    labor: 'Labor',
    permits: 'Permits',
    misc: 'Materials',
  };
  return labels[cat] ?? cat;
}

function buildMailtoLink(
  retailer: RetailerWithDistance,
  estimate: import('../../../engines/costEstimator').CostEstimate | null,
): string {
  const subject = encodeURIComponent(
    `HVAC Project Quote Request — ${estimate?.tonnage ?? ''} Ton System`
  );
  const body = encodeURIComponent(
    `Hello ${retailer.name},\n\n` +
    `I'm requesting a quote for an HVAC project. My estimated system requirements:\n\n` +
    `• System Type: ${estimate?.systemType ?? 'TBD'}\n` +
    `• Tonnage: ${estimate?.tonnage ?? 'TBD'} Ton\n` +
    `• Estimated Budget: $${estimate?.lowRange?.toLocaleString() ?? '—'} – $${estimate?.highRange?.toLocaleString() ?? '—'}\n\n` +
    `This estimate was generated by HVAC DesignPro. I've attached the full Manual J report for your review.\n\n` +
    `Please let me know your availability for a detailed quote.\n\nThank you.`
  );
  return `mailto:${retailer.email ?? ''}?subject=${subject}&body=${body}`;
}
