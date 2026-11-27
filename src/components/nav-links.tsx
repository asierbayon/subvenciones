"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ALERT_LINKS, isCurrent, MAIN_LINKS } from "@/components/nav-items";
import { cn } from "@/lib/utils";

const alertItems = ALERT_LINKS.filter((link) => link.href !== "/alertas");

export const PrimaryNav = () => {
  const pathname = usePathname();

  return (
    <nav aria-label="Secciones" className="flex items-center gap-1">
      {MAIN_LINKS.map((link) => {
        const active =
          link.href === "/alertas"
            ? pathname === "/alertas" || pathname.startsWith("/alertas/")
            : isCurrent(link.href, pathname);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              active
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-highlight hover:text-ink",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
};

export const AlertSubNav = () => {
  const pathname = usePathname();
  if (!pathname.startsWith("/alertas")) {
    return null;
  }

  return (
    <div className="border-t border-line/80 bg-subtle/60">
      <nav
        aria-label="Indicadores de alerta"
        className="mx-auto flex max-w-7xl items-center gap-1.5 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8"
      >
        <span className="mr-1 shrink-0 text-[11px] font-semibold tracking-wider text-muted uppercase">
          Alertas
        </span>
        {alertItems.map((link) => {
          const active = isCurrent(link.href, pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                active
                  ? "bg-accent text-accent-ink shadow-2xs"
                  : "text-muted hover:bg-elev hover:text-ink",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};
