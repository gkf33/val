"use server";

import { redirect } from "next/navigation";
import { completeLogin } from "@/server/auth/login";
import { createSession, destroySession } from "@/server/auth/session";

export async function verifyAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const result = await completeLogin(token);
  if (!result) redirect("/auth/verify?invalid=1");
  await createSession(result.account.id);
  redirect(result.redirect);
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
