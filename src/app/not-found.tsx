import Link from "next/link";

const NotFound = () => (
  <section className="max-w-xl">
    <h1 className="font-display text-4xl">No está en este volcado</h1>
    <p className="mt-3 text-lg text-muted">
      Ese identificador no aparece en el índice local. Puede que el registro no formara parte del scrape o que el enlace esté incompleto.
    </p>
    <Link href="/" className="mt-6 inline-flex rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">
      Volver al panel
    </Link>
  </section>
);

export default NotFound;
