"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabase";

export function HomeAccountState() {
  const pathname = usePathname();
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (pathname !== "/") {
      setTarget(null);
      setAccountEmail(null);
      return;
    }

    let active = true;
    const refresh = async () => {
      const { data } = await supabase.auth.getUser();
      if (!active) return;
      const user = data.user;
      setAccountEmail(user?.email && !user.is_anonymous ? user.email : null);
    };

    void refresh();
    const { data: listener } = supabase.auth.onAuthStateChange(() => void refresh());

    let observer: MutationObserver | null = null;
    const findTarget = () => {
      if (!active) return;
      const node = document.querySelector<HTMLElement>(".home-account-actions");
      if (node) {
        setTarget(node);
        return;
      }
      observer = new MutationObserver(() => {
        const next = document.querySelector<HTMLElement>(".home-account-actions");
        if (next) {
          setTarget(next);
          observer?.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };
    findTarget();

    return () => {
      active = false;
      observer?.disconnect();
      listener.subscription.unsubscribe();
    };
  }, [pathname]);

  useEffect(() => {
    if (!target) return;
    target.classList.toggle("home-account-actions--logged-in", Boolean(accountEmail));
    return () => target.classList.remove("home-account-actions--logged-in");
  }, [target, accountEmail]);

  if (!target || !accountEmail) return null;

  return createPortal(
    <div className="home-account-logged-in" role="status" aria-live="polite">
      <strong>已登入</strong>
      <style>{`
        .home-account-actions--logged-in > a { display: none !important; }
        .home-account-actions--logged-in { grid-template-columns: 1fr !important; }
        .home-account-logged-in { width: 100%; display: flex; align-items: center; justify-content: center; min-height: 54px; color: #f4edf8; font-size: 16px; }
        .home-account-logged-in strong { color: #ff9a55; font-size: 16px; }
      `}</style>
    </div>,
    target,
  );
}
