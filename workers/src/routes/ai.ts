import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { setAudit } from '../middleware/audit';

interface Env {
  DB: D1Database;
  /** Anthropic API key — set via `wrangler secret put ANTHROPIC_API_KEY`.
   *  Unset → the Logarithmic Extraction endpoints return 503 (feature not configured)
   *  rather than failing opaquely. */
  ANTHROPIC_API_KEY?: string;
}

export const aiRoutes = new Hono<{ Bindings: Env }>();

// Rasterized blueprint pages arrive as base64 data URLs. 10M chars of base64
// ≈ 7.5MB decoded — comfortably above our 2400px PNG rasters, well below
// Claude's per-image limits. Plan sets often span several sheets, so the
// endpoint accepts up to 6 images in one request and asks the model to merge
// them into a single deduplicated room schedule.
const MAX_IMAGE_B64_CHARS = 10_000_000;
const MAX_IMAGES = 6;
const MAX_TOTAL_B64_CHARS = 24_000_000;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

// What the model must return. Kept deliberately review-oriented: everything
// is a PROPOSAL that a human confirms in the UI before it becomes calc input
// (ACCA prohibits silently defaulting engineering inputs).
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    buildingType: {
      type: 'string',
      enum: ['residential', 'commercial', 'unknown'],
      description: 'Occupancy class visible on the plan. Commercial/assembly buildings are NOT valid Manual J targets — the UI warns the user.',
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Room label as printed on the plan' },
          lengthFt: { type: 'number', description: 'Longer plan dimension in feet, from printed dimension strings when available' },
          widthFt: { type: 'number', description: 'Shorter plan dimension in feet' },
          ceilingHeightFt: { type: 'number', description: 'Only when printed on the plan; omit otherwise' },
          windowCount: { type: 'number', description: 'Windows visible on this room\'s exterior walls; omit if unclear' },
          exposureDirection: {
            type: 'string',
            enum: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
            description: 'Primary exterior exposure, only when a north arrow is present; omit otherwise',
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'high = dimensions read directly from printed strings; medium = scaled/inferred; low = guessed from proportions',
          },
          polygon: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'Horizontal position normalized to the sheet image width: 0 = left edge, 1 = right edge' },
                y: { type: 'number', description: 'Vertical position normalized to the sheet image height: 0 = top edge, 1 = bottom edge (y increases DOWNWARD)' },
              },
              required: ['x', 'y'],
              additionalProperties: false,
            },
            description: 'The room boundary traced on the sheet as an ordered vertex loop (3-24 points, do not repeat the first point at the end). Trace wall centerlines where discernible, else the visible wall lines. Where the plan is orthogonal, keep corners at right angles. Omit ONLY if the outline genuinely cannot be located on the sheet.',
          },
          imageIndex: {
            type: 'integer',
            description: '0-based index of the provided sheet this room (and its polygon) was read from. Always emit it — 0 when only one sheet was provided.',
          },
          notes: { type: 'string', description: 'Anything the reviewer should check (illegible text, assumed scale, partial view)' },
        },
        // imageIndex is REQUIRED (not advisory): an omitted index would be
        // silently read as sheet 0 client-side, which on a multi-sheet set
        // places geometry on the wrong drawing. Constrained decoding only
        // guarantees emission for required fields.
        required: ['name', 'lengthFt', 'widthFt', 'confidence', 'imageIndex'],
        additionalProperties: false,
      },
    },
    scaleNote: { type: 'string', description: 'Scale or dimension references found (e.g. "1/4in = 1ft", "30\'-0\" dimension line on south wall")' },
    warnings: {
      type: 'array',
      items: { type: 'string' },
      description: 'Anything that limits reliability: no printed dimensions, multiple floors on one sheet, commercial occupancy, poor legibility',
    },
  },
  required: ['buildingType', 'rooms', 'warnings'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are a takeoff assistant for HVAC load calculation inside HVAC DesignPro. You are shown one or more rasterized sheets of the SAME construction plan set (a large plan is often split across several pages or image files). Extract the combined room schedule a designer would need to run an ACCA Manual J residential load calculation.

Rules:
- Treat all provided sheets as one building. Merge the room schedule across sheets and deduplicate: a room visible on two sheets (overlap regions, match lines, key plans) appears ONCE in the output.
- Prefer printed dimension strings (e.g. 12'-6") over measuring the drawing. Report in decimal feet.
- Never invent data. If a value isn't on the plan, omit the optional field and lower the confidence.
- For EVERY room, also trace its boundary as a polygon in normalized sheet coordinates (x: 0=left to 1=right, y: 0=top to 1=bottom of that image). This is how the room lands at its TRUE position in the CAD workspace — the layout must match the drawing, not an idealized arrangement. Trace wall centerlines, keep orthogonal corners square, order the vertices around the loop, and make the polygon's proportions agree with the printed dimensions you report. Set imageIndex to the sheet you traced on. Omit the polygon only when the room's outline genuinely cannot be located.
- Every extraction is reviewed by a licensed professional before use — your job is a faithful first pass, not a final answer.
- Only include actual conditioned rooms (bedrooms, kitchens, offices, halls...). Skip garages, decks, and exterior features unless clearly conditioned.
- If the plan is commercial/assembly occupancy, still extract the spaces but set buildingType to "commercial" and add a warning that Manual J is residential-only.`;

// POST /api/ai/blueprint-extract
// Body: { imageDataUrl: string, projectId?: string, fileName?: string }
aiRoutes.post('/blueprint-extract', async (c) => {
  const user = c.get('user');

  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'Logarithmic Extraction is not configured on this deployment (ANTHROPIC_API_KEY missing).' }, 503);
  }

  let body: { imageDataUrls?: string[]; imageDataUrl?: string; projectId?: string; fileName?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Accept an array of sheets (preferred) or the original single-image field.
  const dataUrls = Array.isArray(body.imageDataUrls) && body.imageDataUrls.length > 0
    ? body.imageDataUrls
    : body.imageDataUrl
      ? [body.imageDataUrl]
      : [];
  if (dataUrls.length === 0) {
    return c.json({ error: 'Provide imageDataUrls (array of base64 data URLs)' }, 400);
  }
  if (dataUrls.length > MAX_IMAGES) {
    return c.json({ error: `Too many sheets — send at most ${MAX_IMAGES} images per extraction.` }, 400);
  }
  if (dataUrls.reduce((n, d) => n + d.length, 0) > MAX_TOTAL_B64_CHARS) {
    return c.json({ error: 'Plan set too large for Logarithmic Extraction (~18MB total). Re-import the sheets at a lower resolution.' }, 413);
  }

  const images: Array<{ mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string }> = [];
  for (const dataUrl of dataUrls) {
    if (dataUrl.length > MAX_IMAGE_B64_CHARS) {
      return c.json({ error: 'One of the sheets is too large for Logarithmic Extraction (max ~7.5MB each).' }, 413);
    }
    const match = DATA_URL_RE.exec(dataUrl);
    if (!match) {
      return c.json({ error: 'Every sheet must be a base64 PNG/JPEG/WebP/GIF data URL' }, 400);
    }
    images.push({ mediaType: match[1] as (typeof images)[number]['mediaType'], data: match[2] });
  }

  const client = new Anthropic({ apiKey });

  let response: Anthropic.Message;
  try {
    // Streamed, not `create`: max_tokens is a hard cap on TOTAL output —
    // adaptive thinking shares the budget with the JSON — and polygons roughly
    // double the per-room output. A large plan set needs well past the ~16k
    // non-streaming ceiling, and only streaming avoids the HTTP timeout at
    // that size. `finalMessage()` collects the whole response, so the rest of
    // this handler is unchanged.
    const stream = client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 64000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: 'json_schema', schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
            })),
            {
              type: 'text' as const,
              text: images.length === 1
                ? 'Extract the room schedule from this blueprint page.'
                : `These ${images.length} sheets belong to the same plan set. Extract ONE merged, deduplicated room schedule covering the whole building.`,
            },
          ],
        },
      ],
    });
    response = await stream.finalMessage();
  } catch (err) {
    // Upstream AI failures must stay actionable, not become bare 500s: a 429
    // (org rate limit) or 529 (overloaded) is transient — tell the user to
    // wait, and return 429 so the frontend's 5xx retry does NOT re-fire this
    // expensive multi-image vision request. Other API errors → 502.
    if (err instanceof Anthropic.APIError) {
      if (err.status === 429 || err.status === 529) {
        return c.json({ error: 'The AI service is busy right now — wait a minute and try the takeoff again.' }, 429);
      }
      // Other 4xx are our bug or our config (bad request, auth, payload) and
      // will fail identically on replay — return 4xx so the frontend's 5xx
      // retry does NOT re-send this expensive multi-image request.
      if (err.status && err.status >= 400 && err.status < 500) {
        return c.json({ error: 'The Logarithmic Extraction request was rejected. This is a configuration problem, not a transient one — please report it.' }, 422);
      }
      return c.json({ error: 'The AI service returned an error — try the takeoff again shortly.' }, 502);
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    return c.json({ error: 'The AI declined to process this image.' }, 422);
  }
  if (response.stop_reason === 'max_tokens') {
    return c.json({ error: 'The plan was too complex for a single extraction pass. Try importing a page with fewer rooms.' }, 422);
  }

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return c.json({ error: 'AI returned no extraction' }, 502);
  }

  let extraction: unknown;
  try {
    extraction = JSON.parse(textBlock.text);
  } catch {
    return c.json({ error: 'AI returned malformed extraction data' }, 502);
  }

  setAudit(c, {
    action: 'ai.blueprint_extract',
    entityType: 'ai_extraction',
    entityId: response.id,
    entityLabel: body.fileName || 'blueprint',
    projectId: body.projectId || undefined,
    detail: {
      model: response.model,
      sheets: images.length,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      orgId: user.orgId,
    },
  });

  return c.json({
    extraction,
    engine: response.model,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  });
});
