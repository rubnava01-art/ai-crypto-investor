import React from "react";

export function Panel({ title, badge, children, accent }: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border bg-zinc-900/70 p-5 shadow-sm sm:p-6 ${
        accent ? "border-red-800/60" : "border-zinc-800"
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="min-w-0 flex-1 text-sm font-semibold uppercase leading-6 tracking-wider text-zinc-200">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}
