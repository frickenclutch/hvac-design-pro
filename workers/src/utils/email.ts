/**
 * Email utilities for transactional emails via Resend API.
 *
 * Requires RESEND_API_KEY environment variable in wrangler.toml.
 * Free tier: 100 emails/day, 3,000/month — more than enough for onboarding.
 *
 * If RESEND_API_KEY is not set, emails are silently skipped (logged to console).
 */

const RESEND_API = 'https://api.resend.com/emails';
// Resend requires a verified domain. Use onboarding@resend.dev for free tier,
// or configure a custom domain (e.g., noreply@c4tech.co) in the Resend dashboard.
const FROM_ADDRESS = 'HVAC DesignPro <noreply@c4tech.co>';

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

// ── Feedback Email ────────────────────────────────────────────────────────────

interface FeedbackEmailData {
  type: string;          // 'BUG' | 'IDEA' | 'QUESTION'
  text: string;
  context: string;       // workspace: 'cad' | 'manualj' | 'manual-d'
  userName: string;
  userEmail: string;
  userRole: string;
  orgName: string;
  userAgent: string;
  attachments: { filename: string; contentType: string; sizeBytes: number }[];
  feedbackId: string;
  timestamp: string;
}

export function buildFeedbackEmail(data: FeedbackEmailData): EmailPayload & { subject: string; html: string } {
  const typeColors: Record<string, string> = {
    BUG: '#ef4444',
    IDEA: '#3b82f6',
    QUESTION: '#f59e0b',
  };
  const badgeColor = typeColors[data.type] || '#94a3b8';

  const contextLabel: Record<string, string> = {
    cad: 'CAD Workspace',
    manualj: 'Manual J Calculator',
    'manual-d': 'Manual D Calculator',
  };
  const workspace = contextLabel[data.context] || data.context || 'General';

  const attachmentRows = data.attachments.length > 0
    ? data.attachments.map(a => {
        const sizeKb = (a.sizeBytes / 1024).toFixed(1);
        return `<tr><td style="padding:4px 8px;font-size:13px;color:#94a3b8;border-bottom:1px solid #1e293b;">${a.filename}</td><td style="padding:4px 8px;font-size:13px;color:#64748b;border-bottom:1px solid #1e293b;">${sizeKb} KB</td></tr>`;
      }).join('')
    : '';

  return {
    to: '',
    subject: `[HVAC DesignPro] ${data.type} from ${data.userName} (${data.orgName})`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
        <!-- Header -->
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid #334155;">
            <table width="100%"><tr>
              <td><span style="font-size:20px;font-weight:800;color:#34d399;letter-spacing:-0.5px;">HVAC DesignPro</span></td>
              <td align="right"><span style="display:inline-block;padding:6px 16px;border-radius:8px;font-size:12px;font-weight:800;color:#fff;background-color:${badgeColor};letter-spacing:1px;">${data.type}</span></td>
            </tr></table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 20px;font-size:14px;color:#64748b;">Feedback submitted via Mason assistant</p>

            <!-- User Info -->
            <table width="100%" style="margin-bottom:24px;border:1px solid #334155;border-radius:12px;overflow:hidden;">
              <tr style="background-color:#0f172a;">
                <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#94a3b8;width:120px;">User</td>
                <td style="padding:10px 16px;font-size:14px;color:#f1f5f9;font-weight:600;">${data.userName}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#94a3b8;">Email</td>
                <td style="padding:10px 16px;font-size:14px;color:#f1f5f9;"><a href="mailto:${data.userEmail}" style="color:#34d399;text-decoration:none;">${data.userEmail}</a></td>
              </tr>
              <tr style="background-color:#0f172a;">
                <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#94a3b8;">Organization</td>
                <td style="padding:10px 16px;font-size:14px;color:#f1f5f9;">${data.orgName}</td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#94a3b8;">Role</td>
                <td style="padding:10px 16px;font-size:14px;color:#f1f5f9;">${data.userRole}</td>
              </tr>
              <tr style="background-color:#0f172a;">
                <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#94a3b8;">Workspace</td>
                <td style="padding:10px 16px;font-size:14px;color:#f1f5f9;">${workspace}</td>
              </tr>
            </table>

            <!-- Feedback Content -->
            <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Description</p>
            <div style="padding:16px;background-color:#0f172a;border:1px solid #334155;border-radius:12px;margin-bottom:24px;">
              <p style="margin:0;font-size:14px;color:#e2e8f0;line-height:1.7;white-space:pre-wrap;">${data.text}</p>
            </div>

            ${data.attachments.length > 0 ? `
            <!-- Attachments -->
            <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Attachments (${data.attachments.length})</p>
            <table width="100%" style="margin-bottom:24px;border:1px solid #334155;border-radius:12px;overflow:hidden;background-color:#0f172a;">
              ${attachmentRows}
            </table>
            <p style="margin:0 0 24px;font-size:11px;color:#475569;">Files stored in R2 bucket under feedback/${data.feedbackId}/</p>
            ` : ''}

            <!-- Metadata -->
            <table width="100%" style="border-top:1px solid #334155;padding-top:16px;">
              <tr>
                <td style="font-size:11px;color:#475569;">Feedback ID: ${data.feedbackId}</td>
                <td align="right" style="font-size:11px;color:#475569;">${new Date(data.timestamp).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</td>
              </tr>
              <tr>
                <td colspan="2" style="font-size:10px;color:#334155;padding-top:4px;word-break:break-all;">${data.userAgent}</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #334155;background-color:#0f172a;">
            <p style="margin:0;font-size:11px;color:#475569;line-height:1.6;">
              C4 Technologies — HVAC DesignPro Feedback System<br>
              This ticket is pending integration with ModernERP.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

// ── Verification Code Email ──────────────────────────────────────────────────

export function buildVerificationEmail(firstName: string, code: string): EmailPayload & { subject: string; html: string } {
  return {
    to: '',
    subject: `Your HVAC DesignPro verification code: ${code}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #334155;">
              <span style="font-size:24px;font-weight:800;color:#34d399;letter-spacing:-0.5px;">HVAC DesignPro</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#f1f5f9;line-height:1.2;">
                Verify your email, ${firstName}
              </h1>
              <p style="margin:0 0 28px;font-size:16px;color:#94a3b8;line-height:1.6;">
                Enter this code to complete your registration:
              </p>
              <div style="text-align:center;padding:24px;background-color:#0f172a;border:2px solid #334155;border-radius:16px;margin-bottom:28px;">
                <span style="font-size:40px;font-weight:800;font-family:'Courier New',monospace;color:#34d399;letter-spacing:12px;">${code}</span>
              </div>
              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">
                This code expires in <strong style="color:#94a3b8;">10 minutes</strong>. If you didn't create an account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #334155;background-color:#0f172a;">
              <p style="margin:0;font-size:11px;color:#475569;line-height:1.6;">
                C4 Technologies — HVAC DesignPro<br>
                This email was sent because someone registered with this address at hvac-design-pro.pages.dev
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

// ── Password Reset Email ────────────────────────────────────────────────────

export function buildPasswordResetEmail(firstName: string, code: string): EmailPayload & { subject: string; html: string } {
  return {
    to: '',
    subject: `Reset your HVAC DesignPro password`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f172a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:16px;border:1px solid #334155;overflow:hidden;">
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #334155;">
              <span style="font-size:24px;font-weight:800;color:#34d399;letter-spacing:-0.5px;">HVAC DesignPro</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#f1f5f9;line-height:1.2;">
                Password reset, ${firstName}
              </h1>
              <p style="margin:0 0 28px;font-size:16px;color:#94a3b8;line-height:1.6;">
                Enter this code to reset your password:
              </p>
              <div style="text-align:center;padding:24px;background-color:#0f172a;border:2px solid #334155;border-radius:16px;margin-bottom:28px;">
                <span style="font-size:40px;font-weight:800;font-family:'Courier New',monospace;color:#34d399;letter-spacing:12px;">${code}</span>
              </div>
              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">
                This code expires in <strong style="color:#94a3b8;">15 minutes</strong>. If you didn't request a password reset, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #334155;background-color:#0f172a;">
              <p style="margin:0;font-size:11px;color:#475569;line-height:1.6;">
                C4 Technologies — HVAC DesignPro<br>
                This email was sent because a password reset was requested for this account.
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

// ── Welcome Email ─────────────────────────────────────────────────────────────

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
