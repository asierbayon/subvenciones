export const SetupNeeded = () => (
  <section className="mx-auto max-w-2xl rounded-3xl border border-line bg-elev p-8">
    <p className="text-sm font-semibold tracking-wide text-terra uppercase">Falta el índice</p>
    <h1 className="mt-2 font-display text-4xl text-ink">Todavía no hay datos locales</h1>
    <p className="mt-4 text-lg leading-relaxed text-muted">
      Faro lee un índice SQLite que se construye a partir de los CSV del repositorio
      JaimeObregon/subvenciones. El volcado no se envía al navegador.
    </p>
    <pre className="mt-6 overflow-x-auto rounded-2xl bg-ink px-4 py-3 text-sm text-paper">
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
    <p className="text-sm font-semibold tracking-wide text-accent uppercase">{eyebrow}</p>
    <h1 className="mt-1 font-display text-4xl tracking-tight text-ink md:text-5xl">{title}</h1>
    {children ? <div className="mt-3 text-lg leading-relaxed text-muted">{children}</div> : null}
  </header>
);

export const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-2xl border border-dashed border-line bg-elev px-4 py-8 text-center text-muted">{children}</p>
);
