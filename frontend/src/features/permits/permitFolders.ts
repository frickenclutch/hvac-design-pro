/**
 * Permit queue taxonomy — the pure, framework-free rules that decide which
 * "actionability folder" a submission belongs to in the Permits rail.
 *
 * This is the code-enforcement-critical part of the Permits master-detail
 * surface: an officer navigates their queue by these folders, so the mapping
 * from (status × direction × role) → folder must be exact and stable. Kept
 * React-free and exported so it's unit-tested deterministically
 * (`__tests__/permitFolders.test.ts`) rather than only exercised through the
 * live UI. The page (`pages/PermitsPage.tsx`) supplies icons / subtitles /
 * counts on top of this data.
 *
 * Direction (per the Worker's visibility rules):
 *   incoming  — caller's org is the reviewing authority (authority_org_id === myOrgId)
 *   outgoing  — caller's org submitted it                (submitter_org_id === myOrgId)
 * An authority sees both; a plain submitter only ever sees outgoing rows.
 */

/** Minimal shape the folder rules need — satisfied by the page's
 *  `ListedSubmission` and by test fixtures alike. */
export interface PermitFolderInput {
  status: string;
  submitter_org_id: string;
  authority_org_id: string;
}

export interface PermitViewer {
  /** user.isPermitAuthority — gates the incoming-queue folders. */
  isAuthority: boolean;
  /** organisation.id — the "me" both direction checks compare against. */
  myOrgId: string | null | undefined;
}

export interface PermitFolder {
  id: string;
  title: string;
  /** Whether a submission belongs in this folder. `all` matches everything. */
  match: (s: PermitFolderInput) => boolean;
}

// Workflow status groups. Every real status maps into exactly one group; an
// unrecognised status falls through to the "closed/terminal" bucket so it is
// never silently dropped from the queue.
export const NEW_STATUSES = ['submitted'] as const;
export const REVIEWING_STATUSES = ['under_review', 'changes_requested'] as const;
export const ACTIVE_STATUSES = ['approved', 'suspended'] as const;
export const CLOSED_STATUSES = ['denied', 'withdrawn', 'expired', 'revoked'] as const;

const inGroup = (group: readonly string[], status: string) => group.includes(status);

const isIncoming = (s: PermitFolderInput, myOrgId: string | null | undefined) =>
  !!myOrgId && s.authority_org_id === myOrgId;
const isOutgoing = (s: PermitFolderInput, myOrgId: string | null | undefined) =>
  !!myOrgId && s.submitter_org_id === myOrgId;

/**
 * The single PRIMARY folder a submission lands in (never `all`). Mutually
 * exclusive across the primary folders, so folder counts partition the queue.
 *
 * Authority (incoming rows drive the review queue; own outgoing → Sent):
 *   submitted                          → inbox
 *   under_review / changes_requested   → in-review
 *   approved / suspended               → active
 *   denied/withdrawn/expired/revoked   → closed
 *   outgoing (submitted by me)         → sent
 * `isIncoming` is checked first, so a self-submission (both sides === me)
 * shows in the review folders, not Sent.
 *
 * Submitter (all rows are outgoing):
 *   submitted / under_review / changes_requested → active   (in-flight)
 *   approved / suspended                          → approved
 *   terminal                                      → closed
 */
export function folderIdFor(s: PermitFolderInput, viewer: PermitViewer): string {
  const { isAuthority, myOrgId } = viewer;

  if (isAuthority && isIncoming(s, myOrgId)) {
    if (inGroup(NEW_STATUSES, s.status)) return 'inbox';
    if (inGroup(REVIEWING_STATUSES, s.status)) return 'in-review';
    if (inGroup(ACTIVE_STATUSES, s.status)) return 'active';
    return 'closed';
  }
  if (isAuthority) {
    // Not incoming → the authority's own outgoing application (or, defensively,
    // a row where neither side matched — bucket it visibly rather than hide it).
    return 'sent';
  }

  // Submitter view.
  if (inGroup(NEW_STATUSES, s.status) || inGroup(REVIEWING_STATUSES, s.status)) return 'active';
  if (inGroup(ACTIVE_STATUSES, s.status)) return 'approved';
  return 'closed';
}

/**
 * Ordered folder registry for a viewer. Each folder's `match` is defined in
 * terms of `folderIdFor`, so the rail and the tested assignment can never
 * drift apart. `all` is the catch-all lens.
 */
export function buildPermitFolders(viewer: PermitViewer): PermitFolder[] {
  const belongs = (id: string) => (s: PermitFolderInput) => folderIdFor(s, viewer) === id;

  if (viewer.isAuthority) {
    return [
      { id: 'inbox', title: 'Inbox', match: belongs('inbox') },
      { id: 'in-review', title: 'In review', match: belongs('in-review') },
      { id: 'active', title: 'Active permits', match: belongs('active') },
      { id: 'closed', title: 'Closed', match: belongs('closed') },
      { id: 'sent', title: 'Sent', match: belongs('sent') },
      { id: 'all', title: 'All', match: () => true },
    ];
  }
  return [
    { id: 'active', title: 'Active', match: belongs('active') },
    { id: 'approved', title: 'Approved', match: belongs('approved') },
    { id: 'closed', title: 'Closed', match: belongs('closed') },
    { id: 'all', title: 'All', match: () => true },
  ];
}

/** Convenience for callers that also want direction info (unused by the rail
 *  today, but keeps `isOutgoing` part of the module's tested surface). */
export function permitDirection(s: PermitFolderInput, viewer: PermitViewer): 'incoming' | 'outgoing' | 'other' {
  if (isIncoming(s, viewer.myOrgId)) return 'incoming';
  if (isOutgoing(s, viewer.myOrgId)) return 'outgoing';
  return 'other';
}
