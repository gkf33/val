import { notFound, redirect } from "next/navigation";
import { getDevice, getDoorLink } from "@/server/door";
import { config } from "@/server/config";
import { formatDateTime } from "@/domain/time";
import { registerDeviceAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DoorLogin({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ err?: string }> }) {
  const { code } = await params;
  const { err } = await searchParams;
  const link = await getDoorLink(code);
  if (!link) notFound();
  if (await getDevice(code)) redirect(`/door/${code}/scan`);
  const tz = config.timeZone;
  const field = "w-full border border-[#333] bg-[#111] px-3 py-3 text-lg text-[#f2f2f2] outline-none focus:border-[#f2f2f2]";
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5">
      <p className="text-xs text-[#8c8c8c]">PS&gt; door --register</p>
      <h1 className="text-2xl font-bold">Einlass</h1>
      <p className="text-sm text-[#a6a6a6]">
        Gültig {link.validFrom ? formatDateTime(link.validFrom, tz) : "?"} – {link.validTo ? formatDateTime(link.validTo, tz) : "?"}
      </p>
      {!link.active && <p className="text-sm text-[#f5a524]">▲ Link widerrufen.</p>}
      <form action={registerDeviceAction.bind(null, code)} className="flex flex-col gap-4">
        <label htmlFor="name" className="text-xs text-[#8c8c8c]">Gerätename</label>
        <input id="name" name="name" defaultValue="Scanner 1" required maxLength={40} className={field} />
        <label htmlFor="pin" className="text-xs text-[#8c8c8c]">PIN</label>
        <input id="pin" name="pin" inputMode="numeric" pattern="\d{4,8}" autoComplete="one-time-code" required className={`${field} tracking-[0.4em]`} />
        {err && <p className="text-sm text-[#f5a524]">▲ {err}</p>}
        <button className="min-h-14 bg-[#f2f2f2] text-lg font-bold tracking-widest text-black">STARTEN</button>
      </form>
    </main>
  );
}
