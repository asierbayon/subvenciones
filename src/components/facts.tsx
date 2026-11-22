export const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-2xl border border-line bg-elev px-4 py-3">
    <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</dt>
    <dd className="mt-1 text-sm leading-snug font-semibold text-ink">{value}</dd>
  </div>
);

export const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="font-semibold text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
  >
    {children}
    <span className="sr-only"> (se abre en una pestaña nueva)</span>
  </a>
);

export const Kpi = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <article className="rounded-3xl border border-line bg-elev p-5">
    <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
    <p className="mt-2 font-display text-3xl tracking-tight text-ink md:text-4xl">{value}</p>
    {hint ? <p className="mt-2 text-sm text-muted">{hint}</p> : null}
  </article>
);
