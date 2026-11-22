import nodemailer from "nodemailer";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(mail: OutgoingMail) {
    console.log(`\n── MAIL an ${mail.to} ──\nBetreff: ${mail.subject}\n\n${mail.text}\n──────────────\n`);
  }
}

class SmtpMailer implements Mailer {
  private transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  async send(mail: OutgoingMail) {
    await this.transport.sendMail({ from: process.env.MAIL_FROM ?? "Guestlist <noreply@localhost>", ...mail });
  }
}

/** Schreibt Mails als JSON-Dateien (lokal ohne Mailserver, E2E-Tests). */
class FileMailer implements Mailer {
  async send(mail: OutgoingMail) {
    const dir = process.env.MAIL_OUTBOX_DIR ?? ".mail-outbox";
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync(path.join(dir, name), JSON.stringify({ ...mail, sentAt: new Date().toISOString() }, null, 2));
  }
}

/** In Tests: gesendete Mails landen hier. */
export class MemoryMailer implements Mailer {
  sent: OutgoingMail[] = [];
  async send(mail: OutgoingMail) {
    this.sent.push(mail);
  }
}

let override: Mailer | null = null;
export function setMailer(m: Mailer | null) {
  override = m;
}

export function getMailer(): Mailer {
  if (override) return override;
  switch (process.env.MAIL_TRANSPORT) {
    case "smtp":
      return new SmtpMailer();
    case "file":
      return new FileMailer();
    default:
      return new ConsoleMailer();
  }
}
