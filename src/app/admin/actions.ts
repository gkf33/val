"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requestLogin } from "@/server/auth/login";
import { RateLimitError } from "@/server/auth/magicLink";
import { requireAdmin } from "@/server/auth/session";
import type { Actor } from "@/server/audit";
import {
  FormError,
  createParty,
  createPartyLink,
  deactivateLink,
  regenerateLink,
  updateParty,
} from "@/server/parties";
import { ApprovalError, addCrew, approveGuests, rejectGuests, removeCrew, waitlistGuests } from "@/server/approval";
import { CapacityError } from "@/domain/capacity";
import { TransitionError } from "@/domain/guestStatus";


export async function adminLoginAction(formData: FormData) {
  try {
    await requestLogin(String(formData.get("email") ?? ""), "admin");
  } catch (e) {
    if (e instanceof RateLimitError) redirect("/admin/login?limited=1");
    throw e;
  }
  redirect("/admin/login?sent=1");
}

async function actor(): Promise<Actor> {
  const admin = await requireAdmin();
  return { type: "admin", label: admin.email };
}

export type FormState = { errors?: Record<string, string>; ok?: boolean };

export async function createPartyAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const a = await actor();
  let id: string;
  try {
    id = (await createParty(a, Object.fromEntries(formData))).id;
  } catch (e) {
    if (e instanceof FormError) return { errors: e.fieldErrors };
    throw e;
  }
  redirect(`/admin/parties/${id}`);
}

export async function updatePartyAction(partyId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const a = await actor();
  try {
    await updateParty(a, partyId, Object.fromEntries(formData));
  } catch (e) {
    if (e instanceof FormError) return { errors: e.fieldErrors };
    throw e;
  }
  revalidatePath(`/admin/parties/${partyId}`);
  return { ok: true };
}

export async function createPublicLinkAction(partyId: string) {
  await createPartyLink(await actor(), partyId, "public");
  revalidatePath(`/admin/parties/${partyId}`);
}

export async function createInviterLinkAction(partyId: string, formData: FormData) {
  const label = String(formData.get("inviterLabel") ?? "");
  if (!label.trim()) return;
  await createPartyLink(await actor(), partyId, "inviter", label);
  revalidatePath(`/admin/parties/${partyId}`);
}

export async function deactivateLinkAction(partyId: string, linkId: string) {
  await deactivateLink(await actor(), linkId);
  revalidatePath(`/admin/parties/${partyId}`);
}

export async function regenerateLinkAction(partyId: string, linkId: string) {
  await regenerateLink(await actor(), linkId);
  revalidatePath(`/admin/parties/${partyId}`);
}

// ── Queue ─────────────────────────────────────────────────


function queueUrl(partyId: string, tab: string, params: Record<string, string>) {
  const q = new URLSearchParams({ party: partyId, tab, ...params });
  return `/admin/queue?${q.toString()}`;
}

function friendly(e: unknown): string | null {
  if (e instanceof CapacityError) return `Nicht genug Plätze: ${e.requested} gewählt, ${e.free} frei`;
  if (e instanceof ApprovalError) return e.message;
  if (e instanceof TransitionError) return "Status hat sich geändert. Seite neu laden.";
  return null;
}

/**
 * Ein Formular für die ganze Queue. `op` = approve|reject|waitlist[:bookingId].
 * Checkbox-Werte: `<bookingId>:<guestId>`.
 */
export async function queueAction(partyId: string, tab: string, formData: FormData) {
  const a = await actor();
  const op = String(formData.get("op") ?? "");
  const [verb, bookingId] = op.split(":");
  const picked = formData
    .getAll("guest")
    .map(String)
    .map((v) => v.split(":"))
    .filter(([b]) => !bookingId || b === bookingId)
    .map(([, g]) => g);
  if (picked.length === 0) redirect(queueUrl(partyId, tab, { err: "Keine Gäste ausgewählt" }));

  try {
    if (verb === "approve") await approveGuests(a, partyId, picked);
    else if (verb === "reject") {
      const msg = bookingId ? String(formData.get(`msg-${bookingId}`) ?? "") : String(formData.get("msg-bulk") ?? "");
      await rejectGuests(a, partyId, picked, msg);
    } else if (verb === "waitlist") await waitlistGuests(a, partyId, picked);
    else throw new Error("Unbekannte Aktion");
  } catch (e) {
    const m = friendly(e);
    if (m) redirect(queueUrl(partyId, tab, { err: m }));
    throw e;
  }
  revalidatePath("/admin");
  const label = { approve: "freigegeben", reject: "abgelehnt", waitlist: "auf Warteliste" }[verb] ?? "";
  redirect(queueUrl(partyId, tab, { ok: `${picked.length} ${label}` }));
}

export async function addCrewAction(partyId: string, formData: FormData) {
  const a = await actor();
  try {
    await addCrew(a, partyId, {
      name: String(formData.get("name") ?? ""),
      role: String(formData.get("role") ?? ""),
      email: String(formData.get("email") ?? ""),
      gender: String(formData.get("gender") ?? ""),
    });
  } catch (e) {
    const m = friendly(e);
    if (m) redirect(`/admin/parties/${partyId}/crew?err=${encodeURIComponent(m)}`);
    throw e;
  }
  revalidatePath(`/admin/parties/${partyId}/crew`);
}

export async function removeCrewAction(partyId: string, guestId: string) {
  await removeCrew(await actor(), partyId, guestId);
  revalidatePath(`/admin/parties/${partyId}/crew`);
}
