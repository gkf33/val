import { NextResponse } from "next/server";
import { DoorError, checkIn, checkOut, doorStats, getDevice, lookupGuest, manifest, scan, search, syncOffline, type SyncOp } from "@/server/door";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string; action: string }> };

async function device(ctx: Ctx) {
  const { code, action } = await ctx.params;
  return { d: await getDevice(code), action };
}

const unauthorized = () => NextResponse.json({ error: "Gerät nicht registriert oder Zugang abgelaufen" }, { status: 401 });

export async function GET(req: Request, ctx: Ctx) {
  const { d, action } = await device(ctx);
  if (!d) return unauthorized();
  const url = new URL(req.url);
  switch (action) {
    case "stats":
      return NextResponse.json(await doorStats(d.partyId));
    case "search":
      return NextResponse.json(await search(d, url.searchParams.get("q") ?? ""));
    case "manifest":
      return NextResponse.json(await manifest(d));
    default:
      return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { d, action } = await device(ctx);
  if (!d) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { payload?: string; guestId?: string; ops?: SyncOp[] };
  try {
    switch (action) {
      case "scan":
        return NextResponse.json(await scan(d, String(body.payload ?? "")));
      case "guest":
        return NextResponse.json(await lookupGuest(d, String(body.guestId ?? "")));
      case "checkin":
        return NextResponse.json(await checkIn(d, String(body.guestId ?? "")));
      case "checkout":
        return NextResponse.json(await checkOut(d, String(body.guestId ?? "")));
      case "sync":
        return NextResponse.json(await syncOffline(d, Array.isArray(body.ops) ? body.ops : []));
      default:
        return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  } catch (e) {
    if (e instanceof DoorError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
