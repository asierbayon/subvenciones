export type XpLink = {
  href: string;
  label: string;
};

export const MAIN_LINKS: XpLink[] = [
  { href: "/", label: "Inicio" },
  { href: "/buscar", label: "Buscador" },
  { href: "/convocatorias", label: "Convocatorias" },
  { href: "/concesiones", label: "Concesiones" },
  { href: "/beneficiarios", label: "Beneficiarios" },
  { href: "/alertas", label: "Alertas" },
];

export const ALERT_LINKS: XpLink[] = [
  { href: "/alertas", label: "Todas las alertas" },
  { href: "/alertas/fraccionamiento", label: "Fraccionamiento" },
  { href: "/alertas/concentracion", label: "Concentración" },
  { href: "/alertas/calendario", label: "Calendario" },
  { href: "/alertas/estadistica", label: "Estadística" },
  { href: "/alertas/directa", label: "Concesión directa" },
  { href: "/alertas/contratos", label: "Contratos" },
  { href: "/alertas/vinculos", label: "Vínculos" },
  { href: "/alertas/sociedades", label: "Sociedades" },
  { href: "/alertas/registro", label: "Registro" },
];

const TITLES: { prefix: string; title: string; exact?: boolean }[] = [
  { prefix: "/", title: "Faro — Inicio", exact: true },
  { prefix: "/buscar", title: "Faro — Buscador" },
  { prefix: "/alertas/fraccionamiento", title: "Faro — Fraccionamiento" },
  { prefix: "/alertas/concentracion", title: "Faro — Concentración" },
  { prefix: "/alertas/calendario", title: "Faro — Calendario" },
  { prefix: "/alertas/estadistica", title: "Faro — Estadística" },
  { prefix: "/alertas/directa", title: "Faro — Concesión directa" },
  { prefix: "/alertas/contratos", title: "Faro — Contratos" },
  { prefix: "/alertas/vinculos", title: "Faro — Vínculos" },
  { prefix: "/alertas/sociedades", title: "Faro — Sociedades" },
  { prefix: "/alertas/registro", title: "Faro — Registro" },
  { prefix: "/alertas", title: "Faro — Alertas" },
  { prefix: "/convocatorias", title: "Faro — Convocatorias" },
  { prefix: "/concesiones", title: "Faro — Concesiones" },
  { prefix: "/beneficiarios", title: "Faro — Beneficiarios" },
];

export const titleForPath = (pathname: string) => {
  const match = TITLES.find((item) => {
    if (item.exact) {
      return pathname === item.prefix;
    }
    return pathname === item.prefix || pathname.startsWith(`${item.prefix}/`);
  });
  if (!match) {
    return "Faro";
  }
  return match.title;
};

export const sectionForPath = (pathname: string) => {
  const title = titleForPath(pathname);
  const parts = title.split(" — ");
  return parts[parts.length - 1] ?? "Faro";
};

export const isCurrent = (href: string, pathname: string) => {
  if (href === "/") {
    return pathname === "/";
  }
  if (href === "/alertas") {
    return pathname === "/alertas";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};
