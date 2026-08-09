import type { Env } from "../env";

type MagicLinkMessage = {
  email: string;
  name?: string;
  magicLink: string;
  purpose: "login" | "register" | "invite";
};

type InvitationMessage = {
  email: string;
  inviterName: string;
  organizationName: string;
  eventName?: string;
  role: "admin" | "reviewer" | "speaker";
  inviteLink: string;
};

type SubmissionConfirmationMessage = {
  email: string;
  name: string;
  eventName: string;
  formName: string;
  submissionTitle: string;
  subject?: string | null;
  body?: string | null;
  editLink: string;
  idempotencyKey: string;
};

type DecisionMessage = {
  email: string;
  name: string;
  eventName: string;
  sessionTitle: string;
  decision: "accepted" | "declined";
  subject: string;
  body: string;
  portalLink?: string;
  idempotencyKey: string;
};

export async function sendMagicLink(env: Env, message: MagicLinkMessage): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Transactional email is not configured.");

  const action = message.purpose === "register" ? "create your ProgramLoom account" : "sign in to ProgramLoom";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": `auth/${await stableMessageKey(message.email, message.magicLink)}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.email],
      reply_to: env.EMAIL_REPLY_TO,
      subject: message.purpose === "register" ? "Your ProgramLoom account link" : "Your ProgramLoom sign-in link",
      html: renderMagicLinkHtml(message.name, action, message.magicLink),
      text: `Use this secure link to ${action}: ${message.magicLink}\n\nThe link expires in 15 minutes and can be used once.`,
      tags: [{ name: "message_type", value: `auth_${message.purpose}` }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(JSON.stringify({ level: "error", service: "resend", status: response.status, detail: detail.slice(0, 500) }));
    throw new Error("The sign-in email could not be sent.");
  }
}

export async function sendInvitation(env: Env, message: InvitationMessage): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Transactional email is not configured.");
  const scope = message.eventName ? `${message.eventName} in ${message.organizationName}` : message.organizationName;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": `invite/${await stableMessageKey(message.email, message.inviteLink)}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.email],
      reply_to: env.EMAIL_REPLY_TO,
      subject: `${message.inviterName} invited you to ${scope}`,
      html: renderInvitationHtml(message),
      text: `${message.inviterName} invited you to join ${scope} as a ${message.role}. Accept the invitation: ${message.inviteLink}\n\nThe link expires in 7 days and can be used once.`,
      tags: [{ name: "message_type", value: "team_invitation" }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error(JSON.stringify({ level: "error", service: "resend", status: response.status, detail: detail.slice(0, 500) }));
    throw new Error("The invitation email could not be sent.");
  }
}

export async function sendSubmissionConfirmation(env: Env, message: SubmissionConfirmationMessage): Promise<string> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Transactional email is not configured.");
  const subject = message.subject || `We received your proposal for ${message.eventName}`;
  const intro = message.body || `Thanks for sharing your idea with the ${message.eventName} program team.`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": `submission/${message.idempotencyKey}` },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.email],
      reply_to: env.EMAIL_REPLY_TO,
      subject,
      html: `<!doctype html><html><body style="margin:0;background:#f4f1e8;color:#20241f;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 24px"><div style="font-size:20px;font-weight:700;margin-bottom:34px">ProgramLoom</div><div style="background:#fffdf6;border:1px solid #d9d5ca;border-radius:14px;padding:32px"><p>Hi ${escapeHtml(message.name)},</p><p>${escapeHtml(intro)}</p><p><strong>${escapeHtml(message.submissionTitle || message.formName)}</strong> is now in the review queue.</p><p style="margin:28px 0"><a href="${escapeHtml(message.editLink)}" style="display:inline-block;background:#315c45;color:white;text-decoration:none;padding:14px 18px;border-radius:8px;font-weight:700">Review or edit proposal</a></p><p style="font-size:13px;color:#63675f">Keep this private link safe. Editing may close at the deadline set by the organizer.</p></div></div></body></html>`,
      text: `Hi ${message.name},\n\n${intro}\n\n${message.submissionTitle || message.formName} is now in the review queue.\n\nReview or edit it: ${message.editLink}`,
      tags: [{ name: "message_type", value: "submission_confirmation" }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error(JSON.stringify({ level: "error", service: "resend", status: response.status, detail: detail.slice(0, 500) }));
    throw new Error("The confirmation email could not be sent.");
  }
  const result = await response.json() as { id?: string };
  return result.id ?? "accepted";
}

export async function sendDecision(env: Env, message: DecisionMessage): Promise<string> {
  if (env.APP_ENV === "test") return "test-provider-id";
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Transactional email is not configured.");
  const action = message.portalLink ? `<p style="margin:28px 0"><a href="${escapeHtml(message.portalLink)}" style="display:inline-block;background:#315c45;color:white;text-decoration:none;padding:14px 18px;border-radius:8px;font-weight:700">Open speaker portal</a></p>` : "";
  const textAction = message.portalLink ? `\n\nOpen your speaker portal: ${message.portalLink}` : "";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": `decision/${message.idempotencyKey}` },
    body: JSON.stringify({
      from: env.EMAIL_FROM, to: [message.email], reply_to: env.EMAIL_REPLY_TO, subject: message.subject,
      html: `<!doctype html><html><body style="margin:0;background:#f4f1e8;color:#20241f;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 24px"><div style="font-size:20px;font-weight:700;margin-bottom:34px">ProgramLoom</div><div style="background:#fffdf6;border:1px solid #d9d5ca;border-radius:14px;padding:32px"><p>Hi ${escapeHtml(message.name)},</p>${message.body.split("\n").filter(Boolean).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}${action}<p style="font-size:13px;color:#63675f">This message was sent by the ${escapeHtml(message.eventName)} program team about “${escapeHtml(message.sessionTitle)}”.</p></div></div></body></html>`,
      text: `Hi ${message.name},\n\n${message.body}${textAction}\n\nThis message was sent by the ${message.eventName} program team about “${message.sessionTitle}”.`,
      tags: [{ name: "message_type", value: `decision_${message.decision}` }],
    }),
  });
  if (!response.ok) { const detail = await response.text(); console.error(JSON.stringify({ level: "error", service: "resend", status: response.status, detail: detail.slice(0, 500) })); throw new Error("The decision email could not be sent."); }
  const result = await response.json() as { id?: string }; return result.id ?? "accepted";
}

async function stableMessageKey(email: string, link: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${email}|${link}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function renderMagicLinkHtml(name: string | undefined, action: string, link: string): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hello,";
  return `<!doctype html><html><body style="margin:0;background:#f4f1e8;color:#20241f;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 24px"><div style="font-size:20px;font-weight:700;margin-bottom:34px">ProgramLoom</div><div style="background:#fffdf6;border:1px solid #d9d5ca;border-radius:14px;padding:32px"><p>${greeting}</p><p>Use the button below to ${escapeHtml(action)}.</p><p style="margin:28px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#315c45;color:white;text-decoration:none;padding:14px 18px;border-radius:8px;font-weight:700">Continue to ProgramLoom</a></p><p style="font-size:13px;color:#63675f">This link expires in 15 minutes and can be used once. If you did not request it, you can safely ignore this email.</p></div></div></body></html>`;
}

function renderInvitationHtml(message: InvitationMessage): string {
  const scope = message.eventName ? `${escapeHtml(message.eventName)} in ${escapeHtml(message.organizationName)}` : escapeHtml(message.organizationName);
  return `<!doctype html><html><body style="margin:0;background:#f4f1e8;color:#20241f;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 24px"><div style="font-size:20px;font-weight:700;margin-bottom:34px">ProgramLoom</div><div style="background:#fffdf6;border:1px solid #d9d5ca;border-radius:14px;padding:32px"><p>Hello,</p><p><strong>${escapeHtml(message.inviterName)}</strong> invited you to join ${scope} as a <strong>${escapeHtml(message.role)}</strong>.</p><p style="margin:28px 0"><a href="${escapeHtml(message.inviteLink)}" style="display:inline-block;background:#315c45;color:white;text-decoration:none;padding:14px 18px;border-radius:8px;font-weight:700">Accept invitation</a></p><p style="font-size:13px;color:#63675f">This link expires in 7 days and can be used once. If you were not expecting this invitation, you can ignore it.</p></div></div></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}
