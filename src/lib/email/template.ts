// src/lib/email/template.ts
//
// Plain-string HTML email template. Email clients (Gmail, Outlook,
// Apple Mail) render better with table-based layouts + inline CSS; a
// React/JSX-based template would pull in a dependency (react-email)
// without unlocking anything we need today. When we add branding
// assets, we can swap this for a proper component tree.
//
// All helpers escape user-supplied strings so custom practice names or
// incident titles can't inject markup. Static copy (headings, footer)
// is trusted.

const BG = "#F8FAFC";
const FG = "#1E293B";
const MUTED = "#64748B";
const BORDER = "#E2E8F0";
const ACCENT = "#2563EB";
const CRITICAL = "#991B1B";
const WARNING = "#854D0E";

export interface EmailSection {
  /** Optional label rendered above the body paragraph (uppercase, muted). */
  label?: string;
  /** Body. Can include <strong>/<em> — do NOT include untrusted HTML. */
  html: string;
}

export interface EmailTemplateInput {
  /** Preheader — hidden teaser shown in most inboxes below the subject. */
  preheader: string;
  /** Hero headline. */
  headline: string;
  /** Optional hero subtitle. */
  subheadline?: string;
  /** Optional severity accent color for hero ("critical" | "warning"). */
  accent?: "critical" | "warning";
  /** Body sections rendered in order. */
  sections: EmailSection[];
  /** Primary call-to-action button, if any. */
  cta?: { label: string; href: string };
  /** Optional secondary links rendered as plain anchors. */
  secondaryLinks?: Array<{ label: string; href: string }>;
  /** Practice name — rendered in header + footer so recipients can tell which
   *  account the email is about when they manage multiple. */
  practiceName: string;
  /** Base URL for absolute links in footer. */
  baseUrl: string;
}

export function renderEmailHtml(input: EmailTemplateInput): string {
  const accentColor =
    input.accent === "critical"
      ? CRITICAL
      : input.accent === "warning"
        ? WARNING
        : ACCENT;
  const sectionsHtml = input.sections
    .map(
      (s) => `
        <tr>
          <td style="padding: 16px 24px; border-top: 1px solid ${BORDER};">
            ${
              s.label
                ? `<div style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: ${MUTED}; margin-bottom: 6px;">${escape(
                    s.label,
                  )}</div>`
                : ""
            }
            <div style="font-size: 14px; line-height: 1.55; color: ${FG};">${s.html}</div>
          </td>
        </tr>`,
    )
    .join("\n");

  const ctaHtml = input.cta
    ? `
        <tr>
          <td style="padding: 8px 24px 24px;">
            <a href="${escapeAttr(input.cta.href)}"
               style="display: inline-block; padding: 10px 18px; background: ${accentColor}; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 600;">${escape(input.cta.label)}</a>
          </td>
        </tr>`
    : "";

  const secondaryLinksHtml =
    input.secondaryLinks && input.secondaryLinks.length > 0
      ? `
        <tr>
          <td style="padding: 0 24px 16px; font-size: 12px; color: ${MUTED};">
            ${input.secondaryLinks
              .map(
                (l) =>
                  `<a href="${escapeAttr(l.href)}" style="color: ${MUTED}; text-decoration: underline;">${escape(l.label)}</a>`,
              )
              .join(" &nbsp;·&nbsp; ")}
          </td>
        </tr>`
      : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(input.headline)}</title>
    <style>
      @media (max-width: 600px) {
        .container { width: 100% !important; }
      }
    </style>
  </head>
  <body style="margin: 0; padding: 24px 0; background: ${BG}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
    <!-- preheader (hidden in most clients) -->
    <div style="display: none; visibility: hidden; height: 0; overflow: hidden; font-size: 1px; line-height: 1px; color: transparent;">${escape(input.preheader)}</div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: ${BG};">
      <tr>
        <td align="center" style="padding: 0 16px;">
          <table class="container" role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="background: #ffffff; border: 1px solid ${BORDER}; border-radius: 10px;">
            <!-- header -->
            <tr>
              <td style="padding: 20px 24px 12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="font-size: 15px; font-weight: 700; color: ${FG};">GuardWell</td>
                    <td align="right" style="font-size: 11px; color: ${MUTED};">${escape(input.practiceName)}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- hero -->
            <tr>
              <td style="padding: 4px 24px 20px;">
                <div style="font-size: 22px; font-weight: 700; color: ${accentColor}; line-height: 1.3;">${escape(input.headline)}</div>
                ${
                  input.subheadline
                    ? `<div style="margin-top: 6px; font-size: 14px; color: ${MUTED}; line-height: 1.5;">${escape(input.subheadline)}</div>`
                    : ""
                }
              </td>
            </tr>
            ${sectionsHtml}
            ${ctaHtml}
            ${secondaryLinksHtml}
            <tr>
              <td style="padding: 16px 24px 20px; border-top: 1px solid ${BORDER}; font-size: 11px; color: ${MUTED}; line-height: 1.5;">
                Sent by GuardWell on behalf of ${escape(input.practiceName)}.
                <br />
                <a href="${escapeAttr(input.baseUrl.replace(/\/$/, ""))}/settings/notifications" style="color: ${MUTED}; text-decoration: underline;">Notification preferences</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escape(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(input: string): string {
  return escape(input);
}
