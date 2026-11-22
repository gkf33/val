import type { ComponentProps, ReactNode } from "react";

export function Prompt({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">PS&gt; {children}</p>;
}

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-xs text-fg-2">
      {children}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={`w-full rounded-[2px] border border-line-2 bg-surface-2 px-3 py-3 text-[15px] text-fg outline-none placeholder:text-faint focus:border-accent ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={`w-full rounded-[2px] border border-line-2 bg-surface-2 px-3 py-3 text-[15px] text-fg outline-none placeholder:text-faint focus:border-accent ${props.className ?? ""}`}
    />
  );
}

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted">{hint}</p>}
      {error && <p className="text-xs text-warn">▲ {error}</p>}
    </div>
  );
}

export function PrimaryButton(props: ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={`min-h-[52px] bg-accent px-5 text-[15px] font-bold tracking-wider text-on-accent hover:bg-accent-2 disabled:opacity-50 ${props.className ?? ""}`}
    />
  );
}

export function GhostButton(props: ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={`min-h-11 border border-line-3 px-4 text-sm text-fg hover:border-accent ${props.className ?? ""}`}
    />
  );
}
