"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession, destroySession } from "@/server/auth/session";
import { CancelError, cancelGuests, requestCancellation } from "@/server/cancellation";
import { NameChangeError, requestNameChange } from "@/server/nameChange";
import { AccountDeleteError, deleteAccount } from "@/server/privacy";

async function account() {
  const s = await getSession();
  if (!s) redirect("/login");
  return s.account;
}

function back(params: Record<string, string>): never {
  redirect(`/me?${new URLSearchParams(params).toString()}`);
}

export async function cancelAction(bookingId: string, fd: FormData) {
  const a = await account();
  const ids = fd.getAll("guest").map(String);
  if (ids.length === 0) back({ err: "Niemand ausgewählt" });
  try {
    const r = await cancelGuests({ type: "guest", label: a.email }, bookingId, ids, { asGuestAccountId: a.id });
    revalidatePath("/me");
    back({ ok: `${r.cancelled} storniert` });
  } catch (e) {
    if (e instanceof CancelError) back({ err: e.message });
    throw e;
  }
}

export async function cancelRequestAction(bookingId: string, fd: FormData) {
  const a = await account();
  try {
    await requestCancellation(a.id, bookingId, String(fd.get("message") ?? ""));
  } catch (e) {
    if (e instanceof CancelError) back({ err: e.message });
    throw e;
  }
  back({ ok: "Anfrage gesendet" });
}

export async function nameChangeAction(guestId: string, fd: FormData) {
  const a = await account();
  try {
    await requestNameChange(a.id, guestId, {
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      gender: String(fd.get("gender") ?? ""),
      adult: fd.get("adult") === "on",
    });
  } catch (e) {
    if (e instanceof NameChangeError) back({ err: e.message });
    throw e;
  }
  back({ ok: "Namensänderung beantragt" });
}

export async function deleteAccountAction(fd: FormData) {
  const a = await account();
  if (String(fd.get("confirm") ?? "").trim().toUpperCase() !== "LÖSCHEN") back({ err: "Zum Bestätigen LÖSCHEN eintippen" });
  try {
    await deleteAccount(a.id);
  } catch (e) {
    if (e instanceof AccountDeleteError) back({ err: e.message });
    throw e;
  }
  await destroySession();
  redirect("/?deleted=1");
}
