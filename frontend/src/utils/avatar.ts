// Server-backed avatar helpers. The avatar lives on the user row
// (users.avatar_key) and is served publicly by GET /avatars/:id — so it
// persists across reloads and follows the user to every device, unlike the old
// localStorage data URL. See workers migration 0019 + routes/users.ts.

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/**
 * URL for a user's avatar image, or null when they have none (caller renders
 * the initials fallback instead). `avatarKey` is threaded through purely as a
 * cache-buster — it changes on every upload, so a replaced avatar is never
 * served stale from a browser or CDN cache.
 *
 * Points at the PUBLIC /avatars/:id endpoint (not /api/*): a plain <img> tag
 * can't send the Authorization bearer, so the read has to be unauthenticated.
 */
export function avatarUrl(
  userId: string | null | undefined,
  avatarKey: string | null | undefined,
): string | null {
  if (!userId || !avatarKey) return null;
  return `${API_BASE}/avatars/${encodeURIComponent(userId)}?v=${encodeURIComponent(avatarKey)}`;
}

/**
 * Downscale + re-encode an image to a small avatar before upload, so what we
 * store (and every community viewer later fetches) is a few KB, not a multi-MB
 * camera file. Fits within `maxDim` preserving aspect ratio; the display uses
 * object-cover, so any non-square ratio still reads correctly in the circle.
 */
export async function downscaleImage(
  file: Blob,
  maxDim = 256,
  mime = 'image/webp',
  quality = 0.9,
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    throw new Error('Canvas is not supported in this browser.');
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))),
      mime,
      quality,
    );
  });
}
