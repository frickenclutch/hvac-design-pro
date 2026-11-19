import { useCallback, useEffect, useRef } from 'react';

/**
 * Auto-save for project-scoped calculator inputs that only fires for changes
 * the user actually made.
 *
 * Two failure modes this replaces:
 *
 *  1. Saving on open. The pages re-set their state when they load, which looked
 *     like a change and wrote the placeholder room / default conditions to
 *     storage. Downstream tools (Manual D import, /reports) then treated those
 *     placeholders as the project's real data.
 *
 *  2. Saving one project's inputs under another's key. On a project switch the
 *     render that first sees the new project id still holds the OLD project's
 *     state; saving in that render wrote it under the new id. Where the save
 *     effect ran before the reload effect (AED), the new project's saved inputs
 *     were permanently replaced.
 *
 * `stateProjectId` is the project the in-memory `value` was loaded for — keep it
 * in React state and set it in the same update that loads a project's data, so
 * it lags `projectId` by exactly the stale render. Nothing is saved while the
 * two differ. `rebaseline` records what was just loaded so that the load itself
 * is not mistaken for an edit.
 */
export function useProjectAutosave<T>(
  projectId: string | null,
  stateProjectId: string | null,
  value: T,
  onUserChange: (value: T) => void,
): (loaded: T) => void {
  const snapshot = JSON.stringify(value);
  const baseline = useRef<string | null>(null);
  const latest = useRef({ value, onUserChange });

  useEffect(() => {
    latest.current = { value, onUserChange };
  });

  useEffect(() => {
    if (stateProjectId !== projectId) return;
    if (baseline.current === null) {
      baseline.current = snapshot; // first run: whatever is on screen is the starting point
      return;
    }
    if (snapshot === baseline.current) return;
    baseline.current = snapshot;
    latest.current.onUserChange(latest.current.value);
  }, [snapshot, projectId, stateProjectId]);

  return useCallback((loaded: T) => {
    baseline.current = JSON.stringify(loaded);
  }, []);
}
