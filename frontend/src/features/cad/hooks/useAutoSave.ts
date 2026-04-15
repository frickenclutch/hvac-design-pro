import { useEffect, useRef } from 'react';
import { useCadStore } from '../store/useCadStore';
import { api } from '../../../lib/api';
import { toast } from '../../../stores/useToastStore';

export function useAutoSave() {
  const isDirty = useCadStore(s => s.isDirty);
  const isSaving = useCadStore(s => s.isSaving);
  const drawingId = useCadStore(s => s.drawingId);
  const projectId = useCadStore(s => s.projectId);
  const serializeDrawing = useCadStore(s => s.serializeDrawing);
  const markSaved = useCadStore(s => s.markSaved);
  const setSaving = useCadStore(s => s.setSaving);
  const setSaveError = useCadStore(s => s.setSaveError);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDirty || isSaving) return;

    // Clear existing timer
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      const data = serializeDrawing();

      // Always save to localStorage as fallback
      try {
        localStorage.setItem(`hvac_cad_${projectId || 'draft'}`, JSON.stringify(data));
      } catch {}

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

      try {
        if (drawingId) {
          // Update existing drawing
          await api.updateDrawing(drawingId, {
            canvasJson: data,
          });
          markSaved(drawingId);
        } else {
          // Create new drawing
          const result = await api.saveDrawing({
            projectId,
            canvasJson: data,
            name: 'Floor Plan',
          });
          markSaved(result.id);
        }
      } catch (err: any) {
        console.warn('Auto-save D1 sync failed (localStorage backup is safe):', err.message);
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

export async function loadDrawing(projectId: string): Promise<any | null> {
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
    const local = localStorage.getItem(`hvac_cad_${projectId}`);
    if (local) return { canvasJson: JSON.parse(local), id: null };
  } catch {}

  return null;
}
