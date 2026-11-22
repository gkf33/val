"use server";

import { redirect } from "next/navigation";
import { DoorError, registerDevice } from "@/server/door";

export async function registerDeviceAction(code: string, fd: FormData) {
  try {
    await registerDevice(code, String(fd.get("pin") ?? ""), String(fd.get("name") ?? ""));
  } catch (e) {
    if (e instanceof DoorError) redirect(`/door/${code}?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/door/${code}/scan`);
}
