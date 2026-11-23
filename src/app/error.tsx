"use client";

const ErrorIcon = () => (
  <svg className="xp-icon" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="13" fill="#e24b4b" stroke="#000" strokeWidth="1.2" />
    <path d="M10.5 10.5 21.5 21.5M21.5 10.5 10.5 21.5" stroke="#fff" strokeWidth="2.4" />
  </svg>
);

const ErrorView = ({ reset }: { error: Error; reset: () => void }) => (
  <section className="xp-balloon max-w-xl">
    <ErrorIcon />
    <div>
      <h1 className="xp-balloon-title">No se ha podido cargar esta vista</h1>
      <p className="mt-1">
        La consulta al índice local ha fallado. Puedes reintentar. Si acabas de reconstruir los datos, recarga la página.
      </p>
      <button type="button" onClick={reset} className="xp-button xp-button-primary mt-3">
        Reintentar
      </button>
    </div>
  </section>
);

export default ErrorView;
