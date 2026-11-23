import { NavLinks } from "@/components/nav-links";
import { Taskbar } from "@/components/taskbar";
import { WindowTitle } from "@/components/window-title";
import { XpWindow } from "@/components/xp-window";

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
  <div className="xp-desktop">
    <XpWindow label="Faro" title={<WindowTitle />} menu={<NavLinks />} toolbar={<SearchForm />} status={<Credits />}>
      <div id="contenido">{children}</div>
    </XpWindow>
    <Taskbar />
  </div>
);
