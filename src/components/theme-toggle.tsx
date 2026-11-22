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
      className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-elev text-ink hover:bg-highlight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <Sun aria-hidden="true" className="hidden dark:block" size={18} />
      <Moon aria-hidden="true" className="block dark:hidden" size={18} />
    </button>
  );
};
