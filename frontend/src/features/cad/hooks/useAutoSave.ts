import { useEffect, useRef } from 'react';
import { useCadStore } from '../store/useCadStore';
import { api } from '../../../lib/api';
import { toast } from '../../../stores/useToastStore';
import { scopedKey } from '../../../utils/storage';

/** Capture a low-res thumbnail of the current canvas state for the
 *  version-history sidebar. Returns null on any failure — thumbnail is a
 *  nice-to-have, never block a save on it.
 *
 *  Default multiplier=0.3 brings a 1920x1200-ish workspace down to roughly
 *  570x360 pixels; PNG compresses line art aggressively so the resulting
 *  data URL is typically 8-30 KB. Worker caps inbound thumbnails at 200 KB. */
function captureCanvasThumbnail(): string | null {
  try {
    const canvas = useCadStore.getState().canvas;
    if (!canvas) return null;
    // Fabric.js Canvas.toDataURL accepts { format, quality, multiplier }.
    // multiplier scales the export (1 = native canvas pixel size).
    // multiplier is required in Fabric's TDataUrlOptions so it must be set.
    const dataUrl = canvas.toDataURL({
      format: 'png',
      multiplier: 0.3,
      enableRetinaScaling: false,
    });
    return typeof dataUrl === 'string' ? dataUrl : null;
  } catch {
    return null;
  }
}

export function useAutoSave() {
  const isDirty = useCadStore(s => s.isDirty);
  const isSaving = useCadStore(s => s.isSaving);
  const drawingId = useCadStore(s => s.drawingId);
  const projectId = useCadStore(s => s.projectId);
  // When the user is previewing a historical version, suppress auto-save
  // entirely — otherwise any incidental canvas interaction during a peek
  // would write the version's content back as the new live state. Restore
  // is an explicit operator action; preview must stay non-destructive.
  const previewMode = useCadStore(s => s.previewMode);
  const serializeDrawing = useCadStore(s => s.serializeDrawing);
  const markSaved = useCadStore(s => s.markSaved);
  const setSaving = useCadStore(s => s.setSaving);
  const setSaveError = useCadStore(s => s.setSaveError);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (previewMode) return;
    if (!isDirty || isSaving) return;

    // Clear existing timer
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      const data = serializeDrawing();

      // Always save to localStorage as fallback
      try {
        localStorage.setItem(scopedKey(`hvac_cad_${projectId || 'draft'}`), JSON.stringify(data));
      } catch { /* localStorage best-effort */ }

      // Save to D1 if we have a project backed by the database.
      // Locally-created projects (proj-*) only exist in localStorage — skip D1
      // to avoid foreign-key violations in cad_drawings → projects.
      const isLocalOnly = !projectId || projectId.startsWith('proj-') || !import.meta.env.VITE_API_BASE_URL;
      if (isLocalOnly) {
        markSaved(drawingId || 'local');
        return;
      }

      setSaving(true);
      setSaveError(null);

      // Snapshot the canvas pixel state alongside the serialized geometry.
      // Sent through with the save so the new version row gets its
      // thumbnail at write time — no second roundtrip from the version
      // modal. Returns null if anything blows up, which is harmless: the
      // version still saves, just without a visual preview.
      const thumbnailDataUrl = captureCanvasThumbnail() ?? undefined;

      try {
        if (drawingId) {
          // Update existing drawing
          await api.updateDrawing(drawingId, {
            canvasJson: data,
            thumbnailDataUrl,
          });
          markSaved(drawingId);
        } else {
          // Create new drawing
          const result = await api.saveDrawing({
            projectId,
            canvasJson: data,
            name: 'Floor Plan',
            thumbnailDataUrl,
          });
          markSaved(result.id);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('Auto-save D1 sync failed (localStorage backup is safe):', message);
        toast.warning('Cloud sync failed. Your work is saved locally.');
        // D1 save failed but localStorage already has the data — mark as saved
        // so we don't show an error or retry in an infinite loop.
        markSaved(drawingId || 'local');
      }
    }, 3000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [isDirty, isSaving, drawingId, projectId, markSaved, serializeDrawing, setSaveError, setSaving]);
}

export async function loadDrawing(projectId: string): Promise<{ canvasJson: unknown; id: string | null } | null> {
  // Only attempt D1 API when a real backend URL is configured.
  // Without it, api.ts falls back to a hardcoded Workers URL that may
  // return 401 and trigger a hard redirect to /login — breaking navigation.
  if (import.meta.env.VITE_API_BASE_URL) {
    try {
      const { drawings } = await api.listDrawings(projectId);
      if (drawings.length > 0) {
        const drawing = await api.getDrawing(drawings[0].id);
        return drawing;
      }
    } catch (err) {
      console.warn('D1 load failed, trying localStorage:', err);
    }
  }

  // Fall back to localStorage
  try {
    const local = localStorage.getItem(scopedKey(`hvac_cad_${projectId}`));
    if (local) return { canvasJson: JSON.parse(local), id: null };
  } catch { /* fall through to null */ }

  return null;
}
