"use client";

const ErrorView = ({ reset }: { error: Error; reset: () => void }) => (
  <section className="max-w-xl rounded-3xl border border-line bg-elev p-8">
    <h1 className="font-display text-3xl">No se ha podido cargar esta vista</h1>
    <p className="mt-3 text-muted">
      La consulta al índice local ha fallado. Puedes reintentar. Si acabas de reconstruir los datos, recarga la página.
    </p>
    <button
      type="button"
      onClick={reset}
      className="mt-5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink"
    >
      Reintentar
    </button>
  </section>
);

export default ErrorView;
