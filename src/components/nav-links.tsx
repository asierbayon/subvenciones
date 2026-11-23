"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Panel" },
  { href: "/convocatorias", label: "Convocatorias" },
  { href: "/concesiones", label: "Concesiones" },
  { href: "/beneficiarios", label: "Beneficiarios" },
  { href: "/alertas", label: "Alertas" },
];

export const NavLinks = () => {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones">
      <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
        {LINKS.map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  active ? "bg-accent text-accent-ink" : "text-ink hover:bg-highlight",
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
