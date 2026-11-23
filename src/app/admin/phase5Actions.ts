"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { audit, type Actor } from "@/server/audit";
import { CancelError, cancelGuests } from "@/server/cancellation";
import { NameChangeError, decideNameChange } from "@/server/nameChange";
import { parseEuroToCents } from "@/domain/money";
import { CapacityError } from "@/domain/capacity";

async function actor(): Promise<Actor> {
  const a = await requireAdmin();
  return { type: "admin", label: a.email };
}

export async function decideNameChangeAction(partyId: string, requestId: string, approve: boolean) {
  const a = await actor();
  try {
    await decideNameChange(a, requestId, approve);
  } catch (e) {
    const m = e instanceof NameChangeError || e instanceof CapacityError ? e.message : null;
    if (m) redirect(`/admin/queue?party=${partyId}&tab=names&err=${encodeURIComponent(m)}`);
    throw e;
  }
  redirect(`/admin/queue?party=${partyId}&tab=names&ok=${encodeURIComponent(approve ? "Freigegeben, neuer QR-Code verschickt" : "Abgelehnt")}`);
}

export async function adminCancelAction(partyId: string, bookingId: string, guestId: string) {
  const a = await actor();
  try {
    await cancelGuests(a, bookingId, [guestId]);
  } catch (e) {
    if (e instanceof CancelError) redirect(`/admin/parties/${partyId}/guests?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(`/admin/parties/${partyId}/guests`);
}

export async function toggleTrustedAction(accountId: string) {
  const a = await actor();
  const acc = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  await prisma.account.update({ where: { id: accountId }, data: { trusted: !acc.trusted } });
  await audit(a, acc.trusted ? "account.untrust" : "account.trust", { entityType: "Account", entityId: accountId });
  revalidatePath("/admin/guests");
}

export async function addBlockAction(fd: FormData) {
  const a = await actor();
  const name = String(fd.get("name") ?? "").trim() || null;
  const email = String(fd.get("email") ?? "").trim().toLowerCase() || null;
  if (!name && !email) redirect("/admin/blocklist?err=Name%20oder%20E-Mail%20angeben");
  const b = await prisma.blocklist.create({ data: { name, email, reason: String(fd.get("reason") ?? "").trim() || null } });
  await audit(a, "blocklist.add", { entityType: "Blocklist", entityId: b.id });
  revalidatePath("/admin/blocklist");
}

export async function blockAccountAction(accountId: string) {
  const a = await actor();
  const acc = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const b = await prisma.blocklist.create({ data: { name: acc.name, email: acc.email, reason: "aus Gästeübersicht" } });
  await prisma.account.update({ where: { id: accountId }, data: { trusted: false } });
  await audit(a, "blocklist.add", { entityType: "Blocklist", entityId: b.id });
  revalidatePath("/admin/guests");
}

export async function removeBlockAction(id: string) {
  const a = await actor();
  await prisma.blocklist.delete({ where: { id } });
  await audit(a, "blocklist.remove", { entityType: "Blocklist", entityId: id });
  revalidatePath("/admin/blocklist");
}

export async function addCostAction(partyId: string, fd: FormData) {
  const a = await actor();
  const label = String(fd.get("label") ?? "").trim();
  const cents = parseEuroToCents(String(fd.get("amount") ?? ""));
  if (!label || cents === null) redirect(`/admin/parties/${partyId}?costErr=1#kosten`);
  const c = await prisma.partyCost.create({ data: { partyId, label: label.slice(0, 80), amountCents: cents } });
  await audit(a, "cost.add", { entityType: "PartyCost", entityId: c.id, partyId, data: { label, cents } });
  revalidatePath(`/admin/parties/${partyId}`);
}

export async function removeCostAction(partyId: string, id: string) {
  const a = await actor();
  await prisma.partyCost.delete({ where: { id } });
  await audit(a, "cost.remove", { entityType: "PartyCost", entityId: id, partyId });
  revalidatePath(`/admin/parties/${partyId}`);
}
