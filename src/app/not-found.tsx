import Link from "next/link";
import { FileQuestion } from "lucide-react";

const NotFound = () => (
  <section className="mx-auto my-10 max-w-lg rounded-xl border border-line bg-elev p-6 shadow-xs">
    <div className="flex items-start gap-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <FileQuestion aria-hidden="true" size={20} />
      </span>
      <div>
        <h1 className="font-display text-lg font-bold text-ink">No está en este volcado</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Ese identificador no aparece en el índice local. Puede que el registro no formara parte del scrape o que el
          enlace esté incompleto.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink shadow-xs transition-colors hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Volver al panel
        </Link>
      </div>
    </div>
  </section>
);

export default NotFound;
