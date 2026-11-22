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
