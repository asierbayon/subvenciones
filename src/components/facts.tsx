import { ExternalLink as ExternalLinkIcon } from "lucide-react";

export const Fact = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-xl border border-line bg-elev p-4 shadow-2xs">
    <dt className="text-xs font-medium text-muted">{label}</dt>
    <dd className="mt-1 text-sm font-semibold text-ink">{value}</dd>
  </div>
);

export const ExternalLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="inline-flex items-center gap-1 font-medium text-accent underline decoration-accent/35 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent"
  >
    <span>{children}</span>
    <ExternalLinkIcon aria-hidden="true" size={12} className="shrink-0 opacity-75" />
    <span className="sr-only"> (se abre en una pestaña nueva)</span>
  </a>
);

export const Kpi = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <article className="rounded-xl border border-line bg-elev p-5 shadow-2xs transition-colors hover:border-line-strong">
    <p className="text-xs font-semibold tracking-wider text-muted uppercase">{label}</p>
    <p className="mt-2 font-display text-2xl font-bold tracking-tight text-ink tabular-nums sm:text-3xl">
      {value}
    </p>
    {hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
  </article>
);
