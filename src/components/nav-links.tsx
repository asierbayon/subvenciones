"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ALERT_LINKS, isCurrent, MAIN_LINKS, type XpLink } from "@/components/xp-nav";

const Menu = ({ label, links }: { label: string; links: XpLink[] }) => {
  const pathname = usePathname();

  return (
    <nav className="xp-menubar" aria-label={label}>
      {links.map((link) => {
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

const alertLinks = ALERT_LINKS.filter((link) => link.href !== "/alertas");

export const NavLinks = () => (
  <>
    <Menu label="Secciones" links={MAIN_LINKS} />
    <nav className="xp-menubar" aria-label="Alertas">
      <span className="xp-alertbar-label">Alertas</span>
      <MenuLinks links={alertLinks} />
    </nav>
  </>
);

const MenuLinks = ({ links }: { links: XpLink[] }) => {
  const pathname = usePathname();

  return (
    <>
      {links.map((link) => {
        const active = isCurrent(link.href, pathname);
        return (
          <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
    </>
  );
};
