"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="min-h-11 border border-black px-4 text-sm print:hidden">
      Drucken / als PDF speichern
    </button>
  );
}
