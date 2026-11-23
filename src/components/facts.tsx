export const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="xp-fact">
    <dt className="text-muted">{label}</dt>
    <dd>{value}</dd>
  </div>
);

export const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="xp-link">
    {children}
    <span className="sr-only"> (se abre en una pestaña nueva)</span>
  </a>
);

export const Kpi = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <article className="xp-kpi">
    <p className="xp-kpi-label">{label}</p>
    <p className="xp-kpi-value">{value}</p>
    {hint ? <p className="mt-1 text-muted">{hint}</p> : null}
  </article>
);
