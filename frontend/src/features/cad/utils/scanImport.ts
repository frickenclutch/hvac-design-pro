import { useCadStore } from '../store/useCadStore';
import { useProjectStore } from '../../../stores/useProjectStore';
import { toast } from '../../../stores/useToastStore';
import { api } from '../../../lib/api';
import { parseRoomPlanJson, ROOM_SCAN_ENGINE_VERSION } from '../../../engines/roomScan';

// LiDAR scan intake — the non-React front half of the flow (same layer as
// underlayImport.ts): read the file, parse it with the pure engine, record the
// capture server-side when there's a project to record it under, then hand the
// review to BlueprintDialogs via the ephemeral store request.
//
// Ordering is deliberate: PARSE FIRST, upload second. A file that isn't a
// RoomPlan capture never leaves the machine, and the server record is born
// 'parsed' with the summary in the same request. Offline-first: an upload
// failure downgrades to a warning and the review proceeds — the geometry is
// the user's either way; only the server audit record is conditional.

export async function importScanFile(file: File): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    toast.error(`${file.name} is not a JSON file. Export the scan as RoomPlan JSON (Polycam, magicplan, or any RoomPlan-based app).`);
    return;
  }
  const model = parseRoomPlanJson(raw);
  if (!model) {
    toast.error(`Couldn't read a RoomPlan capture from ${file.name} — no walls found. Make sure the export is RoomPlan JSON, not a mesh or floor-plan image.`);
    return;
  }

  let captureId: string | null = null;
  const projectId = useProjectStore.getState().activeProjectId;
  if (projectId) {
    try {
      const row = await api.uploadScan(file, projectId, {
        source: 'roomplan_json',
        parsedSummary: JSON.stringify({
          rooms: model.rooms.length,
          walls: model.walls.length,
          openings: model.openings.length,
          ceilingHeightFt: model.ceilingHeightFt,
          warnings: model.warnings.length,
        }),
        engineVersion: ROOM_SCAN_ENGINE_VERSION,
      });
      captureId = row.id;
    } catch {
      toast.warning('Scan parsed locally — the server capture record could not be created (offline?). The import continues; provenance will show the scan without a server link.');
    }
  } else {
    toast.warning('Draft mode — the scan imports locally only. Select a project first if you want the capture recorded.');
  }

  useCadStore.getState().setScanImportRequest({ fileName: file.name, model, captureId });
}
