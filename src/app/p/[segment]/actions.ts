"use server";

import { redirect } from "next/navigation";
import { resolvePartyLink } from "@/server/parties";
import { BookingError, submitBookingRequest } from "@/server/bookings";
import { RateLimitError } from "@/server/auth/magicLink";

export type RequestFormState = { errors?: Record<string, string> };

export async function submitRequestAction(segment: string, _prev: RequestFormState, fd: FormData): Promise<RequestFormState> {
  const link = await resolvePartyLink(segment);
  if (!link) return { errors: { form: "Link ungültig" } };
  let companions: { name: string; email?: string; gender?: string; adult: boolean }[] = [];
  try {
    const raw = JSON.parse(String(fd.get("companions") ?? "[]"));
    if (Array.isArray(raw)) {
      companions = raw.slice(0, 20).map((c) => ({
        name: String(c?.name ?? ""),
        email: String(c?.email ?? ""),
        gender: String(c?.gender ?? ""),
        adult: c?.adult === true,
      }));
    }
  } catch {
    return { errors: { form: "Ungültige Eingabe" } };
  }
  try {
    await submitBookingRequest(link, {
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      gender: String(fd.get("gender") ?? ""),
      adult: fd.get("adult") === "on",
      notAttending: fd.get("notAttending") === "on",
      privacy: fd.get("privacy") === "on",
      companions,
    });
  } catch (e) {
    if (e instanceof BookingError) return { errors: e.errors };
    if (e instanceof RateLimitError) return { errors: { form: "Zu viele Versuche. Kurz warten." } };
    throw e;
  }
  redirect(`/p/${segment}?sent=1`);
}
