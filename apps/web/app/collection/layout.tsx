import type { Viewport } from "next";
import type { ReactNode } from "react";

export const viewport: Viewport = {
  themeColor: "#130d1d",
  viewportFit: "cover",
};

export default function CollectionLayout({ children }: { children: ReactNode }) {
  return children;
}
