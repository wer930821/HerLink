import type { HTMLAttributes, ReactNode } from "react";

export type NoticeVariant = "info" | "success" | "warning" | "danger";

type NoticeProps = {
  variant?: NoticeVariant;
  title?: ReactNode;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "title">;

export function Notice({ variant = "info", title, children, className, ...rest }: NoticeProps) {
  const isDanger = variant === "danger";
  return (
    <div
      className={`notice notice-${variant}${className ? ` ${className}` : ""}`}
      role={isDanger ? "alert" : undefined}
      aria-live={isDanger ? undefined : "polite"}
      {...rest}
    >
      {title ? <div className="notice-title">{title}</div> : null}
      {children}
    </div>
  );
}
