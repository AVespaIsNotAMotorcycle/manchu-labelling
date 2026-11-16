import nodemailer from "nodemailer";

import { setAlertSender } from "./alerts.ts";

export interface Message {
  to: string;
  subject: string;
  text: string;
}

export type Mailer = (message: Message) => Promise<void>;

/**
 * Sends email through any SMTP server, set with SMTP_URL (such as smtps://user:pass@smtp.example.com)
 * and MAIL_FROM. Without SMTP_URL, messages are printed to the console, which is enough for local
 * development. Production refuses to start without it.
 */
export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const url = env.SMTP_URL;
  if (!url) {
    if (env.NODE_ENV === "production") throw new Error("SMTP_URL must be set in production");
    return async (message) => {
      console.log(`\n--- Email to ${message.to}: ${message.subject}\n${message.text}\n---\n`);
    };
  }
  const from = env.MAIL_FROM;
  if (!from) throw new Error("MAIL_FROM must be set when SMTP_URL is");
  const transport = nodemailer.createTransport(url);
  return async (message) => {
    await transport.sendMail({ from, ...message });
  };
}

/** Sends security alerts to ALERT_EMAIL, if set. */
export function sendAlertsBy(mailer: Mailer, env: NodeJS.ProcessEnv = process.env): void {
  const to = env.ALERT_EMAIL;
  setAlertSender(to ? (subject, text) => mailer({ to, subject, text }) : null);
}
