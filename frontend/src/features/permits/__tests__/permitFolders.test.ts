/**
 * Permit queue taxonomy — deterministic guard on the (status × direction ×
 * role) → folder mapping that a code-enforcement officer navigates by. If the
 * rail ever mis-files a submission (e.g. a new permit not landing in Inbox, or
 * a revoked permit showing as active), an officer could miss a required action
 * on a legally-binding decision — so the rules are locked here rather than left
 * to the live UI alone.
 */

import { describe, it, expect } from 'vitest';
import {
  folderIdFor,
  buildPermitFolders,
  permitDirection,
  type PermitFolderInput,
  type PermitViewer,
} from '../permitFolders';

const ME = 'org-me';
const OTHER = 'org-other';

/** Build a submission with an explicit direction relative to `ME`. */
function mk(
  status: string,
  direction: 'incoming' | 'outgoing' | 'self',
): PermitFolderInput {
  if (direction === 'incoming') return { status, authority_org_id: ME, submitter_org_id: OTHER };
  if (direction === 'outgoing') return { status, authority_org_id: OTHER, submitter_org_id: ME };
  return { status, authority_org_id: ME, submitter_org_id: ME }; // self
}

const AUTHORITY: PermitViewer = { isAuthority: true, myOrgId: ME };
const SUBMITTER: PermitViewer = { isAuthority: false, myOrgId: ME };

describe('folderIdFor — authority view (incoming queue)', () => {
  const cases: Array<[string, string]> = [
    ['submitted', 'inbox'],
    ['under_review', 'in-review'],
    ['changes_requested', 'in-review'],
    ['approved', 'active'],
    ['suspended', 'active'],
    ['denied', 'closed'],
    ['withdrawn', 'closed'],
    ['expired', 'closed'],
    ['revoked', 'closed'],
  ];
  it.each(cases)('incoming %s → %s', (status, expected) => {
    expect(folderIdFor(mk(status, 'incoming'), AUTHORITY)).toBe(expected);
  });

  it('routes an unrecognised incoming status to closed rather than dropping it', () => {
    expect(folderIdFor(mk('some_future_status', 'incoming'), AUTHORITY)).toBe('closed');
  });

  it('routes the authority’s own outgoing applications to sent', () => {
    expect(folderIdFor(mk('submitted', 'outgoing'), AUTHORITY)).toBe('sent');
    expect(folderIdFor(mk('approved', 'outgoing'), AUTHORITY)).toBe('sent');
  });

  it('treats a self-submission as incoming (review folders win over sent)', () => {
    expect(folderIdFor(mk('approved', 'self'), AUTHORITY)).toBe('active');
    expect(folderIdFor(mk('submitted', 'self'), AUTHORITY)).toBe('inbox');
  });
});

describe('folderIdFor — submitter view (all outgoing)', () => {
  const cases: Array<[string, string]> = [
    ['submitted', 'active'],
    ['under_review', 'active'],
    ['changes_requested', 'active'],
    ['approved', 'approved'],
    ['suspended', 'approved'],
    ['denied', 'closed'],
    ['withdrawn', 'closed'],
    ['expired', 'closed'],
    ['revoked', 'closed'],
  ];
  it.each(cases)('%s → %s', (status, expected) => {
    expect(folderIdFor(mk(status, 'outgoing'), SUBMITTER)).toBe(expected);
  });
});

describe('buildPermitFolders — registry shape', () => {
  it('authority gets the six actionability folders in order', () => {
    expect(buildPermitFolders(AUTHORITY).map((f) => f.id)).toEqual([
      'inbox', 'in-review', 'active', 'closed', 'sent', 'all',
    ]);
  });

  it('submitter gets the four outgoing folders in order', () => {
    expect(buildPermitFolders(SUBMITTER).map((f) => f.id)).toEqual([
      'active', 'approved', 'closed', 'all',
    ]);
  });

  it('the "all" folder matches every submission', () => {
    const all = buildPermitFolders(AUTHORITY).find((f) => f.id === 'all')!;
    expect(all.match(mk('denied', 'incoming'))).toBe(true);
    expect(all.match(mk('submitted', 'outgoing'))).toBe(true);
  });
});

describe('folder counts partition the queue', () => {
  // A mixed queue: every row must land in exactly one PRIMARY folder, so the
  // primary-folder counts sum to the total and "all" equals the total.
  const queue: PermitFolderInput[] = [
    mk('submitted', 'incoming'),
    mk('under_review', 'incoming'),
    mk('changes_requested', 'incoming'),
    mk('approved', 'incoming'),
    mk('suspended', 'incoming'),
    mk('denied', 'incoming'),
    mk('withdrawn', 'incoming'),
    mk('expired', 'incoming'),
    mk('revoked', 'incoming'),
    mk('submitted', 'outgoing'),
    mk('approved', 'outgoing'),
  ];

  it('authority primary folders are mutually exclusive and complete', () => {
    const folders = buildPermitFolders(AUTHORITY);
    const primary = folders.filter((f) => f.id !== 'all');
    const all = folders.find((f) => f.id === 'all')!;

    const primarySum = primary.reduce((n, f) => n + queue.filter(f.match).length, 0);
    expect(primarySum).toBe(queue.length);
    expect(queue.filter(all.match).length).toBe(queue.length);

    // No row is double-counted across primary folders.
    for (const s of queue) {
      const hits = primary.filter((f) => f.match(s)).length;
      expect(hits).toBe(1);
    }
  });

  it('surfaces the expected headline counts', () => {
    const folders = buildPermitFolders(AUTHORITY);
    const count = (id: string) => queue.filter(folders.find((f) => f.id === id)!.match).length;
    expect(count('inbox')).toBe(1);       // one incoming submitted
    expect(count('in-review')).toBe(2);   // under_review + changes_requested
    expect(count('active')).toBe(2);      // approved + suspended (incoming)
    expect(count('closed')).toBe(4);      // denied/withdrawn/expired/revoked
    expect(count('sent')).toBe(2);        // two outgoing
  });
});

describe('permitDirection', () => {
  it('classifies incoming / outgoing / other', () => {
    expect(permitDirection(mk('submitted', 'incoming'), AUTHORITY)).toBe('incoming');
    expect(permitDirection(mk('submitted', 'outgoing'), AUTHORITY)).toBe('outgoing');
    expect(permitDirection({ status: 'submitted', authority_org_id: OTHER, submitter_org_id: OTHER }, AUTHORITY)).toBe('other');
  });
});
