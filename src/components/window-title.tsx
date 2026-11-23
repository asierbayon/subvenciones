"use client";

import { usePathname } from "next/navigation";
import { titleForPath } from "@/components/xp-nav";

export const WindowTitle = () => {
  const pathname = usePathname();
  return titleForPath(pathname);
};
