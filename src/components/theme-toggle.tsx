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
      className="xp-tray-toggle"
    >
      <Sun aria-hidden="true" className="hidden dark:block" size={12} />
      <Moon aria-hidden="true" className="block dark:hidden" size={12} />
    </button>
  );
};
