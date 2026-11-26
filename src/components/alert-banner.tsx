import { AlertTriangle } from "lucide-react";

export const AlertBanner = ({ children }: { children: React.ReactNode }) => (
  <div
    className="mb-6 flex items-start gap-3.5 rounded-xl border border-terra-border bg-terra-soft px-4 py-3.5 text-sm text-ink shadow-2xs"
    role="note"
  >
    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-terra/15 text-terra">
      <AlertTriangle aria-hidden="true" size={16} />
    </span>
    <div className="min-w-0 leading-relaxed">
      <p className="font-semibold text-terra">Indicador, no prueba</p>
      <p className="mt-0.5 text-ink/90">{children}</p>
    </div>
  </div>
);
