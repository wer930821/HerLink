"use client";

import type { ReactNode } from "react";
import { HomeAccountState } from "../components/home-account-state";

export default function Template({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <HomeAccountState />
    </>
  );
}
