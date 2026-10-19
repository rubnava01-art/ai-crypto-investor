import React from "react";

export function Panel({ title, badge, children, accent }: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className={`rounded-xl border bg-zinc-900/70 p-4 sm:p-5 ${
        accent ? "border-red-800/60" : "border-zinc-800"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}
