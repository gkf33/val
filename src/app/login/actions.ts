"use server";

import { redirect } from "next/navigation";
import { requestLogin } from "@/server/auth/login";
import { RateLimitError } from "@/server/auth/magicLink";

export async function guestLoginAction(formData: FormData) {
  try {
    await requestLogin(String(formData.get("email") ?? ""), "guest");
  } catch (e) {
    if (e instanceof RateLimitError) redirect("/login?limited=1");
    throw e;
  }
  redirect("/login?sent=1");
}
