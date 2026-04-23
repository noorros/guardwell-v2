// src/lib/email/send.ts
//
// Thin wrapper around Resend. Uses a lazy singleton so missing
// RESEND_API_KEY never crashes module-load time — in dev/CI without
// credentials, emails land in the console and the send resolves as a
// no-op success. Production sends require both RESEND_API_KEY and
// EMAIL_FROM to be set in the runtime env.

import { Resend } from "resend";

interface SendInput {
  to: string;
  subject: string;
  /** Plain-text body. Always required as a fallback for clients that
   *  don't render HTML. */
  text: string;
  /** Optional HTML body. When present, most email clients show this
   *  instead of `text`. */
  html?: string;
}

interface SendResult {
  delivered: boolean;
  providerId: string | null;
  reason?: string;
}

let resend: Resend | null = null;

function getClient(): Resend | null {
  if (resend) return resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resend = new Resend(key);
  return resend;
}

export async function sendEmail(input: SendInput): Promise<SendResult> {
  const from = process.env.EMAIL_FROM ?? "GuardWell <no-reply@gwcomp.com>";
  const client = getClient();

  if (!client) {
    // Dev / test / CI path — log and succeed so server actions can
    // proceed without email delivery being wired up.
    console.log(
      `[email:noop] to=${input.to} subject="${input.subject}" (RESEND_API_KEY unset)`,
    );
    return { delivered: false, providerId: null, reason: "no RESEND_API_KEY" };
  }

  try {
    const { data, error } = await client.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    });
    if (error) {
      console.error("[email:error]", error);
      return { delivered: false, providerId: null, reason: error.message };
    }
    return { delivered: true, providerId: data?.id ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[email:error]", message);
    return { delivered: false, providerId: null, reason: message };
  }
}
