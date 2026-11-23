import Link from "next/link";

const InfoIcon = () => (
  <svg className="xp-icon" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="13" fill="#3b7ddd" stroke="#000" strokeWidth="1.2" />
    <rect x="14.6" y="8" width="2.8" height="2.8" fill="#fff" />
    <rect x="14.6" y="13" width="2.8" height="10" fill="#fff" />
  </svg>
);

const NotFound = () => (
  <section className="xp-balloon max-w-xl">
    <InfoIcon />
    <div>
      <h1 className="xp-balloon-title">No está en este volcado</h1>
      <p className="mt-1">
        Ese identificador no aparece en el índice local. Puede que el registro no formara parte del scrape o que el enlace esté incompleto.
      </p>
      <Link href="/" className="xp-button xp-button-primary mt-3">
        Volver al panel
      </Link>
    </div>
  </section>
);

export default NotFound;
