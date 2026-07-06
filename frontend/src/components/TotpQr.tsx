import { useEffect, useState } from 'react';

/**
 * Renders an otpauth:// enrollment URI as a scannable QR code.
 *
 * The `qrcode` encoder is lazy-loaded (same pattern as jsPDF) so it never
 * touches the main bundle — it loads only when an enrollment surface is
 * actually shown. The QR sits on a white card because authenticator-app
 * scanners need a light quiet zone; the dark theme around it stays intact.
 *
 * Renders nothing on failure — the manual-entry secret shown alongside is
 * the fallback path, so a QR failure must never block enrollment.
 */
export default function TotpQr({ uri }: { uri: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    (async () => {
      try {
        const { toDataURL } = await import('qrcode');
        const url = await toDataURL(uri, { width: 208, margin: 1, errorCorrectionLevel: 'M' });
        if (!cancelled) setDataUrl(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [uri]);

  if (!uri || failed) return null;

  return (
    <div className="flex justify-center">
      {dataUrl ? (
        <div className="p-3 bg-white rounded-2xl shadow-xl">
          <img src={dataUrl} alt="Scan with your authenticator app to enroll" width={208} height={208} />
        </div>
      ) : (
        <div className="w-[232px] h-[232px] rounded-2xl bg-slate-800/60 animate-pulse" aria-hidden="true" />
      )}
    </div>
  );
}
