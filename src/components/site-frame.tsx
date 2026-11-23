import { Search } from "lucide-react";
import Link from "next/link";
import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { XpWindow } from "@/components/xp-window";

export const SiteFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="mx-auto grid min-h-screen max-w-[1400px] md:grid-cols-[240px_1fr]">
    <aside className="border-b border-line bg-sidebar/80 px-4 py-4 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0 md:px-5 md:py-6">
      <div className="mb-4 flex items-start justify-between gap-3 md:mb-8 md:block">
        <Link href="/" className="group block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <span className="font-display text-3xl leading-none tracking-tight text-ink">Faro</span>
          <span className="mt-1 block text-sm text-muted">Visor de la BDNS</span>
        </Link>
        <div className="md:hidden">
          <ThemeToggle />
        </div>
      </div>
      <NavLinks />
      <p className="mt-6 hidden text-xs leading-relaxed text-muted md:block">
        Datos del volcado abierto de{" "}
        <a className="underline decoration-line underline-offset-2 hover:text-ink" href="https://github.com/JaimeObregon/subvenciones">
          Jaime Obregón
        </a>
        . Fuente oficial: la{" "}
        <a className="underline decoration-line underline-offset-2 hover:text-ink" href="https://www.infosubvenciones.es">
          Base de Datos Nacional de Subvenciones
        </a>
        .
      </p>
    </aside>
    <div className="min-w-0">
      <header className="sticky top-0 z-20 border-b border-line/80 bg-paper/90 px-4 py-3 backdrop-blur md:px-8">
        <div className="flex items-center gap-3">
          <form action="/buscar" role="search" className="relative min-w-0 flex-1">
            <label htmlFor="q-global" className="sr-only">
              Buscar convocatorias, organismos o beneficiarios
            </label>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              id="q-global"
              name="q"
              type="search"
              placeholder="Busca una convocatoria, un organismo o un NIF"
              className="h-11 w-full rounded-full border border-line bg-elev pr-4 pl-10 text-sm text-ink placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </form>
          <div className="hidden md:block">
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="contenido" className="px-4 py-6 md:px-8 md:py-8">
        <XpWindow label="Faro" title="Faro">
          {children}
        </XpWindow>
      </main>
    </div>
  </div>
);
