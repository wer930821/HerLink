"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isChromeHidden =
    pathname?.startsWith("/admin") === true || pathname?.startsWith("/session") === true;

  return (
    <>
      {!isChromeHidden ? <SiteHeader /> : null}
      {children}
      {!isChromeHidden ? <SiteFooter /> : null}
    </>
  );
}
