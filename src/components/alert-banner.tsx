import { AlertTriangle, ChevronRight } from "lucide-react";

export type MethodologyItem = {
  label: string;
  text: string;
};

type AlertBannerProps = {
  children: React.ReactNode;
  title?: string;
  methodology?: MethodologyItem[];
  methodologyLabel?: string;
};

export const AlertBanner = ({
  children,
  title = "Indicador, no prueba",
  methodology,
  methodologyLabel = "Cómo se calcula y límites",
}: AlertBannerProps) => {
  const hasMethodology = Boolean(methodology && methodology.length > 0);

  return (
    <div
      className="mb-5 flex items-start gap-3 rounded-xl border border-terra-border bg-terra-soft px-4 py-3 text-sm text-ink shadow-2xs"
      role="note"
    >
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-terra/15 text-terra">
        <AlertTriangle aria-hidden="true" size={14} />
      </span>
      <div className="min-w-0 flex-1 leading-relaxed">
        <p>
          <span className="font-semibold text-terra">{title}. </span>
          <span className="text-ink/90">{children}</span>
        </p>
        {hasMethodology ? (
          <details className="group mt-2.5 border-t border-terra-border/80 pt-2">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-xs font-semibold text-terra transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                size={14}
                className="shrink-0 transition-transform duration-150 group-open:rotate-90"
              />
              <span>{methodologyLabel}</span>
            </summary>
            <dl className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {methodology?.map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-terra-border/70 bg-elev/85 px-3 py-2.5 text-xs leading-relaxed"
                >
                  <dt className="font-semibold text-ink">{item.label}</dt>
                  <dd className="mt-1 text-muted">{item.text}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </div>
    </div>
  );
};
