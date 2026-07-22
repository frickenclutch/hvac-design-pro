import { useEffect } from 'react';
import {
  X, MapPin, Phone, ExternalLink, Navigation, Star, ShoppingCart,
  ChevronRight, AlertCircle, Loader2, Shield, Truck, Globe
} from 'lucide-react';
import { useRetailerStore } from '../store/useRetailerStore';
import { getDirectionsUrl, type RetailerWithDistance } from '../utils/geolocation';
import { ECOMMERCE } from '../data/retailers';
import { SYSTEM_TYPE_OPTIONS, type SystemType } from '../../../engines/costEstimator';
import type { WholeHouseResult, DesignConditions } from '../../../engines/manualJ';

interface Props {
  wholeHouse: WholeHouseResult;
  conditions: DesignConditions;
  /** The Manual J page's PDF export handler. Invoked when the user emails a
   *  quote request so the full report is generated (downloaded) and can be
   *  attached — a mailto: link cannot carry an attachment itself. */
  onExportPdf?: () => void;
}

export default function RetailerFinderPanel({ wholeHouse, conditions, onExportPdf }: Props) {
  const store = useRetailerStore();

  // Generate the estimate on mount. Distance is driven by the project location
  // (set by the calculator before opening) — we do NOT auto-request GPS.
  useEffect(() => {
    store.generateEstimate(wholeHouse, conditions);
    // Load the org's real pricing (if any); loadPricing re-prices the estimate
    // in place when active pricing exists.
    void store.loadPricing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!store.isOpen) return null;

  const estimate = store.costEstimate;
  const loc = store.projectLocation;
  const locLabel = loc ? `${loc.city ? loc.city + ', ' : ''}${loc.state} ${loc.zip}`.trim() : null;

  return (
    <div className="fixed inset-0 z-[100] flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={store.close} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-[92vw] sm:max-w-xl h-full bg-slate-950 border-l border-slate-800/60 overflow-y-auto animate-in slide-in-from-right-5 duration-300 -webkit-overflow-scrolling-touch">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800/60 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <ShoppingCart className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Project Cost & Suppliers</h3>
              <p className="text-xs text-slate-500">
                {locLabel ? `For ${locLabel}` : 'Estimate based on your Manual J results'}
              </p>
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

          {/* ═══ No real pricing configured → how to get it ═══ */}
          {store.pricingStatus && !store.pricingStatus.hasActivePricing && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3">
              <p className="text-xs font-bold text-amber-300 mb-1 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> For real-world pricing from your chosen retailer
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Have them configure integrations on their end. In the meantime, select your desired store
                below — call, email, or visit them online. The numbers here are an industry-average budget
                estimate, not a quote.
              </p>
            </div>
          )}

          {/* ═══ Cost Estimate ═══ */}
          {estimate && (
            <section className="glass-panel rounded-2xl border border-slate-800/60 overflow-hidden">
              <div className="p-4 border-b border-slate-800/40 flex items-center gap-2 flex-wrap">
                <ShoppingCart className="w-4 h-4 text-emerald-400" />
                <h4 className="text-sm font-bold text-white">Cost Estimate</h4>
                {estimate.region.localized && estimate.region.state && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    Localized · {estimate.region.state}
                  </span>
                )}
                {estimate.hasRealPricing && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                    Your pricing
                  </span>
                )}
                <span className="ml-auto text-xs text-slate-500">{estimate.tonnage} Ton</span>
              </div>

              <div className="divide-y divide-slate-800/30">
                {estimate.lineItems.map((li, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 flex items-center gap-1.5">
                        <span className="truncate">{li.description}</span>
                        {li.sourced && (
                          <span title="Priced from your organisation’s configured pricing" className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-1 rounded">real</span>
                        )}
                      </p>
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
                  <span className="text-slate-400">Tax ({(estimate.taxRate * 100).toFixed(1)}%{estimate.region.state ? ` · ${estimate.region.state}` : ''})</span>
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

          {/* ═══ Out-of-footprint: lead with nationwide e-commerce ═══ */}
          {!store.inFootprint && (
            <EcommerceCard zip={loc?.zip} nearest={store.nearest} prominent />
          )}

          {/* ═══ Branches ═══ */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-400" />
                {store.inFootprint ? 'Nearest Howland branches' : 'Nearest branch (for reference)'}
              </h4>
              {store.locationStatus === 'requesting' ? (
                <span className="flex items-center gap-1.5 text-xs text-sky-400">
                  <Loader2 className="w-3 h-3 animate-spin" /> Locating...
                </span>
              ) : (
                <button onClick={store.requestLocation}
                  className="text-xs text-slate-500 hover:text-slate-300 font-semibold transition-colors">
                  Use my location instead
                </button>
              )}
            </div>

            {store.locationError && (
              <div className="mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                <AlertCircle className="w-3 h-3 inline mr-1" /> {store.locationError}
              </div>
            )}

            <div className="space-y-3">
              {(store.inFootprint ? store.retailers : store.retailers.slice(0, 3)).map(retailer => (
                <RetailerCard
                  key={retailer.id}
                  retailer={retailer}
                  isSelected={store.selectedRetailer?.id === retailer.id}
                  onSelect={() => store.selectRetailer(retailer)}
                />
              ))}
            </div>
          </section>

          {/* In-footprint: e-commerce as a secondary option */}
          {store.inFootprint && <EcommerceCard zip={loc?.zip} nearest={store.nearest} />}

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
                <>
                  <a href={buildMailtoLink(store.selectedRetailer, estimate, wholeHouse, locLabel)}
                    onClick={() => onExportPdf?.()}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold text-sm hover:bg-amber-500/20 transition-all">
                    <ExternalLink className="w-4 h-4" /> Email Quote Request
                  </a>
                  <p className="text-[11px] text-slate-500 leading-relaxed -mt-1">
                    Opens your email app with the load summary filled in and downloads the full
                    Manual J report (PDF) so you can attach it before sending.
                  </p>
                </>
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
    <div className={`w-full text-left rounded-xl border transition-all ${
        isSelected
          ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
          : 'bg-slate-900/50 border-slate-800/40 hover:border-slate-700/60'
      }`}>
      <button onClick={onSelect} className="w-full text-left p-4">
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
            {retailer.hours && (
              <p className="text-xs text-slate-600 mt-1">{retailer.hours}</p>
            )}
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

      {/* Quick actions — always visible */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <a href={`tel:${retailer.phone}`} onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold hover:bg-emerald-500/20 transition-all">
          <Phone className="w-3 h-3" /> {retailer.phone}
        </a>
        <a href={getDirectionsUrl(retailer)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-bold hover:bg-sky-500/20 transition-all">
          <Navigation className="w-3 h-3" /> Directions
        </a>
        {retailer.website && (
          <a href={retailer.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-bold hover:bg-amber-500/20 transition-all">
            <ExternalLink className="w-3 h-3" /> Store Page
          </a>
        )}
      </div>
    </div>
  );
}

// ── Nationwide e-commerce card ─────────────────────────────────────────────────

function EcommerceCard({ zip, nearest, prominent }: {
  zip?: string;
  nearest: RetailerWithDistance | null;
  prominent?: boolean;
}) {
  return (
    <section className={`rounded-2xl border p-5 ${
      prominent ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900/50 border-slate-800/40'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <Truck className="w-4 h-4 text-emerald-400" />
        <h4 className="text-sm font-bold text-white">
          Order Online — Ships to {zip || 'Your Job Site'}
        </h4>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed mb-4">
        {prominent
          ? `The nearest branch${nearest?.distanceMiles != null ? ` (${nearest.name.replace(/ — .*/, '')}, ~${Math.round(nearest.distanceMiles)} mi)` : ''} is outside local-delivery range — order equipment and materials online and have them shipped to your job site.`
          : 'Prefer delivery? Order online and have it shipped straight to the job site.'}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <a href={ECOMMERCE.url} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-bold text-sm hover:bg-emerald-500/25 transition-all">
          <Globe className="w-4 h-4" /> Shop Online
        </a>
        <a href={`tel:${ECOMMERCE.phone}`}
          className="flex items-center justify-center gap-2 py-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 font-bold text-sm hover:bg-sky-500/20 transition-all">
          <Phone className="w-4 h-4" /> Call to Order
        </a>
      </div>
    </section>
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
  wholeHouse: WholeHouseResult | null,
  locLabel: string | null,
): string {
  const round = (n: number | undefined) => (n != null ? Math.round(n).toLocaleString() : '—');
  const systemLabel = estimate
    ? (SYSTEM_TYPE_OPTIONS.find(o => o.value === estimate.systemType)?.label ?? estimate.systemType)
    : 'TBD';

  const subject = encodeURIComponent(
    `HVAC Project Quote Request — ${estimate?.tonnage ?? ''} Ton ${systemLabel}`.replace(/\s+/g, ' ').trim()
  );

  // Self-contained: the body carries the full load summary so the email
  // stands on its own. A mailto: link can't attach a file, so we DON'T claim
  // one — the button separately downloads the Manual J PDF to attach, and the
  // body simply offers it.
  const lines = [
    `Hello ${retailer.name.replace(/ — .*/, '')},`,
    ``,
    `I'm requesting a quote for an HVAC project sized with ACCA Manual J. Project summary:`,
    ``,
    locLabel ? `• Location: ${locLabel}` : null,
    `• System type: ${systemLabel}`,
    `• Recommended capacity: ${estimate?.tonnage ?? '—'} Ton`,
    `• Design heating load: ${round(wholeHouse?.totalHeatingBtu)} BTU/hr`,
    `• Design cooling load: ${round(wholeHouse?.totalCoolingBtu)} BTU/hr`,
    wholeHouse?.ventilationCFM != null ? `• Required ventilation: ${round(wholeHouse.ventilationCFM)} CFM` : null,
    `• Estimated budget (materials + labor): $${estimate?.lowRange?.toLocaleString() ?? '—'} – $${estimate?.highRange?.toLocaleString() ?? '—'}`,
    ``,
    `This summary was generated by HVAC DesignPro. I have the full Manual J load report (PDF) and can attach it — let me know if you'd like anything else to prepare the quote.`,
    ``,
    `Please let me know your availability. Thank you.`,
  ].filter((l): l is string => l !== null);

  const body = encodeURIComponent(lines.join('\n'));
  return `mailto:${retailer.email ?? ''}?subject=${subject}&body=${body}`;
}
