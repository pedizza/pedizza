import "server-only";
import nodemailer from "nodemailer";

export function mailConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_FROM &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASSWORD
  );
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );
}

export function authEmail({
  title,
  message,
  action,
  url,
  expiration,
}: {
  title: string;
  message: string;
  action: string;
  url: string;
  expiration: string;
}) {
  const safe = {
    title: escapeHtml(title),
    message: escapeHtml(message),
    action: escapeHtml(action),
    url: escapeHtml(url),
    expiration: escapeHtml(expiration),
  };
  return {
    text: `${title}\n\n${message}\n\n${action}: ${url}\n\nEste link expira ${expiration}. Se você não fez esta solicitação, ignore este e-mail.`,
    html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f6f7f4;font-family:Arial,sans-serif;color:#20231f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e4e7e1;border-radius:18px;padding:32px"><tr><td><div style="font-weight:800;font-size:24px;color:#d93025;margin-bottom:24px">PEDIZZA</div><h1 style="font-size:24px;margin:0 0 16px">${safe.title}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 24px">${safe.message}</p><p style="margin:0 0 24px"><a href="${safe.url}" style="display:inline-block;background:#d93025;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">${safe.action}</a></p><p style="font-size:13px;line-height:1.5;color:#6b7169;margin:0 0 12px">Este link expira ${safe.expiration}.</p><p style="font-size:13px;line-height:1.5;color:#6b7169;margin:0">Se você não fez esta solicitação, ignore este e-mail.</p></td></tr></table></td></tr></table></body></html>`,
  };
}

export async function sendMail(
  to: string,
  subject: string,
  content: { text: string; html?: string },
) {
  if (!mailConfigured()) throw Error("SMTP not configured");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_PORT !== "587",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text: content.text,
    html: content.html,
  });
}
