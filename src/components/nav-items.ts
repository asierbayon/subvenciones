export type NavItem = {
  href: string;
  label: string;
};

export const MAIN_LINKS: NavItem[] = [
  { href: "/", label: "Inicio" },
  { href: "/buscar", label: "Buscador" },
  { href: "/convocatorias", label: "Convocatorias" },
  { href: "/concesiones", label: "Concesiones" },
  { href: "/beneficiarios", label: "Beneficiarios" },
  { href: "/alertas", label: "Alertas" },
];

export const ALERT_LINKS: NavItem[] = [
  { href: "/alertas", label: "Todas las alertas" },
  { href: "/alertas/fraccionamiento", label: "Fraccionamiento" },
  { href: "/alertas/concentracion", label: "Concentración" },
  { href: "/alertas/calendario", label: "Calendario" },
  { href: "/alertas/estadistica", label: "Estadística" },
  { href: "/alertas/directa", label: "Concesión directa" },
  { href: "/alertas/contratos", label: "Contratos" },
  { href: "/alertas/vinculos", label: "Vínculos" },
  { href: "/alertas/puertas-giratorias", label: "Puertas giratorias" },
  { href: "/alertas/sociedades", label: "Sociedades" },
  { href: "/alertas/registro", label: "Registro" },
];

export const isCurrent = (href: string, pathname: string) => {
  if (href === "/") {
    return pathname === "/";
  }
  if (href === "/alertas") {
    return pathname === "/alertas";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};
