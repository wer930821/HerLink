"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isChromeHidden =
    pathname?.startsWith("/admin") === true ||
    pathname?.startsWith("/session") === true ||
    pathname === "/login";
  const isHome = pathname === "/";
  const isMailbox = pathname === "/mailbox";

  return (
    <>
      {isHome ? <div className="site-home-viewport">{children}</div> : isMailbox ? <div className="site-mailbox-viewport">{children}</div> : children}
      {!isChromeHidden && !isHome && !isMailbox ? <SiteFooter /> : null}
    </>
  );
}
