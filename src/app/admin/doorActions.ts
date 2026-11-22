"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { DoorError, createDoorLink, revokeDevice, revokeDoorLink, setOfflinePrimary } from "@/server/door";

async function actor() {
  const a = await requireAdmin();
  return { type: "admin" as const, label: a.email };
}

export async function createDoorLinkAction(partyId: string, fd: FormData) {
  const a = await actor();
  try {
    await createDoorLink(a, partyId, String(fd.get("pin") ?? ""));
  } catch (e) {
    if (e instanceof DoorError) redirect(`/admin/parties/${partyId}?doorErr=${encodeURIComponent(e.message)}#einlass`);
    throw e;
  }
  revalidatePath(`/admin/parties/${partyId}`);
}

export async function revokeDoorLinkAction(partyId: string, linkId: string) {
  await revokeDoorLink(await actor(), linkId);
  revalidatePath(`/admin/parties/${partyId}`);
}

export async function revokeDeviceAction(partyId: string, deviceId: string) {
  await revokeDevice(await actor(), deviceId);
  revalidatePath(`/admin/parties/${partyId}`);
}

export async function setOfflinePrimaryAction(partyId: string, deviceId: string) {
  await setOfflinePrimary(await actor(), deviceId);
  revalidatePath(`/admin/parties/${partyId}`);
}
