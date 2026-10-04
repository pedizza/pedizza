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
export async function sendMail(to: string, subject: string, text: string) {
  if (!mailConfigured()) throw Error("SMTP not configured");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_PORT !== "587",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10000,
  });
  await transport.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
}
