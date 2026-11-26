"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export const ThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();

  const handleToggle = () => {
    if (resolvedTheme === "dark") {
      setTheme("light");
      return;
    }
    setTheme("dark");
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label="Cambiar entre modo claro y oscuro"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-elev text-muted transition-colors hover:bg-highlight hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer"
    >
      <Sun aria-hidden="true" className="hidden dark:block" size={16} />
      <Moon aria-hidden="true" className="block dark:hidden" size={16} />
    </button>
  );
};
