"use server";

import { redirect } from "next/navigation";
import { redeemToken } from "@/server/auth/redeem";
import { createSession, destroySession } from "@/server/auth/session";

export async function verifyAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const result = await redeemToken(token);
  if (!result) redirect("/auth/verify?invalid=1");
  await createSession(result.accountId);
  redirect(result.redirect);
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
