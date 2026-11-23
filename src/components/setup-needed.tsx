export const SetupNeeded = () => (
  <section className="xp-card mx-auto max-w-2xl">
    <p className="xp-eyebrow">Falta el índice</p>
    <h1 className="xp-page-title">Todavía no hay datos locales</h1>
    <p className="xp-lead">
      Faro lee un índice SQLite que se construye a partir de los CSV del repositorio
      JaimeObregon/subvenciones. El volcado no se envía al navegador.
    </p>
    <pre className="mt-4 overflow-x-auto border border-line bg-ink px-3 py-2 text-sm text-paper">
      <code>pnpm data && pnpm dev</code>
    </pre>
  </section>
);

export const PageIntro = ({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) => (
  <header className="xp-page-intro">
    <p className="xp-eyebrow">{eyebrow}</p>
    <h1 className="xp-page-title">{title}</h1>
    {children ? <div className="xp-lead">{children}</div> : null}
  </header>
);

export const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <p className="xp-empty">{children}</p>
);
