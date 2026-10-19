export function DemoBadge() {
  return (
    <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold tracking-widest text-amber-400 ring-1 ring-inset ring-amber-500/40">
      DEMO
    </span>
  );
}

export function StatusDot({ on, red = false }: { on: boolean; red?: boolean }) {
  const color = red && on ? "bg-red-500" : on ? "bg-emerald-500" : "bg-zinc-600";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />;
}

export function EmptyState({ text }: { text: string }) {
  return <p className="py-6 text-center text-sm text-zinc-500">{text}</p>;
}
