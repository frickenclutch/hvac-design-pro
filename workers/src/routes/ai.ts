import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { setAudit } from '../middleware/audit';

interface Env {
  DB: D1Database;
  /** Anthropic API key — set via `wrangler secret put ANTHROPIC_API_KEY`.
   *  Unset → the AI extraction endpoints return 503 (feature not configured)
   *  rather than failing opaquely. */
  ANTHROPIC_API_KEY?: string;
}

export const aiRoutes = new Hono<{ Bindings: Env }>();

// Rasterized blueprint pages arrive as base64 data URLs. 10M chars of base64
// ≈ 7.5MB decoded — comfortably above our 2400px PNG rasters, well below
// Claude's per-image limits.
const MAX_IMAGE_B64_CHARS = 10_000_000;
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
          notes: { type: 'string', description: 'Anything the reviewer should check (illegible text, assumed scale, partial view)' },
        },
        required: ['name', 'lengthFt', 'widthFt', 'confidence'],
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

const SYSTEM_PROMPT = `You are a takeoff assistant for HVAC load calculation inside HVAC DesignPro. You are shown one rasterized page of a construction blueprint. Extract the room schedule a designer would need to run an ACCA Manual J residential load calculation.

Rules:
- Prefer printed dimension strings (e.g. 12'-6") over measuring the drawing. Report in decimal feet.
- Never invent data. If a value isn't on the plan, omit the optional field and lower the confidence.
- Every extraction is reviewed by a licensed professional before use — your job is a faithful first pass, not a final answer.
- Only include actual conditioned rooms (bedrooms, kitchens, offices, halls...). Skip garages, decks, and exterior features unless clearly conditioned.
- If the plan is commercial/assembly occupancy, still extract the spaces but set buildingType to "commercial" and add a warning that Manual J is residential-only.`;

// POST /api/ai/blueprint-extract
// Body: { imageDataUrl: string, projectId?: string, fileName?: string }
aiRoutes.post('/blueprint-extract', async (c) => {
  const user = c.get('user');

  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json({ error: 'AI extraction is not configured on this deployment (ANTHROPIC_API_KEY missing).' }, 503);
  }

  let body: { imageDataUrl?: string; projectId?: string; fileName?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const dataUrl = body.imageDataUrl ?? '';
  if (dataUrl.length > MAX_IMAGE_B64_CHARS) {
    return c.json({ error: 'Image too large for AI extraction (max ~7.5MB). Re-import the blueprint at a lower resolution.' }, 413);
  }
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) {
    return c.json({ error: 'imageDataUrl must be a base64 PNG/JPEG/WebP/GIF data URL' }, 400);
  }
  const mediaType = match[1] as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  const imageB64 = match[2];

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
          { type: 'text', text: 'Extract the room schedule from this blueprint page.' },
        ],
      },
    ],
  });

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
