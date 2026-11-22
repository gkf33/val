import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "../db";
import { randomToken, sha256 } from "../crypto";
import { isAdminEmail } from "../config";

export const SESSION_COOKIE = "gl_session";
const SESSION_DAYS = 30;

export async function createSession(accountId: string): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.session.create({ data: { tokenHash: sha256(token), accountId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { account: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function getAdmin() {
  const session = await getSession();
  if (!session || !isAdminEmail(session.account.email)) return null;
  return session.account;
}

/** Für Admin-Seiten und -Aktionen. Leitet ohne Berechtigung auf den Login um. */
export async function requireAdmin() {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}
