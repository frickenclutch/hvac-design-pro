/**
 * Email utilities for transactional emails via Resend API.
 *
 * Requires RESEND_API_KEY environment variable in wrangler.toml.
 * Free tier: 100 emails/day, 3,000/month — more than enough for onboarding.
 *
 * If RESEND_API_KEY is not set, emails are silently skipped (logged to console).
 */

const RESEND_API = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'HVAC DesignPro <onboarding@hvac-design-pro.pages.dev>';

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(apiKey: string | undefined, payload: EmailPayload): Promise<boolean> {
  if (!apiKey) {
    console.log(`[email] No RESEND_API_KEY — skipping email to ${payload.to}: "${payload.subject}"`);
    return false;
  }

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend API error ${res.status}: ${body}`);
      return false;
    }

    console.log(`[email] Sent "${payload.subject}" to ${payload.to}`);
    return true;
  } catch (err) {
    console.error(`[email] Failed to send:`, err);
    return false;
  }
}

export function buildWelcomeEmail(firstName: string): EmailPayload & { subject: string; html: string } {
  return {
    to: '', // caller fills this in
    subject: `Welcome to HVAC DesignPro, ${firstName}!`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #334155;">
              <span style="font-size:24px;font-weight:800;color:#34d399;letter-spacing:-0.5px;">HVAC DesignPro</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 16px;font-size:28px;font-weight:800;color:#f1f5f9;line-height:1.2;">
                Welcome aboard, ${firstName}!
              </h1>
              <p style="margin:0 0 24px;font-size:16px;color:#94a3b8;line-height:1.6;">
                Your account is ready. You now have access to professional HVAC design tools — Manual J load calculations, 2D/3D CAD, cost estimation, and PDF report generation — all in your browser.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background-color:#10b981;border-radius:12px;padding:14px 32px;">
                    <a href="https://hvac-design-pro.pages.dev/dashboard" style="color:#0f172a;font-size:16px;font-weight:700;text-decoration:none;display:inline-block;">
                      Open Your Dashboard
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:14px;font-weight:700;color:#f1f5f9;">Quick start:</p>
              <ul style="margin:0 0 24px;padding-left:20px;font-size:14px;color:#94a3b8;line-height:2;">
                <li>Create a project from the Dashboard</li>
                <li>Draw floor plans in the CAD workspace</li>
                <li>Run Manual J calculations for heating &amp; cooling loads</li>
                <li>Export professional PDF reports</li>
              </ul>
              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">
                Need help? Visit the <a href="https://hvac-design-pro.pages.dev/guide" style="color:#34d399;text-decoration:none;">User Guide</a> or ask Mason, your built-in AI assistant.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #334155;background-color:#0f172a;">
              <p style="margin:0;font-size:11px;color:#475569;line-height:1.6;">
                C4 Technologies — HVAC DesignPro<br>
                This email was sent because you created an account at hvac-design-pro.pages.dev
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  };
}
