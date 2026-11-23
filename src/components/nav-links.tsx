"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrent, MAIN_LINKS } from "@/components/xp-nav";

export const NavLinks = () => {
  const pathname = usePathname();

  return (
    <nav className="xp-menubar" aria-label="Secciones">
      {MAIN_LINKS.map((link) => {
        const active = isCurrent(link.href, pathname);
        return (
          <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
};
