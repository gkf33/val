import type { TokenPurpose } from "@prisma/client";
import { prisma } from "../db";
import { randomToken, sha256 } from "../crypto";

export const MAGIC_LINK_TTL_MINUTES = 15;
const RATE_LIMIT_WINDOW_MINUTES = 15;
const RATE_LIMIT_MAX = 5;

export class RateLimitError extends Error {
  constructor() {
    super("Zu viele Anfragen. Bitte kurz warten.");
    this.name = "RateLimitError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createMagicToken(opts: {
  email: string;
  purpose: TokenPurpose;
  bookingId?: string;
  redirect?: string;
  ttlMinutes?: number;
}): Promise<string> {
  const email = normalizeEmail(opts.email);
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000);
  const recent = await prisma.loginToken.count({ where: { email, createdAt: { gte: since } } });
  if (recent >= RATE_LIMIT_MAX) throw new RateLimitError();

  const token = randomToken();
  await prisma.loginToken.create({
    data: {
      tokenHash: sha256(token),
      email,
      purpose: opts.purpose,
      bookingId: opts.bookingId,
      redirect: opts.redirect,
      expiresAt: new Date(Date.now() + (opts.ttlMinutes ?? MAGIC_LINK_TTL_MINUTES) * 60_000),
    },
  });
  return token;
}

/** Prüft den Token ohne ihn zu verbrauchen (für die Bestätigungsseite). */
export async function peekMagicToken(token: string) {
  const row = await prisma.loginToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;
  return row;
}

/** Verbraucht den Token atomar. Gibt null zurück, wenn ungültig/benutzt/abgelaufen. */
export async function consumeMagicToken(token: string) {
  const tokenHash = sha256(token);
  const now = new Date();
  const res = await prisma.loginToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (res.count !== 1) return null;
  return prisma.loginToken.findUnique({ where: { tokenHash } });
}
