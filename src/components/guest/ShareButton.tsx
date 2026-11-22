"use client";

/** Teilen per System-Dialog (Handy) mit WhatsApp-Fallback. */
export function ShareButton({ url, name }: { url: string; name: string }) {
  const text = `Dein QR-Code für den Einlass (${name}): ${url}`;
  return (
    <button
      type="button"
      onClick={async () => {
        if (navigator.share) {
          try {
            await navigator.share({ title: "QR-Code", text, url });
            return;
          } catch {
            /* abgebrochen */
          }
        }
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      }}
      className="min-h-11 shrink-0 border border-line-3 px-3 text-xs hover:border-accent"
    >
      teilen
    </button>
  );
}
