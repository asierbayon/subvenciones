import { NavLinks } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";

const Mark = () => (
  <svg className="xp-titlebar-icon" viewBox="0 0 16 16" aria-hidden="true">
    <rect width="16" height="16" fill="#003399" />
    <path d="M8 2.2 9.15 6h3.85l-3.1 2.25 1.15 3.65L8 9.7l-3.05 2.2L6.1 8.25 3 6h3.85z" fill="#fff3c4" />
  </svg>
);

const SearchForm = () => (
  <form action="/buscar" role="search" className="xp-toolbar">
    <label htmlFor="q-global">Buscar</label>
    <input
      id="q-global"
      name="q"
      type="search"
      placeholder="Busca una convocatoria, un organismo o un NIF"
      className="xp-input"
    />
    <button type="submit" className="xp-button">
      Buscar
    </button>
  </form>
);

const Credits = () => (
  <footer className="xp-statusbar">
    <p>
      Datos del volcado abierto de{" "}
      <a href="https://github.com/JaimeObregon/subvenciones">Jaime Obregón</a>
      . Fuente oficial: la{" "}
      <a href="https://www.infosubvenciones.es">Base de Datos Nacional de Subvenciones</a>.
    </p>
  </footer>
);

export const SiteFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="xp-app">
    <header>
      <div className="xp-header-bar">
        <Mark />
        <div className="xp-header-copy">
          <p className="xp-header-name">Faro</p>
          <p className="xp-header-sub">Visor de la BDNS</p>
        </div>
        <div className="xp-header-tools">
          <ThemeToggle />
        </div>
      </div>
      <NavLinks />
      <SearchForm />
    </header>
    <main id="contenido" className="xp-main">
      {children}
    </main>
    <Credits />
  </div>
);
