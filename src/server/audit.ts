import type { ActorType, Prisma } from "@prisma/client";
import type { Db } from "./db";
import { prisma } from "./db";

export interface Actor {
  type: ActorType;
  label: string;
}

export const SYSTEM: Actor = { type: "system", label: "system" };

export async function audit(
  actor: Actor,
  action: string,
  opts: {
    entityType?: string;
    entityId?: string;
    partyId?: string;
    data?: Prisma.InputJsonValue;
    db?: Db;
  } = {},
): Promise<void> {
  const db = opts.db ?? prisma;
  await db.auditLog.create({
    data: {
      actorType: actor.type,
      actorLabel: actor.label,
      action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      partyId: opts.partyId,
      data: opts.data,
    },
  });
}
