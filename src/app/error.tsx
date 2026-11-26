"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const ErrorView = ({ reset }: { error: Error; reset: () => void }) => (
  <section className="mx-auto my-10 max-w-lg rounded-xl border border-terra-border bg-elev p-6 shadow-xs">
    <div className="flex items-start gap-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-terra-soft text-terra">
        <AlertCircle aria-hidden="true" size={20} />
      </span>
      <div>
        <h1 className="font-display text-lg font-bold text-ink">No se ha podido cargar esta vista</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          La consulta al índice local ha fallado. Puedes reintentar. Si acabas de reconstruir los datos, recarga la
          página.
        </p>
        <Button type="button" onClick={reset} className="mt-4">
          Reintentar
        </Button>
      </div>
    </div>
  </section>
);

export default ErrorView;
