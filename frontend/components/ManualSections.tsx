/** Generic reader for the Study manuals: sections come from the i18n
 * dictionary (title + body). Body blocks split on blank lines; a block
 * whose every line starts with "- " renders as a list. No markdown
 * parser, no dependency. */

export type ManualSection = { title: string; body: string };

function renderBody(body: string) {
  return body.split("\n\n").map((block, i) => {
    const lines = block.split("\n");
    if (lines.length > 0 && lines.every((l) => l.startsWith("- "))) {
      return (
        <ul key={i} className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-300">
          {lines.map((l, j) => (
            <li key={j}>{l.slice(2)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i} className="text-sm leading-relaxed text-zinc-300">
        {block}
      </p>
    );
  });
}

export function ManualSections({ sections, warning }: { sections: ManualSection[]; warning?: string }) {
  return (
    <div className="space-y-6">
      {warning && (
        <p role="note" className="rounded-xl border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-sm font-semibold leading-relaxed text-amber-200">
          {warning}
        </p>
      )}
      {sections.map((s) => (
        <section key={s.title} className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-4 sm:px-5">
          <h2 className="mb-3 text-base font-bold text-zinc-100">{s.title}</h2>
          <div className="space-y-3">{renderBody(s.body)}</div>
        </section>
      ))}
    </div>
  );
}
