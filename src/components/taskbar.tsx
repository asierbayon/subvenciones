"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { ALERT_LINKS, isCurrent, MAIN_LINKS, sectionForPath } from "@/components/xp-nav";

const Flag = () => (
  <svg viewBox="0 0 18 16" width="16" height="14" aria-hidden="true">
    <path d="M1.5 0h1.4v16H1.5z" fill="#f4efe4" />
    <path d="M4 1.2c2 .8 3.6-.7 5.6 0s3.6-.7 5.6 0v2.6c-2-.7-3.6.8-5.6 0S6 3.1 4 3.8z" fill="#e25b4a" />
    <path d="M4 4.2c2 .8 3.6-.7 5.6 0s3.6-.7 5.6 0v2.6c-2-.7-3.6.8-5.6 0S6 6.1 4 6.8z" fill="#3d9a32" />
    <path d="M4 7.2c2 .8 3.6-.7 5.6 0s3.6-.7 5.6 0v2.6c-2-.7-3.6.8-5.6 0S6 9.1 4 9.8z" fill="#245edc" />
    <path d="M4 10.2c2 .8 3.6-.7 5.6 0s3.6-.7 5.6 0V13c-2-.7-3.6.8-5.6 0S6 12.1 4 12.8z" fill="#f0c040" />
  </svg>
);

const MenuLink = ({
  href,
  label,
  pathname,
  onNavigate,
}: {
  href: string;
  label: string;
  pathname: string;
  onNavigate: () => void;
}) => {
  const active = isCurrent(href, pathname);
  return (
    <Link
      href={href}
      role="menuitem"
      className="xp-start-item"
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      {label}
    </Link>
  );
};

export const Taskbar = () => {
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const open = openPath === pathname;

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }));
    };
    update();
    const id = window.setInterval(update, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointer = (event: MouseEvent) => {
      if (!rootRef.current) {
        return;
      }
      if (rootRef.current.contains(event.target as Node)) {
        return;
      }
      setOpenPath(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      setOpenPath(null);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleToggle = () => {
    if (open) {
      setOpenPath(null);
      return;
    }
    setOpenPath(pathname);
  };

  const handleNavigate = () => {
    setOpenPath(null);
  };

  return (
    <div ref={rootRef}>
      <footer className="xp-taskbar">
        <button
          type="button"
          className="xp-start"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls="inicio-menu"
          onClick={handleToggle}
        >
          <Flag />
          Inicio
        </button>
        <div className="xp-task-buttons">
          <span className="xp-task-button">{sectionForPath(pathname)}</span>
        </div>
        <div className="xp-tray">
          <ThemeToggle />
          <time>{clock}</time>
        </div>
      </footer>
      {open ? (
        <nav id="inicio-menu" className="xp-start-menu" role="menu" aria-label="Inicio">
          <div className="xp-start-user">
            <Flag />
            <span>
              Faro
              <small>Visor de la BDNS</small>
            </span>
          </div>
          <div className="xp-start-columns">
            <div className="xp-start-left">
              {MAIN_LINKS.filter((link) => link.href !== "/alertas").map((link) => (
                <MenuLink
                  key={link.href}
                  href={link.href}
                  label={link.label}
                  pathname={pathname}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
            <div className="xp-start-right">
              <p className="xp-start-label">Alertas</p>
              {ALERT_LINKS.map((link) => (
                <MenuLink
                  key={link.href}
                  href={link.href}
                  label={link.label}
                  pathname={pathname}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          </div>
          <p className="xp-start-footer">Volcado abierto de la Base de Datos Nacional de Subvenciones.</p>
        </nav>
      ) : null}
    </div>
  );
};
