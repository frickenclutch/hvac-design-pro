/**
 * SubmitForReviewModal — submitter-side flow for sending a project to a
 * permit authority for approval/review.
 *
 * Steps:
 *  1. Search authorities by ZIP, state, county, or type. Default search
 *     uses the project's address fields when available.
 *  2. Pick one. The card shows the authority's intake notes (additional
 *     process steps beyond digital submission).
 *  3. Choose a submission type, write a cover letter, submit.
 *
 * Errors handled inline (409 = duplicate open submission).
 */

import { useEffect, useState } from 'react';
import {
  ShieldCheck, Search, MapPin, Send, X, AlertTriangle,
  Building2, Phone, FileText,
} from 'lucide-react';
import { api } from '../../lib/api';
import { toast } from '../../stores/useToastStore';
import type { Project } from '../projects/projectStorage';

interface AuthorityCandidate {
  id: string; name: string; slug: string;
  authority_type: string; authority_title: string | null;
  jurisdiction_states: string | null;
  jurisdiction_counties: string | null;
  jurisdiction_zips: string | null;
  authority_intake_notes: string | null;
  city: string | null; state: string | null; zip: string | null;
  phone: string | null;
  _score: number; _matched: string[];
}

const AUTHORITY_TYPE_LABELS: Record<string, string> = {
  building_dept: 'Building Department',
  fire_marshal: 'Fire Marshal',
  zoning: 'Zoning',
  mechanical: 'Mechanical',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  environmental: 'Environmental',
  general: 'General',
};

const SUBMISSION_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'mechanical_permit', label: 'Mechanical permit' },
  { value: 'plan_review', label: 'Plan review' },
  { value: 'inspection_request', label: 'Inspection request' },
  { value: 'energy_compliance_review', label: 'Energy compliance review' },
  { value: 'permit_amendment', label: 'Permit amendment' },
  { value: 'general_inquiry', label: 'General inquiry / pre-submission' },
];

export default function SubmitForReviewModal({
  project, onClose, onSubmitted,
}: {
  project: Project;
  onClose: () => void;
  onSubmitted: (submissionId: string) => void;
}) {
  // Step 1 — search criteria, default-seeded from the project address.
  const [zip, setZip] = useState(project.zip ?? '');
  const [state, setState] = useState(project.state ?? '');
  const [county, setCounty] = useState('');
  const [type, setType] = useState('');
  const [authorities, setAuthorities] = useState<AuthorityCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  // Step 2 — selected authority
  const [selected, setSelected] = useState<AuthorityCandidate | null>(null);

  // Step 3 — cover letter + type
  const [submissionType, setSubmissionType] = useState('mechanical_permit');
  const [coverLetter, setCoverLetter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const search = async () => {
    setSearching(true);
    setSearchErr(null);
    try {
      const r = await api.permitsSearchAuthorities({
        zip: zip.trim() || undefined,
        state: state.trim() || undefined,
        county: county.trim() || undefined,
        type: type || undefined,
      });
      setAuthorities(r.authorities);
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  // Auto-search on mount when we have at least a ZIP.
  useEffect(() => {
    if (zip.trim()) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!selected) return;
    if (coverLetter.trim().length < 10) {
      setSubmitErr('Write at least a brief cover letter (≥ 10 chars) so the authority knows what they\'re reviewing.');
      return;
    }
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const r = await api.permitSubmit({
        projectId: project.id,
        authorityOrgId: selected.id,
        submissionType,
        coverLetter: coverLetter.trim(),
      });
      toast.success(`Submitted to ${selected.name}.`);
      onSubmitted(r.id);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-panel rounded-2xl border border-amber-500/30 max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-md border-b border-slate-800/60 p-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-white">Submit for Review</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-xs text-slate-400">
            Submitting <span className="font-semibold text-slate-200">{project.name}</span> to a permit authority gives them full visibility into your project (calculations, drawings, address) for the duration of the review. Withdraw at any time.
          </p>

          {/* Step 1 — Search */}
          <section>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
              <Search className="w-3 h-3" /> 1. Find a permit authority
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <input
                value={zip} onChange={(e) => setZip(e.target.value)}
                placeholder="ZIP" maxLength={5}
                className="bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
              <input
                value={state} onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
                placeholder="State" maxLength={2}
                className="bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
              <input
                value={county} onChange={(e) => setCounty(e.target.value)}
                placeholder="County, ST"
                className="bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
              <select
                value={type} onChange={(e) => setType(e.target.value)}
                className="bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-slate-200"
              >
                <option value="">Any type</option>
                {Object.entries(AUTHORITY_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <button
              onClick={search}
              disabled={searching}
              className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-amber-500/20 transition-all disabled:opacity-50"
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
            {searchErr && (
              <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                <AlertTriangle className="w-4 h-4" /> {searchErr}
              </div>
            )}
          </section>

          {/* Search results */}
          {authorities.length > 0 && (
            <section>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Results ({authorities.length})</h4>
              <div className="space-y-2">
                {authorities.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelected(a)}
                    className={`w-full text-left rounded-xl border p-3 transition-all ${selected?.id === a.id
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-slate-800/60 bg-slate-900/40 hover:border-amber-500/30 hover:bg-amber-500/5'}`}
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-white text-sm flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                          {a.name}
                        </div>
                        {a.authority_title && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{a.authority_title}</div>
                        )}
                      </div>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 flex-shrink-0">
                        {AUTHORITY_TYPE_LABELS[a.authority_type] ?? a.authority_type}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap mt-1">
                      {[a.city, a.state, a.zip].filter(Boolean).length > 0 && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {[a.city, a.state, a.zip].filter(Boolean).join(', ')}
                        </span>
                      )}
                      {a.phone && (
                        <span className="flex items-center gap-1 font-mono">
                          <Phone className="w-3 h-3" /> {a.phone}
                        </span>
                      )}
                      {a._matched && a._matched.length > 0 && (
                        <span className="text-emerald-400 font-mono text-[10px]">
                          ✓ {a._matched.join(' · ')}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {!searching && authorities.length === 0 && (zip || state || county) && (
            <p className="text-xs text-slate-500 italic">
              No authorities matched these criteria. Try broadening — search just by state, or browse by type.
            </p>
          )}

          {/* Step 2/3 — Selected authority + submission form */}
          {selected && (
            <section className="border-t border-slate-800/60 pt-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> 2. Submission details
              </h4>

              {selected.authority_intake_notes && (
                <div className="p-3 mb-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold mb-1">
                    Authority intake process — additional steps
                  </div>
                  <p className="text-xs text-slate-400 whitespace-pre-wrap">{selected.authority_intake_notes}</p>
                </div>
              )}

              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Submission type
              </label>
              <select
                value={submissionType}
                onChange={(e) => setSubmissionType(e.target.value)}
                className="w-full mb-3 bg-slate-900/60 border border-slate-700/50 rounded-xl py-2 px-3 text-sm text-slate-200"
              >
                {SUBMISSION_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Cover letter
              </label>
              <textarea
                value={coverLetter}
                onChange={(e) => setCoverLetter(e.target.value)}
                placeholder="Describe what's being submitted, what approval you're seeking, any context the reviewer should know up front…"
                rows={5}
                className="w-full bg-slate-900/60 border border-slate-700/50 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/40 resize-y mb-3"
              />

              {submitErr && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {submitErr}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] text-slate-600">{coverLetter.length} / 5000</span>
                <div className="flex items-center gap-2">
                  <button onClick={onClose} className="text-slate-400 hover:text-white px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-slate-800 transition-all">
                    Cancel
                  </button>
                  <button
                    onClick={submit}
                    disabled={submitting || coverLetter.trim().length < 10}
                    className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-amber-500/20 transition-all disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" /> {submitting ? 'Submitting…' : `Submit to ${selected.name}`}
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
