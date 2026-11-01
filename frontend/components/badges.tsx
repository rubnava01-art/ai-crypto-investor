export function DemoBadge() {
  return (
    <span className="inline-flex shrink-0 select-none items-center whitespace-nowrap rounded-md bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold leading-none tracking-widest text-amber-400 ring-1 ring-inset ring-amber-500/40">
      DEMO
    </span>
  );
}

export function StatusDot({ on, red = false }: { on: boolean; red?: boolean }) {
  const color = red && on ? "bg-red-500" : on ? "bg-emerald-500" : "bg-zinc-600";
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-white/10 ${color}`} aria-hidden />;
}

export function EmptyState({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm leading-relaxed text-zinc-500">{text}</p>;
}
