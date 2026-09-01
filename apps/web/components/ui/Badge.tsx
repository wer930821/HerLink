import type { HTMLAttributes, ReactNode } from "react";

export type BadgeVariant = "neutral" | "accent" | "success" | "warning" | "danger";
export type BadgeSize = "sm" | "md";

type BadgeProps = {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>;

export function Badge({ variant = "neutral", size = "md", className, children, ...rest }: BadgeProps) {
  const classes = ["badge", `badge-${variant}`, size === "sm" ? "badge-sm" : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
