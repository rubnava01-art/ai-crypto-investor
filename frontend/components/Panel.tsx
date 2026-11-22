import React from "react";

export function Panel({ title, badge, children, accent }: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className={`fintech-card p-5 sm:p-6 ${
        accent ? "border-red-800/60" : ""
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="min-w-0 flex-1 text-sm font-semibold uppercase leading-6 tracking-wider text-slate-200">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}
