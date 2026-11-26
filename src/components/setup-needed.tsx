export const SetupNeeded = () => (
  <section className="mx-auto max-w-2xl rounded-xl border border-line bg-elev p-6 shadow-xs">
    <p className="text-xs font-semibold tracking-wider text-accent uppercase">Falta el índice</p>
    <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">
      Todavía no hay datos locales
    </h1>
    <p className="mt-2.5 text-sm leading-relaxed text-muted">
      Faro lee un índice SQLite que se construye a partir de los CSV del repositorio
      JaimeObregon/subvenciones. El volcado no se envía al navegador.
    </p>
    <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-ink px-4 py-3 font-mono text-sm text-paper">
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
  <header className="mb-6 max-w-3xl">
    <p className="text-xs font-semibold tracking-wider text-accent uppercase">{eyebrow}</p>
    <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
      {title}
    </h1>
    {children ? (
      <div className="mt-2.5 space-y-2 text-sm leading-relaxed text-muted sm:text-[15px]">
        {children}
      </div>
    ) : null}
  </header>
);

export const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-xl border border-dashed border-line-strong bg-elev/60 px-6 py-10 text-center text-sm text-muted">
    {children}
  </p>
);
