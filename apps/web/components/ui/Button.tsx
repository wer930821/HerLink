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
    const channel = supabase
      .channel("contacts-entry-unread")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "random_chat_messages" }, () => void refresh())
      .subscribe();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  if (count <= 0) return null;
  return <span className="home-mailbox-unread" aria-label={`${count} 則未讀訊息`}>{count > 99 ? "99+" : count}</span>;
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
