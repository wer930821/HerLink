"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";
import { listMyAnonymousContacts, supabase } from "../../lib/supabase";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
};

type ButtonAsButton = CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { href?: undefined };
type ButtonAsLink = CommonProps & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children"> & { href: string };

function ContactUnreadBadge() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const result = await listMyAnonymousContacts();
    if (result.error) return;
    setCount((result.data ?? []).reduce((sum, item) => sum + Number(item.unread_count ?? 0), 0));
  }, []);

  useEffect(() => {
    void refresh();

    // One channel covers both new messages and read-state updates so the home
    // badge clears immediately after a visible chat is marked as read.
    const channel = supabase
      .channel("contacts-entry-unread")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "random_chat_messages" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "random_chat_session_reads" }, () => void refresh())
      .subscribe();

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onFocus = () => void refresh();
    const onPageShow = () => void refresh();
    const onReadChanged = () => void refresh();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("herlink:read-state-changed", onReadChanged);

    // Keep a short polling fallback for browsers where Realtime publication or
    // background lifecycle events are delayed.
    const timer = window.setInterval(() => void refresh(), 5000);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("herlink:read-state-changed", onReadChanged);
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} 則未讀訊息`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 20,
        height: 20,
        marginLeft: 8,
        padding: "0 6px",
        borderRadius: 999,
        background: "#dc2626",
        color: "#fff",
        fontSize: 12,
        fontWeight: 800,
        lineHeight: 1,
        position: "static",
        transform: "none",
        flex: "0 0 auto",
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Button(props: ButtonAsButton | ButtonAsLink) {
  const { variant = "primary", size = "md", fullWidth = false } = props;
  const className = [
    "btn",
    `btn-${variant}`,
    `btn-${size}`,
    fullWidth ? "btn-full" : null,
  ].filter(Boolean).join(" ");

  if (props.href !== undefined) {
    const { href, variant: _variant, size: _size, fullWidth: _fullWidth, children, ...rest } = props as ButtonAsLink;
    return (
      <Link href={href} className={className} {...rest}>
        {children}
        {href === "/contacts" ? <ContactUnreadBadge /> : null}
      </Link>
    );
  }

  const { type = "button", variant: _variant, size: _size, fullWidth: _fullWidth, children, ...rest } = props as ButtonAsButton;
  return (
    <button type={type} className={className} {...rest}>
      {children}
    </button>
  );
}
