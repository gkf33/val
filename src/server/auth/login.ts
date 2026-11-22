import { prisma } from "../db";
import { config, isAdminEmail } from "../config";
import { getMailer } from "../mail/mailer";
import { loginLinkMail } from "../mail/templates";
import { audit } from "../audit";
import { consumeMagicToken, createMagicToken, normalizeEmail } from "./magicLink";

/**
 * Fordert einen Login-Link an. Antwortet nach außen immer gleich,
 * damit nicht erkennbar ist, ob eine Adresse bekannt ist.
 */
export async function requestLogin(rawEmail: string, scope: "admin" | "guest"): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (scope === "admin" && !isAdminEmail(email)) return;
  if (scope === "guest") {
    const exists = await prisma.account.findUnique({ where: { email } });
    if (!exists) return;
  }
  const redirect = scope === "admin" ? "/admin" : "/me";
  const token = await createMagicToken({ email, purpose: "login", redirect });
  const url = `${config.appUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  await getMailer().send(loginLinkMail(email, url));
}

/** Verbraucht einen Login-Token und liefert Konto + Ziel. */
export async function completeLogin(token: string) {
  const row = await consumeMagicToken(token);
  if (!row || row.purpose !== "login") return null;
  const account = await prisma.account.upsert({
    where: { email: row.email },
    update: {},
    create: { email: row.email },
  });
  if (isAdminEmail(account.email)) {
    await audit({ type: "admin", label: account.email }, "admin.login", { entityType: "Account", entityId: account.id });
  }
  return { account, redirect: row.redirect ?? "/" };
}
