"use client";

import { useState } from "react";

export function CopyButton({ value, label = "Kopieren", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className={className ?? "min-h-11 shrink-0 border border-line-3 px-3 text-xs text-fg hover:border-accent"}
    >
      {done ? "Kopiert ✓" : label}
    </button>
  );
}
