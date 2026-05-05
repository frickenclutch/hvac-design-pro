/**
 * ExternalAuthorityResources — fallback panel for the SubmitForReviewModal.
 *
 * The platform authority directory is bootstrap-light by design — it only
 * contains tenants that have explicitly opted in via Settings → Authority
 * Profile. Until the network grows to broad coverage, most submitter
 * searches will return zero on-platform matches. Without a fallback, the
 * search is a dead-end. This panel turns the empty state into a funnel:
 *
 *   - Smart Google searches built from whatever inputs the submitter has
 *     (ZIP, state, county). Always works because Google handles the
 *     fuzzy matching.
 *   - Universal directories (ICC) that don't go stale.
 *   - State-level Wikipedia + .gov search shortcuts that don't require
 *     us to maintain a list of municipal URLs.
 *   - Copy-shareable invite message so the submitter can pull their AHJ
 *     onto the platform — drives organic supply-side growth.
 *
 * Deliberately uses search-URL patterns over hard-coded municipal links —
 * the URLs we'd want change too often (city websites get rebuilt, etc.),
 * but Google + Wikipedia + ICC are stable.
 */

import { useState } from 'react';
import {
  ExternalLink, Search, BookOpen, MapPin, Mail, Copy,
  ChevronDown, ChevronRight, Globe, ShieldCheck,
} from 'lucide-react';
import { toast } from '../../stores/useToastStore';

interface ExternalAuthorityResourcesProps {
  zip?: string;
  state?: string;
  county?: string;
  /** True when there are zero on-platform matches — auto-expands the panel
   *  so the submitter sees the alternatives instead of an empty page. */
  defaultOpen?: boolean;
  /** Optional context for the invite message — shown to the AHJ when they
   *  receive the invite. */
  projectAddress?: string;
}

export default function ExternalAuthorityResources({
  zip, state, county, defaultOpen = false, projectAddress,
}: ExternalAuthorityResourcesProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Build smart-search queries from whatever inputs we have. Each falls
  // back gracefully — at minimum we always have a generic "permits"
  // query so even an empty form yields useful results.
  const googleQuery = (() => {
    const parts: string[] = [];
    if (zip) parts.push(zip);
    if (county) parts.push(county);
    if (state && !county) parts.push(state);
    parts.push('building department permits');
    return parts.join(' ');
  })();
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(googleQuery)}`;

  const stateGovQuery = state
    ? `${state} state building code department permits`
    : 'state building code department permits';
  const stateGovUrl = `https://www.google.com/search?q=${encodeURIComponent(stateGovQuery)}+site:.gov`;

  const wikipediaQuery = state ? `Building code ${state}` : 'Building code United States';
  const wikipediaUrl = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(wikipediaQuery)}`;

  // ICC's directory — universal, stable. No URL parameters because
  // the site doesn't accept them; users land on the directory and
  // search there.
  const iccUrl = 'https://www.iccsafe.org/about/who-we-are/';
  const iccDirectoryUrl = 'https://www.iccsafe.org/products-and-services/icc-evaluation-service/find-an-evaluation-services-product/';

  // Invite message the submitter can copy and email/text/Slack to their AHJ.
  const inviteMessage = buildInviteMessage({ zip, state, county, projectAddress });
  const copyInvite = () => {
    navigator.clipboard.writeText(inviteMessage).then(
      () => toast.success('Invite message copied. Paste it into an email or chat to your AHJ.'),
      () => toast.error('Could not copy to clipboard.'),
    );
  };

  return (
    <section className="border-t border-slate-800/60 pt-4 mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left mb-3 hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-amber-400" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Can't find your authority on the platform?
          </h4>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
      </button>

      {open && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-500 mb-3">
            The platform's authority directory grows as municipalities sign up. While yours might not be here yet, these resources can funnel you to the right office:
          </p>

          <ResourceRow
            icon={<Search className="w-4 h-4 text-emerald-400" />}
            title={`Search the web — "${googleQuery}"`}
            subtitle="Google search using your ZIP / state / county. Most municipal building departments rank high for this query."
            href={googleUrl}
          />

          <ResourceRow
            icon={<MapPin className="w-4 h-4 text-sky-400" />}
            title={state ? `${state} state-level building authority` : "Find your state's building department"}
            subtitle={state
              ? `Filtered to .gov sites only — strips out commercial filler.`
              : `Add a State above for a more targeted search. Restricted to .gov.`}
            href={stateGovUrl}
          />

          <ResourceRow
            icon={<BookOpen className="w-4 h-4 text-violet-400" />}
            title="Wikipedia — building codes reference"
            subtitle={state ? `Pre-filled to "${wikipediaQuery}".` : 'Background on US building code adoption by state.'}
            href={wikipediaUrl}
          />

          <ResourceRow
            icon={<ShieldCheck className="w-4 h-4 text-amber-400" />}
            title="ICC — International Code Council"
            subtitle="Background on the I-Codes most US AHJs adopt. Useful when your AHJ doesn't say which code edition they enforce."
            href={iccUrl}
          />

          <ResourceRow
            icon={<ExternalLink className="w-4 h-4 text-slate-400" />}
            title="ICC Find Services Directory"
            subtitle="Cross-reference your code edition against ICC's evaluation services."
            href={iccDirectoryUrl}
          />

          <div className="rounded-xl bg-amber-500/5 border border-amber-500/30 p-3 mt-3">
            <div className="flex items-start gap-2 mb-2">
              <Mail className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h5 className="text-xs font-bold text-amber-300 mb-1">Invite your AHJ to the platform</h5>
                <p className="text-[11px] text-slate-400">
                  Once they sign up + configure their authority profile, future submissions to them flow entirely inside HVAC DesignPro. Copy this message:
                </p>
              </div>
            </div>
            <pre className="text-[10px] text-slate-400 bg-slate-950/60 border border-slate-800/40 rounded-lg p-2 mt-2 mb-2 whitespace-pre-wrap font-mono leading-relaxed max-h-40 overflow-y-auto">
{inviteMessage}
            </pre>
            <button
              onClick={copyInvite}
              className="bg-amber-500/10 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider hover:bg-amber-500/20 transition-all flex items-center gap-1.5"
            >
              <Copy className="w-3 h-3" /> Copy invite
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ResourceRow({ icon, title, subtitle, href }: {
  icon: React.ReactNode; title: string; subtitle: string; href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 px-3 py-2 rounded-xl bg-slate-900/40 border border-slate-800/40 hover:border-amber-500/30 hover:bg-amber-500/5 transition-all group"
    >
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold text-slate-200 group-hover:text-white truncate">{title}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>
      </div>
      <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-amber-400 mt-1 flex-shrink-0" />
    </a>
  );
}

function buildInviteMessage(ctx: {
  zip?: string; state?: string; county?: string; projectAddress?: string;
}): string {
  const lines: string[] = [];
  lines.push('Hello,');
  lines.push('');
  const where = ctx.county ?? ctx.state ?? ctx.zip ?? 'your jurisdiction';
  lines.push(`I'm using HVAC DesignPro for a project in ${where}${ctx.projectAddress ? ` (${ctx.projectAddress})` : ''} and would like to submit it to your office for permit review through the platform directly.`);
  lines.push('');
  lines.push('HVAC DesignPro is a cloud-based engineering platform for HVAC load calculations, duct design, and floor-plan drafting. It includes a permit-review rail that lets us send you the full project (calculations, drawings, address) without re-keying anything, and gives you a queue with claim/approve/deny/request-changes actions plus a comment thread.');
  lines.push('');
  lines.push('Sign up at https://hvac-design-pro.pages.dev/login (free during beta), then in Settings → Authority Profile pick your authority type (Building Dept, Fire Marshal, etc.), display title, and the ZIP codes / counties / states you serve. Once configured, your office shows up when submitters search the directory.');
  lines.push('');
  lines.push('No charge to receive submissions. The platform takes care of audit trails, decision tracking, and permit numbering. You can also keep using your existing intake process — the "Authority Intake Process" notes field lets you describe additional steps you require beyond the digital submission (site visits, hard-copy plans, fees, etc.) and submitters see those before they submit.');
  lines.push('');
  lines.push('Thanks,');
  return lines.join('\n');
}
