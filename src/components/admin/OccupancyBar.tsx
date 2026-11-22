export interface Occupancy {
  capacity: number;
  paid: number;
  unpaid: number;
  crew: number;
}

export function OccupancyBar({ o }: { o: Occupancy }) {
  const occupied = o.paid + o.unpaid + o.crew;
  const pct = (n: number) => `${o.capacity ? (n / o.capacity) * 100 : 0}%`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between text-xs text-muted">
        <span>Belegt</span>
        <span>
          <span className="text-sm text-fg">{occupied}</span> / {o.capacity} · frei {Math.max(0, o.capacity - occupied)}
        </span>
      </div>
      <div className="flex h-2 bg-line" role="img" aria-label={`${occupied} von ${o.capacity} Plätzen belegt`}>
        <div className="bg-accent" style={{ width: pct(o.paid) }} />
        <div className="bg-accent-dim" style={{ width: pct(o.unpaid) }} />
        <div className="bg-fg-2" style={{ width: pct(o.crew) }} />
      </div>
      <div className="flex flex-wrap gap-4 text-[11px] text-muted">
        <span><span className="text-accent">■</span> bezahlt {o.paid}</span>
        <span><span className="text-accent-dim">■</span> unbezahlt {o.unpaid}</span>
        <span><span className="text-fg-2">■</span> Crew {o.crew}</span>
      </div>
    </div>
  );
}
