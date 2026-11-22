"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";

type Reason = "valid" | "reentry" | "inside" | "unpaid" | "cancelled" | "wrong_party" | "unknown" | "blocked" | "invalid_code";

interface Result {
  ok: boolean;
  reason: Reason;
  message: string;
  guest?: { id: string; name: string; crew: boolean; role: string | null; status: string; via: string | null; group: string | null };
  checkedInAt?: string | null;
  checkedInDevice?: string | null;
  offline?: boolean;
}

interface CachedGuest {
  id: string;
  h: string;
  n: string;
  s: string;
  c: boolean;
  r: string | null;
}

interface OfflineOp {
  guestId: string;
  op: "in" | "out";
  at: string;
}

const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "");

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* Speicher voll oder gesperrt */
  }
}

export function Scanner({ code, deviceName, capacity, offlinePrimary }: { code: string; deviceName: string; capacity: number; offlinePrimary: boolean }) {
  const api = `/api/door/${code}`;
  const KEY_CACHE = `door:${code}:manifest`;
  const KEY_QUEUE = `door:${code}:queue`;

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const busyRef = useRef(false);

  const [result, setResult] = useState<Result | null>(null);
  const [online, setOnline] = useState(true);
  const [stats, setStats] = useState({ inside: 0, capacity });
  const [queue, setQueue] = useState<OfflineOp[]>([]);
  const [cacheInfo, setCacheInfo] = useState<{ count: number; at: string | null }>({ count: 0, at: null });
  const [torch, setTorch] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string; status: string; type?: string }[]>([]);
  const [acting, setActing] = useState(false);

  const cache = useCallback(() => load<{ generatedAt: string; guests: CachedGuest[] } | null>(KEY_CACHE, null), [KEY_CACHE]);

  // ── Netz, Statistik, Offline-Cache, Sync ────────────────
  const refresh = useCallback(async () => {
    try {
      const s = await fetch(`${api}/stats`, { cache: "no-store" });
      if (s.status === 401) {
        location.href = `/door/${code}`;
        return;
      }
      if (!s.ok) throw new Error();
      const data = await s.json();
      setStats({ inside: data.inside, capacity: data.capacity });
      setOnline(true);

      const pending = load<OfflineOp[]>(KEY_QUEUE, []);
      if (pending.length) {
        const r = await fetch(`${api}/sync`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ops: pending }) });
        if (r.ok) {
          save(KEY_QUEUE, []);
          setQueue([]);
        }
      }
      const m = await fetch(`${api}/manifest`, { cache: "no-store" });
      if (m.ok) {
        const mf = await m.json();
        save(KEY_CACHE, mf);
        setCacheInfo({ count: mf.guests.length, at: mf.generatedAt });
      }
    } catch {
      setOnline(false);
      const c = cache();
      if (c) {
        setCacheInfo({ count: c.guests.length, at: c.generatedAt });
        setStats((st) => ({ ...st, inside: c.guests.filter((g) => g.s === "checked_in").length }));
      }
    }
  }, [api, code, KEY_QUEUE, KEY_CACHE, cache]);

  useEffect(() => {
    setQueue(load<OfflineOp[]>(KEY_QUEUE, []));
    const c = cache();
    if (c) setCacheInfo({ count: c.guests.length, at: c.generatedAt });
    refresh();
    const t = setInterval(refresh, 5000);
    const on = () => refresh();
    window.addEventListener("online", on);
    window.addEventListener("offline", () => setOnline(false));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/door-sw.js", { scope: "/door/" }).catch(() => {});
    return () => {
      clearInterval(t);
      window.removeEventListener("online", on);
    };
  }, [refresh, KEY_QUEUE, cache]);

  // ── Offline-Auswertung ──────────────────────────────────
  const offlineLookup = useCallback(
    async (payload: string): Promise<Result> => {
      const c = cache();
      const token = (payload.trim().split("/").pop() ?? "").split(".")[0];
      if (!c || !token) return { ok: false, reason: "unknown", message: "Offline: kein Cache", offline: true };
      const h = await sha256Hex(token);
      const g = c.guests.find((x) => x.h === h);
      if (!g) return { ok: false, reason: "unknown", message: "Unbekannt (offline)", offline: true };
      return offlineResult(g);
    },
    [cache],
  );

  function offlineResult(g: CachedGuest): Result {
    const guest = { id: g.id, name: g.n, crew: g.c, role: g.r, status: g.s, via: null, group: null };
    if (g.s === "paid") return { ok: true, reason: "valid", message: g.c ? "Crew" : "Gültig (offline)", guest, offline: true };
    if (g.s === "checked_out") return { ok: true, reason: "reentry", message: "Wiedereinlass (offline)", guest, offline: true };
    return { ok: false, reason: "inside", message: "Bereits eingecheckt (offline)", guest, offline: true };
  }

  function updateCachedStatus(guestId: string, s: string) {
    const c = cache();
    if (!c) return;
    c.guests = c.guests.map((g) => (g.id === guestId ? { ...g, s } : g));
    save(KEY_CACHE, c);
  }

  // ── Scan ────────────────────────────────────────────────
  const handlePayload = useCallback(
    async (payload: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      let r: Result;
      try {
        const res = await fetch(`${api}/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }) });
        if (res.status === 401) {
          location.href = `/door/${code}`;
          return;
        }
        if (!res.ok) throw new Error();
        r = await res.json();
        setOnline(true);
      } catch {
        setOnline(false);
        r = await offlineLookup(payload);
      }
      navigator.vibrate?.(r.ok ? 60 : [80, 60, 80]);
      setResult(r);
    },
    [api, code, offlineLookup],
  );

  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
        if (!videoRef.current || stopped) return;
        controlsRef.current = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current,
          (res) => {
            if (res) handlePayload(res.getText());
          },
        );
      } catch (e) {
        setCamError(e instanceof Error && e.name === "NotAllowedError" ? "Kamera nicht erlaubt. In den Browser-Einstellungen freigeben." : "Kamera nicht verfügbar.");
      }
    })();
    return () => {
      stopped = true;
      controlsRef.current?.stop();
    };
  }, [handlePayload]);

  const close = () => {
    setResult(null);
    setSearching(false);
    setQ("");
    setHits([]);
    setTimeout(() => (busyRef.current = false), 400);
  };

  async function act(kind: "checkin" | "checkout") {
    if (!result?.guest || acting) return;
    setActing(true);
    const guestId = result.guest.id;
    try {
      const res = await fetch(`${api}/${kind}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guestId }) });
      if (!res.ok) throw new Error();
      const r: Result = await res.json();
      setResult(r);
      if (r.ok) {
        updateCachedStatus(guestId, kind === "checkin" ? "checked_in" : "checked_out");
        setStats((s) => ({ ...s, inside: s.inside + (kind === "checkin" ? 1 : -1) }));
        setTimeout(close, 900);
      }
    } catch {
      setOnline(false);
      if (!offlinePrimary) {
        setResult({ ...result, ok: false, message: "Offline: Einchecken nur am Hauptgerät" });
      } else {
        const op: OfflineOp = { guestId, op: kind === "checkin" ? "in" : "out", at: new Date().toISOString() };
        const next = [...load<OfflineOp[]>(KEY_QUEUE, []), op];
        save(KEY_QUEUE, next);
        setQueue(next);
        updateCachedStatus(guestId, kind === "checkin" ? "checked_in" : "checked_out");
        setStats((s) => ({ ...s, inside: s.inside + (kind === "checkin" ? 1 : -1) }));
        setResult({ ...result, ok: true, message: kind === "checkin" ? "Eingecheckt (offline)" : "Ausgecheckt (offline)" });
        setTimeout(close, 900);
      }
    } finally {
      setActing(false);
    }
  }

  async function toggleTorch() {
    const next = !torch;
    try {
      await controlsRef.current?.switchTorch?.(next);
      setTorch(next);
    } catch {
      /* nicht unterstützt (z. B. iOS) */
    }
  }

  async function runSearch(term: string) {
    setQ(term);
    if (term.trim().length < 2) return setHits([]);
    try {
      const r = await fetch(`${api}/search?q=${encodeURIComponent(term)}`);
      if (!r.ok) throw new Error();
      setHits(await r.json());
    } catch {
      const c = cache();
      const t = term.toLowerCase();
      setHits((c?.guests ?? []).filter((g) => g.n.toLowerCase().includes(t)).slice(0, 20).map((g) => ({ id: g.id, name: g.n, status: g.s })));
    }
  }

  async function pick(id: string) {
    busyRef.current = true;
    try {
      const r = await fetch(`${api}/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ guestId: id }) });
      if (!r.ok) throw new Error();
      setResult(await r.json());
    } catch {
      const g = cache()?.guests.find((x) => x.id === id);
      setResult(g ? offlineResult(g) : { ok: false, reason: "unknown", message: "Unbekannt", offline: true });
    }
    setSearching(false);
  }

  const green = result?.ok && (result.reason === "valid" || result.reason === "reentry");
  const canCheckIn = !!result?.guest && (result.reason === "valid" || result.reason === "reentry") && result.ok;
  const canCheckOut = !!result?.guest && result.reason === "inside";

  return (
    <div className="flex h-dvh flex-col font-mono select-none">
      <header className="flex items-center justify-between border-b border-[#262626] px-5 py-3">
        <div>
          <p className="text-[11px] text-[#8c8c8c]">DRINNEN</p>
          <p className="text-[26px] leading-tight font-bold" data-testid="inside">
            {stats.inside} <span className="font-normal text-[#8c8c8c]">/ {stats.capacity}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-[11px] text-[#8c8c8c]">
          <span>{deviceName}{offlinePrimary ? " · offline ✓" : ""}</span>
          <span className={online ? "text-[#4ade80]" : "text-[#f5a524]"}>● {online ? "online" : "offline"}</span>
          <span>{cacheInfo.count} im Cache{queue.length ? ` · ${queue.length} ungesynct` : ""}</span>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {!result && !searching && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="size-60 border-2 border-[#f2f2f2]/70" />
          </div>
        )}
        {camError && !result && (
          <p className="absolute inset-x-5 top-5 border border-[#f5a524] bg-black p-3 text-sm text-[#f5a524]">▲ {camError} Namenssuche nutzen.</p>
        )}

        {result && (
          <div
            className={`absolute inset-0 flex flex-col gap-3 p-5 ${green ? "bg-[#16a34a] text-black" : "bg-[#b91c1c] text-white"}`}
            role="status"
            aria-live="assertive"
            data-testid="result"
          >
            <p className="flex items-center gap-2 text-sm font-bold tracking-[0.15em] uppercase">
              {green ? "✓" : "✕"} {result.message}
            </p>
            {result.guest && <p className="text-[40px] leading-[1.05] font-bold break-words">{result.guest.name}</p>}
            <div className="flex flex-wrap gap-2 text-xs">
              {result.guest?.crew && <span className="bg-black px-2.5 py-1.5 font-bold text-[#f2f2f2]">CREW{result.guest.role ? ` · ${result.guest.role}` : ""}</span>}
              {result.guest?.via && <span className="bg-black px-2.5 py-1.5 text-[#4ade80]">via {result.guest.via}</span>}
              {result.guest?.group && <span className="bg-black px-2.5 py-1.5 text-[#f2f2f2]">gruppe {result.guest.group}</span>}
            </div>
            {result.reason === "inside" && result.checkedInAt && (
              <p className="text-base">
                seit {time(result.checkedInAt)} · {result.checkedInDevice}
              </p>
            )}
            {green && (
              <div className="mt-auto bg-black/85 p-4 text-[#f2f2f2]">
                <p className="text-base font-bold">AUSWEIS PRÜFEN</p>
                <p className="text-sm text-[#c8c8c8]">Name stimmt? 18+?</p>
              </div>
            )}
          </div>
        )}

        {searching && !result && (
          <div className="absolute inset-0 flex flex-col gap-3 bg-black p-5">
            <label htmlFor="door-search" className="text-xs text-[#8c8c8c]">Name suchen</label>
            <input
              id="door-search"
              autoFocus
              value={q}
              onChange={(e) => runSearch(e.target.value)}
              className="border border-[#333] bg-[#111] px-3 py-3 text-lg outline-none focus:border-[#f2f2f2]"
            />
            <ul className="flex flex-col divide-y divide-[#262626] overflow-y-auto">
              {hits.map((h) => (
                <li key={h.id}>
                  <button onClick={() => pick(h.id)} className="flex min-h-14 w-full items-center justify-between text-left text-lg">
                    <span>{h.name}</span>
                    <span className="text-xs text-[#8c8c8c]">{h.type === "crew" ? "crew · " : ""}{h.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="flex flex-col gap-2.5 bg-black px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {canCheckIn && (
          <button onClick={() => act("checkin")} disabled={acting} className="min-h-16 bg-[#f2f2f2] text-xl font-bold tracking-[0.15em] text-black disabled:opacity-60">
            EINCHECKEN
          </button>
        )}
        {canCheckOut && (
          <button onClick={() => act("checkout")} disabled={acting} className="min-h-16 bg-[#f2f2f2] text-xl font-bold tracking-[0.15em] text-black disabled:opacity-60">
            AUSCHECKEN
          </button>
        )}
        <div className="grid grid-cols-3 gap-2.5">
          <button onClick={close} className="min-h-12 border border-[#333] bg-[#111] text-sm">
            {result || searching ? "zurück" : "—"}
          </button>
          <button onClick={toggleTorch} aria-pressed={torch} className={`min-h-12 border text-sm ${torch ? "border-[#f2f2f2] bg-[#f2f2f2] text-black" : "border-[#333] bg-[#111]"}`}>
            licht
          </button>
          <button
            onClick={() => {
              setResult(null);
              setSearching(true);
              busyRef.current = true;
            }}
            className="min-h-12 border border-[#333] bg-[#111] text-sm"
          >
            suche
          </button>
        </div>
      </footer>
    </div>
  );
}
