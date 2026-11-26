import Link from "next/link";
import { Search } from "lucide-react";
import { AlertSubNav, PrimaryNav } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";

const BrandMark = () => (
  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink shadow-xs">
    <svg className="size-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5 9.65 6.2H14.5l-3.9 2.85 1.5 4.75L8 10.95 3.9 13.8l1.5-4.75L1.5 6.2h4.85z" />
    </svg>
  </span>
);

const SearchForm = () => (
  <form action="/buscar" role="search" className="relative flex w-full items-center lg:w-72">
    <label htmlFor="q-global" className="sr-only">
      Buscar convocatoria, organismo o NIF
    </label>
    <Search
      aria-hidden="true"
      size={15}
      className="pointer-events-none absolute left-3 text-muted"
    />
    <input
      id="q-global"
      name="q"
      type="search"
      placeholder="Buscar ayudas, organismos o NIF…"
      className="h-9 w-full rounded-lg border border-line-strong bg-paper/80 pr-3 pl-9 text-sm text-ink placeholder:text-muted/75 transition-colors focus-visible:border-accent focus-visible:bg-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20"
    />
  </form>
);

const Credits = () => (
  <footer className="mt-16 border-t border-line bg-elev/70">
    <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
      <p>
        Datos del volcado abierto de{" "}
        <a
          href="https://github.com/JaimeObregon/subvenciones"
          className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
        >
          Jaime Obregón
        </a>
        . Fuente oficial:{" "}
        <a
          href="https://www.infosubvenciones.es"
          className="font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:text-accent hover:decoration-accent"
        >
          Base de Datos Nacional de Subvenciones
        </a>
        .
      </p>
      <p className="text-muted/80">Faro · Explorador ciudadano de la BDNS</p>
    </div>
  </footer>
);

export const SiteFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-screen flex-col bg-paper text-ink">
    <header className="sticky top-0 z-40 border-b border-line bg-elev/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:flex-nowrap lg:px-8">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <BrandMark />
          <div className="leading-tight">
            <p className="font-display text-base font-bold tracking-tight text-ink group-hover:text-accent transition-colors">
              Faro
            </p>
            <p className="text-[11px] font-medium text-muted">Visor de la BDNS</p>
          </div>
        </Link>

        <div className="order-3 w-full overflow-x-auto lg:order-2 lg:w-auto lg:flex-1">
          <PrimaryNav />
        </div>

        <div className="order-2 ml-auto flex flex-1 items-center justify-end gap-2 sm:flex-initial lg:order-3">
          <SearchForm />
          <ThemeToggle />
        </div>
      </div>

      <AlertSubNav />
    </header>

    <main id="contenido" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
      {children}
    </main>

    <Credits />
  </div>
);
